#!/usr/bin/env node
/*
 * Ponte DNS → backend do Aliança.
 *
 * Lê o query log do AdGuard Home (API HTTP) a cada N segundos, encontra as
 * consultas BLOQUEADAS e avisa o backend (/dns/evento) para notificar o
 * guardião — só com categoria + horário, nunca o endereço do site.
 *
 * LIMITAÇÃO IMPORTANTE (atribuição por aparelho):
 *   Para dizer de QUAL aparelho veio a tentativa, cada celular precisa usar um
 *   ID de DNS próprio (DoH por-cliente no AdGuard). Enquanto isso não existir,
 *   este script envia os eventos para um único dnsId (ALIANCA_DNS_ID), que
 *   representa "a casa". É o primeiro passo; a granularidade por aparelho é a
 *   evolução seguinte.
 *
 * Variáveis de ambiente:
 *   ADGUARD_URL        ex: http://127.0.0.1:3000
 *   ADGUARD_USER       usuário do painel AdGuard
 *   ADGUARD_PASS       senha do painel AdGuard
 *   BACKEND_URL        ex: https://api.xn--aliana-0ua.app:8443
 *   SERVICE_SECRET     o mesmo segredo de serviço do backend (exigeServico)
 *   ALIANCA_DNS_ID     o dnsId do aparelho/casa a atribuir os eventos
 *   INTERVALO_MS       opcional, padrão 30000
 */
const ADGUARD_URL = process.env.ADGUARD_URL || 'http://127.0.0.1:3000';
const ADGUARD_USER = process.env.ADGUARD_USER || '';
const ADGUARD_PASS = process.env.ADGUARD_PASS || '';
const BACKEND_URL = process.env.BACKEND_URL || '';
const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
const ALIANCA_DNS_ID = process.env.ALIANCA_DNS_ID || '';
const INTERVALO_MS = Number(process.env.INTERVALO_MS || 30000);

const auth = 'Basic ' + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString('base64');
let ultimoTs = Date.now();

async function ciclo() {
  try {
    const r = await fetch(`${ADGUARD_URL}/control/querylog?limit=200`, { headers: { Authorization: auth } });
    if (!r.ok) { console.error('AdGuard querylog', r.status); return; }
    const data = await r.json();
    const linhas = (data.data || []).filter(q => {
      const bloqueado = q.reason && /Filtered|Blocked|Rewrite|Safe/i.test(q.reason);
      const t = Date.parse(q.time);
      return bloqueado && t > ultimoTs;
    });
    if (linhas.length) ultimoTs = Date.parse(linhas[0].time);
    for (const q of linhas) {
      await fetch(`${BACKEND_URL}/dns/evento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-service-secret': SERVICE_SECRET },
        body: JSON.stringify({ dnsId: ALIANCA_DNS_ID, tipo: 'bloqueado', categoria: 'conteúdo adulto', ts: q.time }),
      }).catch(e => console.error('backend', e.message));
    }
    if (linhas.length) console.log(`[dns-bridge] ${linhas.length} bloqueio(s) enviado(s)`);
  } catch (e) {
    console.error('[dns-bridge]', e.message);
  }
}

console.log('[dns-bridge] iniciado; intervalo', INTERVALO_MS, 'ms');
setInterval(ciclo, INTERVALO_MS);
ciclo();
