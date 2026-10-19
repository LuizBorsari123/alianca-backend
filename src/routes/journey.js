// Parte 3 — A caminhada: meta de dias, streak e histórico.
import { db } from '../db.js';
import { exigeAuth } from '../auth.js';
import { MARCOS_META } from '../config.js';

const DIA = 24 * 60 * 60 * 1000;

export function diasFirmes(household, agora = Date.now()) {
  const inicio = household.streakInicio ? Date.parse(household.streakInicio) : agora;
  return Math.max(0, Math.floor((agora - inicio) / DIA));
}
function proximoMarco(dias) {
  return MARCOS_META.find(m => m > dias) || null;
}

export function mountJourney(app) {
  // Visão da caminhada (serve para a Home do titular e o Resumo do guardião).
  app.get('/journey', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    if (!h) return res.status(400).json({ erro: 'Sem família.' });
    const dias = diasFirmes(h);
    const prox = proximoMarco(dias);
    const historico = db.eventsOf(h.id).map(e => ({ titulo: e.titulo, corpo: e.corpo, ts: e.ts, tipo: e.tipo }));
    const tentativasSemana = historico.filter(e =>
      e.tipo === 'tentativa' && Date.now() - Date.parse(e.ts) <= 7 * DIA).length;
    const remocoes = historico.filter(e => e.tipo === 'remocao').length;

    res.json({
      diasFirmes: dias,
      meta: 90,
      marcos: MARCOS_META,
      proximoMarco: prox,
      faltamParaProximo: prox ? prox - dias : 0,
      tentativasSemana,
      remocoes,
      historico, // guardião vê categoria + horário, nunca o endereço do site
    });
  });

  // O titular registra uma recaída — zera a caminhada e guarda no histórico.
  app.post('/journey/recaida', exigeAuth, (req, res) => {
    const user = db.getUser(req.userId);
    const h = db.getHousehold(user.householdId);
    if (!h) return res.status(400).json({ erro: 'Sem família.' });
    db.updateHousehold(h.id, { streakInicio: new Date().toISOString() });
    db.events.create({
      householdId: h.id, tipo: 'recaida', titulo: 'Recomeço',
      corpo: 'A caminhada recomeçou. Um dia de cada vez.', ts: new Date().toISOString(),
    });
    res.json({ ok: true, diasFirmes: 0 });
  });
}
