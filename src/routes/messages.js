// Caixa de entrada interna: só alertas do sistema e respostas do convite.
// (Não é um app de conversa — não há envio livre de mensagens.)
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';

export function mountMessages(app) {
  app.get('/messages', exigeAuth, (req, res) => {
    const msgs = db.messagesFor(req.userId).map(m => ({
      id: m.id, tipo: m.tipo, titulo: m.titulo, corpo: m.corpo, lida: m.lida, ts: m.ts,
    }));
    res.json({ mensagens: msgs, naoLidas: msgs.filter(m => !m.lida).length });
  });

  app.post('/messages/:id/lida', exigeAuth, (req, res) => {
    const m = db.messages.get(req.params.id);
    if (!m || m.paraUsuarioId !== req.userId) return res.status(404).json({ erro: 'Mensagem não encontrada.' });
    db.messages.update(m.id, { lida: true });
    res.json({ ok: true });
  });
}
