// Ponte DNS → Backend.
// O AdGuard Home não dispara webhook por consulta; ele mantém um log consultável.
// Esta ponte lê o log do AdGuard periodicamente e reenvia os eventos ao backend:
//   - qualquer consulta de um aparelho  → 'heartbeat' (sinal de vida)
//   - consulta BLOQUEADA                → 'bloqueado' (vira aviso ao guardião)
//
// Identificação do aparelho: o app conecta no AdGuard via DNS-over-TLS usando o
// "client id" = o dnsId do aparelho (ex.: a1b2c3d4.dns.aliancaapp.com.br). Esse
// id aparece no log, e é ele que casa com o aparelho no backend.
//
// Rodar:  AGH_USER=admin AGH_PASS=senha node dns/bridge.mjs

const BACKEND = process.env.BACKEND || 'http://localhost:3000';
const SERVICE_SECRET = process.env.SERVICE_SECRET || 'servico-prototipo-trocar';
const AGH = process.env.AGH_URL || 'http://localhost:3001'; // painel do AdGuard Home
const AGH_USER = process.env.AGH_USER || 'admin';
const AGH_PASS = process.env.AGH_PASS || 'admin';
const INTERVALO_MS = Number(process.env.INTERVALO_MS || 10000);

const auth = 'Basic ' + Buffer.from(`${AGH_USER}:${AGH_PASS}`).toString('base64');
const vistos = new Set();   // evita reenviar a mesma consulta
let ultimaBatida = new Map(); // dnsId -> ts do último heartbeat enviado

async function enviaBackend(dnsId, tipo, categoria) {
  try {
    const r = await fetch(BACKEND + '/dns/evento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': SERVICE_SECRET },
      body: JSON.stringify({ dnsId, tipo, categoria }),
    });
    if (!r.ok && r.status !== 404) console.error('backend', tipo, r.status);
  } catch (e) { console.error('backend falhou:', e.message); }
}

// Extrai o dnsId (client id do DoT) do registro de log do AdGuard.
function extraiDnsId(q) {
  // AdGuard expõe o client id em campos como "client_id"; como fallback, se o
  // cliente vier como "<id>.dns.aliancaapp.com.br", pega o primeiro rótulo.
  if (q.client_id) return q.client_id;
  const m = String(q.client || '').match(/^([0-9a-f]{8})\./i);
  return m ? m[1] : null;
}

function foiBloqueado(q) {
  // razões de bloqueio do AdGuard Home
  return /Filtered|Blocked|BlackList|SafeBrowsing|Rewrite/i.test(q.reason || '');
}

async function tick() {
  let data;
  try {
    const r = await fetch(`${AGH}/control/querylog?limit=200`, { headers: { Authorization: auth } });
    if (!r.ok) { console.error('querylog', r.status); return; }
    data = await r.json();
  } catch (e) { console.error('AdGuard inacessível:', e.message); return; }

  const agora = Date.now();
  for (const q of (data.data || [])) {
    const dnsId = extraiDnsId(q);
    if (!dnsId) continue;
    const chave = `${dnsId}|${q.time}|${q.question?.name}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    // heartbeat no máximo 1x por minuto por aparelho (não floodar o backend)
    if (agora - (ultimaBatida.get(dnsId) || 0) > 60000) {
      ultimaBatida.set(dnsId, agora);
      enviaBackend(dnsId, 'heartbeat');
    }
    if (foiBloqueado(q)) enviaBackend(dnsId, 'bloqueado', 'conteúdo adulto');
  }
  if (vistos.size > 5000) vistos.clear(); // limpa a memória de vez em quando
}

console.log(`Ponte DNS→Backend ativa. AdGuard ${AGH} → Backend ${BACKEND} (a cada ${INTERVALO_MS}ms)`);
setInterval(tick, INTERVALO_MS);
tick();
