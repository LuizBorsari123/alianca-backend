// Parte 5 — Pagamento (webhook do gateway) e status da assinatura.
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';
import { exigeServico, ASAAS_WEBHOOK_TOKEN } from '../config.js';
import { notificaGuardiao } from '../notify.js';
import { asaasConfigurado, criarCliente, criarAssinatura, pixDaAssinatura, faturaDaAssinatura, criarAutorizacaoPixAutomatico, cancelarCobrancaAsaas } from '../asaas.js';

const PLANOS = {
  mensal: { preco: 990, reais: 9.90, ciclo: 'MONTHLY', periodoDias: 30, rotulo: 'Mensal' },
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

  // >>> ENCERRAR A COBRANÇA (o dinheiro) — FÁCIL, IMEDIATO, SEM PIN.
  // Direito do consumidor (CDC): cancelar o pagamento tem que ser simples.
  // A proteção NÃO cai na hora: segue até o fim do período já pago. Isso é
  // diferente de "desativar a proteção agora" (que exige PIN do cônjuge).
  app.post('/subscription/encerrar-cobranca', exigeAuth, async (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    if (sub.renova === false) {
      return res.json({ ok: true, jaEncerrada: true, protegidoAte: sub.vigenteAte || null });
    }
    // Para de debitar no Asaas (se estiver configurado e houver id).
    let gateway = [];
    if (asaasConfigurado() && (sub.asaasSubscriptionId || sub.pixAutomaticoId)) {
      try {
        gateway = await cancelarCobrancaAsaas({ asaasSubscriptionId: sub.asaasSubscriptionId, pixAutomaticoId: sub.pixAutomaticoId });
      } catch (e) {
        // Não travamos o cliente por erro do gateway — registramos e seguimos.
        console.error('[billing] Falha ao cancelar no Asaas:', e.message);
      }
    }
    const agora = new Date().toISOString();
    db.subscriptions.update(sub.id, { renova: false, cobrancaEncerradaEm: agora });
    db.events.create({
      householdId: user.householdId, tipo: 'cobranca_encerrada', titulo: 'Cobrança encerrada',
      corpo: 'A renovação foi cancelada. A proteção segue até o fim do período pago.', ts: agora,
    });
    res.json({ ok: true, protegidoAte: sub.vigenteAte || null, gateway });
  });

  // Reativar a renovação antes de acabar o período (muda de ideia sobre o dinheiro).
  app.post('/subscription/reativar-cobranca', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    db.subscriptions.update(sub.id, { renova: true, cobrancaEncerradaEm: null });
    res.json({ ok: true });
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
      // Cartão: devolve o invoiceUrl (página segura do Asaas para digitar o cartão;
      // o Asaas guarda o cartão e cobra sozinho todo mês).
      const checkout = billingType === 'CREDIT_CARD' ? await faturaDaAssinatura(assinatura.id) : null;
      res.status(201).json({ ok: true, assinaturaId: assinatura.id, pix, checkout });
    } catch (e) {
      res.status(502).json({ erro: 'Falha ao falar com o Asaas.', detalhe: String(e.message) });
    }
  });

  // Pix Automático: cria a autorização recorrente. O app mostra o QR; o cliente
  // paga/autoriza uma vez e o Asaas passa a debitar sozinho todo mês.
  app.post('/billing/pix-automatico', exigeAuth, async (req, res) => {
    if (!asaasConfigurado()) return res.status(503).json({ erro: 'Asaas não configurado. Defina ASAAS_API_KEY no servidor.' });
    const { cpfCnpj, telefone, plano = 'mensal' } = req.body || {};
    if (!cpfCnpj) return res.status(400).json({ erro: 'Informe o CPF/CNPJ do pagador.' });
    const p = PLANOS[plano] || PLANOS.mensal;
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    try {
      let customerId = sub.asaasCustomerId;
      if (!customerId) {
        const cli = await criarCliente({ nome: user.nome, email: user.email, cpfCnpj, telefone });
        customerId = cli.id;
      }
      const aut = await criarAutorizacaoPixAutomatico({
        customerId, valor: p.reais, descricao: 'Alianca protecao', contractId: user.householdId,
      });
      db.subscriptions.update(sub.id, { plano, asaasCustomerId: customerId, pixAutomaticoId: aut.id, estado: 'pendente' });
      // Extrai o QR de forma tolerante (o nome exato do campo pode variar).
      const q = aut.immediateQrCode || aut.qrCode || aut.pix || {};
      const payload = q.payload || q.copyPaste || aut.payload || '';
      const imagem = q.encodedImage || q.imagemBase64 || q.qrCodeImage || aut.encodedImage || '';
      res.status(201).json({ ok: true, autorizacaoId: aut.id, pix: { payload, imagemBase64: imagem }, raw: aut });
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
