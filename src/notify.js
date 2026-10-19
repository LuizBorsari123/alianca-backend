// Comunicação DENTRO do app (sem WhatsApp, sem chat aberto).
// Só existem: alertas do sistema e as respostas do convite da "noite a sós".
// Cada aviso vira uma mensagem interna, entregue quando o app consulta
// GET /messages (push pode somar depois, só como "toque" no celular).

import { db } from './db.js';

export function notificaUsuario(userId, { tipo, titulo, corpo }) {
  if (!userId) return null;
  const msg = db.messages.create({
    paraUsuarioId: userId, tipo, titulo, corpo,
    lida: false, ts: new Date().toISOString(),
  });
  console.log(`  [MSG in-app → ${userId}] ${titulo} — ${corpo}`);
  return msg;
}

export function notificaGuardiao(householdId, payload) {
  const guardiao = db.guardiaoDe(householdId);
  return guardiao ? notificaUsuario(guardiao.id, payload) : null;
}
