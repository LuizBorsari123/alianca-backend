// Comunicação DENTRO do app (sem WhatsApp, sem chat aberto).
// Só existem: alertas do sistema e as respostas do convite da "noite a sós".
// Cada aviso vira uma mensagem interna, entregue quando o app consulta
// GET /messages (push pode somar depois, só como "toque" no celular).

import { db } from './db.js';
import { enviarPush } from './push.js';
import { enviarWebPush } from './webpush.js';

export function notificaUsuario(userId, { tipo, titulo, corpo }) {
  if (!userId) return null;
  const msg = db.messages.create({
    paraUsuarioId: userId, tipo, titulo, corpo,
    lida: false, ts: new Date().toISOString(),
  });
  const user = db.getUser(userId);
  // 1) push no app Android nativo (Firebase), se houver token
  if (user?.fcmToken) enviarPush(user.fcmToken, titulo, corpo);
  // 2) push no PWA (iPhone/navegador) — para cada inscrição salva.
  //    Inscrições que o aparelho cancelou (404/410) são removidas.
  const inscricoes = Array.isArray(user?.webPushSubs) ? user.webPushSubs : [];
  if (inscricoes.length) {
    Promise.allSettled(
      inscricoes.map(sub => enviarWebPush(sub, titulo, corpo, { tipo }))
    ).then(resultados => {
      const vivas = inscricoes.filter((_, i) => {
        const r = resultados[i];
        return !(r.status === 'rejected' && r.reason?.inscricaoMorta);
      });
      if (vivas.length !== inscricoes.length) db.updateUser(userId, { webPushSubs: vivas });
    }).catch(() => {});
  }
  console.log(`  [MSG in-app → ${userId}] ${titulo} — ${corpo}`);
  return msg;
}

export function notificaGuardiao(householdId, payload) {
  const guardiao = db.guardiaoDe(householdId);
  return guardiao ? notificaUsuario(guardiao.id, payload) : null;
}

// Proteção MÚTUA: avisa o(s) parceiro(s) da casa — todo mundo menos quem agiu.
// Em uma casa de 2 (titular + guardião, ambos protegidos), isso faz o alerta
// ir para o cônjuge certo, não para quem mexeu no próprio aparelho.
export function notificaParceiros(householdId, exceptUserId, payload) {
  const membros = db.membersOf(householdId).filter(
    u => u.id !== exceptUserId && (u.papel === 'titular' || u.papel === 'guardiao')
  );
  return membros.map(m => notificaUsuario(m.id, payload));
}
