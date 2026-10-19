// Parte 5 — Pagamento (webhook do gateway) e status da assinatura.
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';
import { exigeServico, ASAAS_WEBHOOK_TOKEN } from '../config.js';
import { notificaGuardiao } from '../notify.js';
import { asaasConfigurado, criarCliente, criarAssinatura, pixDaAssinatura } from '../asaas.js';

const PLANOS = {
  mensal: { preco: 2990, reais: 29.90, ciclo: 'MONTHLY', periodoDias: 30, rotulo: 'Mensal' },
  anual: { preco: 26900, reais: 269.00, ciclo: 'YEARLY', periodoDias: 365, rotulo: 'Anual' },
};

export function mountBilling(app) {
  // Status da assinatura (para a aba Pagamento das Configurações).
  app.get('/subscription', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    let faltaMs = null;
    if (sub.cancelamento?.estado === 'carencia') {
      faltaMs = Math.max(0, Date.parse(sub.cancelamento.confirmavelApos) - Date.now());
    }
    res.json({ assinatura: { ...sub, planoInfo: PLANOS[sub.plano] }, esperaRestanteMs: faltaMs });
  });

  // Troca de plano pelo usuário (reflete na próxima cobrança).
  app.post('/subscription/plano', exigeAuth, (req, res) => {
    const { plano } = req.body || {};
    if (!PLANOS[plano]) return res.status(400).json({ erro: 'Plano inválido.' });
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    db.subscriptions.update(sub.id, { plano });
    res.json({ ok: true, plano, planoInfo: PLANOS[plano] });
  });

  // Assinar DENTRO do app: cria o cliente e a assinatura no Asaas e devolve o Pix
  // (QR + copia-e-cola) para o app exibir. Cartão: o app pode usar o invoiceUrl
  // ou a tokenização do Asaas (ver guia de configuração).
  app.post('/billing/assinar', exigeAuth, async (req, res) => {
    if (!asaasConfigurado()) return res.status(503).json({ erro: 'Asaas não configurado. Defina ASAAS_API_KEY no servidor.' });
    const { cpfCnpj, telefone, plano = 'anual', billingType = 'PIX' } = req.body || {};
    if (!cpfCnpj) return res.status(400).json({ erro: 'Informe o CPF/CNPJ do pagador.' });
    const p = PLANOS[plano] || PLANOS.anual;
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    try {
      let customerId = sub.asaasCustomerId;
      if (!customerId) {
        const cli = await criarCliente({ nome: user.nome, email: user.email, cpfCnpj, telefone });
        customerId = cli.id;
      }
      const assinatura = await criarAssinatura({ customerId, valor: p.reais, ciclo: p.ciclo, billingType, householdId: user.householdId });
      db.subscriptions.update(sub.id, { plano, asaasCustomerId: customerId, asaasSubscriptionId: assinatura.id, estado: 'pendente' });
      const pix = billingType === 'PIX' ? await pixDaAssinatura(assinatura.id) : null;
      res.status(201).json({ ok: true, assinaturaId: assinatura.id, pix });
    } catch (e) {
      res.status(502).json({ erro: 'Falha ao falar com o Asaas.', detalhe: String(e.message) });
    }
  });

  // >>> Ponto que o GATEWAY DE PAGAMENTO chama (Asaas/Pagar.me) — usa segredo de serviço.
  // evento: 'pago' | 'vencido' | 'falha'
  app.post('/billing/webhook', exigeServico, (req, res) => {
    const { householdId, evento, plano } = req.body || {};
    const sub = householdId ? db.subscriptionOf(householdId) : null;
    if (!sub) return res.status(404).json({ erro: 'Assinatura não encontrada.' });

    if (evento === 'pago') {
      const p = PLANOS[plano || sub.plano];
      const vigenteAte = new Date(Date.now() + p.periodoDias * 24 * 3600 * 1000).toISOString();
      db.subscriptions.update(sub.id, { estado: 'ativa', plano: plano || sub.plano, vigenteAte });
      db.events.create({ householdId, tipo: 'pagamento', titulo: 'Pagamento confirmado', corpo: `Plano ${p.rotulo}`, ts: new Date().toISOString() });
      return res.json({ ok: true, vigenteAte });
    }
    if (evento === 'falha') {
      notificaGuardiao(householdId, { tipo: 'pagamento', titulo: 'Falha no pagamento', corpo: 'A cobrança falhou. A proteção continua por enquanto.' });
      return res.json({ ok: true });
    }
    if (evento === 'vencido') {
      // a proteção não cai na hora; entra em atraso e expira conforme a regra de negócio
      db.subscriptions.update(sub.id, { estado: 'vencida' });
      db.events.create({ householdId, tipo: 'pagamento', titulo: 'Assinatura vencida', corpo: 'Pagamento em atraso.', ts: new Date().toISOString() });
      return res.json({ ok: true });
    }
    res.status(400).json({ erro: 'Evento desconhecido.' });
  });

  // >>> Webhook do ASAAS. Configure no painel do Asaas apontando para cá, com o
  // token no cabeçalho `asaas-access-token`. O Asaas envia eventos como
  // PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE. A assinatura é ligada
  // à família pelo `externalReference` = householdId (defina isso ao criar a
  // cobrança no Asaas).
  app.post('/billing/asaas/webhook', (req, res) => {
    if ((req.headers['asaas-access-token'] || '') !== ASAAS_WEBHOOK_TOKEN) {
      return res.status(403).json({ erro: 'Token do Asaas inválido.' });
    }
    const { event, payment } = req.body || {};
    const householdId = payment?.externalReference;
    const sub = householdId ? db.subscriptionOf(householdId) : null;
    if (!sub) return res.status(200).json({ ok: true, ignorado: 'sem assinatura para esse externalReference' });

    const marcaPago = () => {
      const p = PLANOS[sub.plano];
      const vigenteAte = new Date(Date.now() + p.periodoDias * 24 * 3600 * 1000).toISOString();
      db.subscriptions.update(sub.id, { estado: 'ativa', vigenteAte, asaasCustomerId: payment?.customer || sub.asaasCustomerId || null });
      db.events.create({ householdId, tipo: 'pagamento', titulo: 'Pagamento confirmado (Asaas)', corpo: `Plano ${p.rotulo}`, ts: new Date().toISOString() });
    };

    switch (event) {
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        marcaPago();
        break;
      case 'PAYMENT_OVERDUE':
        db.subscriptions.update(sub.id, { estado: 'vencida' });
        notificaGuardiao(householdId, { tipo: 'pagamento', titulo: 'Pagamento em atraso', corpo: 'A assinatura venceu. A proteção continua por enquanto.' });
        break;
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_DELETED':
        db.subscriptions.update(sub.id, { estado: 'cancelada' });
        break;
      default:
        return res.status(200).json({ ok: true, ignorado: event });
    }
    res.json({ ok: true });
  });
}

export { PLANOS };
