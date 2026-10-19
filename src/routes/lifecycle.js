// Parte 4 — Cancelamento (carência), logout com senha do guardião, reset por suporte.
import { db } from '../db.js';
import { exigeAuth, hash, verificaSenha } from '../auth.js';
import { exigeServico, CARENCIA_CANCEL_MS, CARENCIA_POS_CANCEL_MS } from '../config.js';
import { notificaGuardiao } from '../notify.js';

export function mountLifecycle(app) {
  // Inicia o cancelamento: abre a janela de espera e avisa o guardião NA HORA.
  app.post('/subscription/cancelar', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub) return res.status(404).json({ erro: 'Sem assinatura.' });
    if (sub.estado !== 'ativa') return res.status(409).json({ erro: 'A assinatura não está ativa.' });

    const agora = Date.now();
    const cancelamento = {
      estado: 'carencia',
      inicioEm: new Date(agora).toISOString(),
      confirmavelApos: new Date(agora + CARENCIA_CANCEL_MS).toISOString(),
    };
    db.subscriptions.update(sub.id, { cancelamento });
    db.events.create({
      householdId: user.householdId, tipo: 'cancel_inicio', titulo: 'Iniciou cancelamento',
      corpo: 'Janela de espera aberta.', ts: cancelamento.inicioEm,
    });
    notificaGuardiao(user.householdId, {
      tipo: 'cancel_inicio', titulo: 'Atenção: cancelamento iniciado',
      corpo: 'Seu cônjuge está prestes a cancelar a proteção. Ligue ou vá até ele agora.',
    });
    res.json({ ok: true, cancelamento, esperaMs: CARENCIA_CANCEL_MS });
  });

  // Confirma — só depois que a janela de espera terminou.
  app.post('/subscription/cancelar/confirmar', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    const c = sub?.cancelamento;
    if (!c || c.estado !== 'carencia') return res.status(409).json({ erro: 'Não há cancelamento em espera.' });
    if (Date.now() < Date.parse(c.confirmavelApos)) {
      const faltaMs = Date.parse(c.confirmavelApos) - Date.now();
      return res.status(425).json({ erro: 'Ainda na janela de espera.', faltaMs });
    }
    const protecaoAte = new Date(Date.now() + CARENCIA_POS_CANCEL_MS).toISOString();
    db.subscriptions.update(sub.id, { estado: 'cancelada', protecaoAte, cancelamento: { ...c, estado: 'confirmado' } });
    db.events.create({
      householdId: user.householdId, tipo: 'cancel_confirmado', titulo: 'Cancelamento confirmado',
      corpo: 'Proteção segue por 72 horas.', ts: new Date().toISOString(),
    });
    notificaGuardiao(user.householdId, {
      tipo: 'cancel_confirmado', titulo: 'Cancelamento confirmado',
      corpo: 'A proteção segue por 72 horas. Ainda dá tempo de conversar.',
    });
    res.json({ ok: true, protecaoAte });
  });

  // Desiste — volta tudo ao normal.
  app.post('/subscription/cancelar/desistir', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const sub = db.subscriptionOf(user.householdId);
    if (!sub?.cancelamento) return res.status(409).json({ erro: 'Nada para desistir.' });
    db.subscriptions.update(sub.id, { estado: 'ativa', cancelamento: null });
    db.events.create({
      householdId: user.householdId, tipo: 'cancel_desistiu', titulo: 'Manteve a proteção',
      corpo: 'Mudou de ideia.', ts: new Date().toISOString(),
    });
    notificaGuardiao(user.householdId, {
      tipo: 'cancel_desistiu', titulo: 'Ele mudou de ideia',
      corpo: 'Seu cônjuge desistiu de cancelar. A proteção continua.',
    });
    res.json({ ok: true });
  });

  // Sair da conta: EXIGE a senha do guardião e avisa o guardião.
  app.post('/auth/logout', exigeAuth, (req, res) => {
    const { pin } = req.body || {};
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    if (!h?.pinHash) return res.status(400).json({ erro: 'Defina o PIN de proteção antes.' });
    if (!verificaSenha(pin, h.pinHash)) {
      return res.status(403).json({ erro: 'Senha do guardião incorreta. Sem ela, não é possível sair.' });
    }
    db.events.create({
      householdId: h.id, tipo: 'logout', titulo: 'Saiu da conta',
      corpo: `${user.nome} saiu da conta neste aparelho.`, ts: new Date().toISOString(),
    });
    notificaGuardiao(h.id, {
      tipo: 'logout', titulo: 'Conta encerrada num aparelho',
      corpo: `${user.nome} saiu da conta. Se não foi combinado, converse com ele.`,
    });
    res.json({ ok: true, aviso: 'Sessão encerrada. O token deve ser apagado no app.' });
  });

  // NÃO existe rota para o usuário trocar o PIN. O reset é só pelo SUPORTE,
  // que confirma com o guardião antes (evita burla).
  app.post('/support/reset-pin', exigeServico, (req, res) => {
    const { householdId, novoPin } = req.body || {};
    const h = db.getHousehold(householdId);
    if (!h) return res.status(404).json({ erro: 'Família não encontrada.' });
    if (!/^\d{4}$/.test(String(novoPin || ''))) return res.status(400).json({ erro: 'PIN de 4 dígitos.' });
    db.updateHousehold(h.id, { pinHash: hash(novoPin) });
    db.events.create({
      householdId: h.id, tipo: 'pin_reset', titulo: 'PIN redefinido pelo suporte',
      corpo: 'Confirmação feita com o guardião.', ts: new Date().toISOString(),
    });
    notificaGuardiao(h.id, {
      tipo: 'pin_reset', titulo: 'PIN de proteção redefinido',
      corpo: 'O suporte redefiniu o PIN após confirmar com você.',
    });
    res.json({ ok: true });
  });
}
