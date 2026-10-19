// O convite da "noite a sós" — a única interação do casal no app.
// Quem está em recuperação (titular) convida; o cônjuge aceita (com horário) ou
// recusa com acolhimento. Nada de conversa livre.
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';
import { notificaUsuario, notificaGuardiao } from '../notify.js';

export function mountConvite(app) {
  // Titular envia o convite.
  app.post('/convite', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    if (!h?.guardiaoId) return res.status(400).json({ erro: 'O cônjuge ainda não entrou na conta.' });
    const convite = { id: db.id(), estado: 'pendente', quando: null, criadoEm: new Date().toISOString() };
    db.updateHousehold(h.id, { convite });
    notificaGuardiao(h.id, {
      tipo: 'convite', titulo: 'Um convite para vocês dois',
      corpo: `${user.nome} está te chamando para um tempo a sós. Se quiser e puder, diga quando.`,
    });
    res.status(201).json({ ok: true, convite });
  });

  // Cônjuge responde: aceita (com horário) ou recusa (com acolhimento).
  app.post('/convite/responder', exigeAuth, (req, res) => {
    const { aceita, quando } = req.body || {};
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    if (!h?.convite || h.convite.estado !== 'pendente') return res.status(409).json({ erro: 'Não há convite pendente.' });
    if (user.id !== h.guardiaoId) return res.status(403).json({ erro: 'Só o cônjuge responde ao convite.' });

    const titular = db.getUser(h.donoId);
    if (aceita) {
      const convite = { ...h.convite, estado: 'aceito', quando: quando || 'em breve' };
      db.updateHousehold(h.id, { convite });
      notificaUsuario(titular.id, {
        tipo: 'convite', titulo: 'Ela topou 💛',
        corpo: `Um tempo só de vocês: ${convite.quando}. Segure firme até lá.`,
      });
      return res.json({ ok: true, convite });
    }
    const convite = { ...h.convite, estado: 'recusado', quando: null };
    db.updateHousehold(h.id, { convite });
    notificaUsuario(titular.id, {
      tipo: 'convite', titulo: 'Agora não, mas estou com você',
      corpo: 'Ela não pode agora — mas está com você. O que você procura é colo, e isso ela te dá.',
    });
    res.json({ ok: true, convite });
  });

  app.get('/convite', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    res.json({ convite: h?.convite || null });
  });
}
