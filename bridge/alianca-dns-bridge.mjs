#!/usr/bin/env node
/**
 * Ponte DNS do Aliança
 * --------------------
 * Lê o log de consultas do AdGuard Home, identifica BLOQUEIOS de conteúdo adulto
 * e avisa o backend (que, por sua vez, notifica o guardião — só categoria + horário,
 * NUNCA o endereço do site).
 *
 * Roda no mesmo servidor do AdGuard. Configurado por variáveis de ambiente (ver README).
 * Requer Node 18+ (usa fetch nativo).
 */

const ADGUARD_URL   = process.env.ADGUARD_URL   || 'http://127.0.0.1:3000';
const ADGUARD_USER  = process.env.ADGUARD_USER  || '';
const ADGUARD_PASS  = process.env.ADGUARD_PASS  || '';
const BACKEND_URL   = process.env.BACKEND_URL   || 'https://api.xn--aliana-0ua.app:8443';
const SERVICE_SECRET= process.env.SERVICE_SECRET|| '';
const HOUSEHOLD_ID  = process.env.HOUSEHOLD_ID  || '';
const POLL_SECONDS  = Number(process.env.POLL_SECONDS || 20);
// IDs das listas NSFW no AdGuard (Configurações → Listas de bloqueio). Vazio = usa heurística por nome.
const NSFW_FILTER_IDS = (process.env.NSFW_FILTER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!SERVICE_SECRET || !HOUSEHOLD_ID) {
  console.error('[aliança-bridge] Defina SERVICE_SECRET e HOUSEHOLD_ID. Veja o README.');
  process.exit(1);
}

const authHeader = (ADGUARD_USER || ADGUARD_PASS)
  ? 'Basic ' + Buffer.from(`${ADGUARD_USER}:${ADGUARD_PASS}`).toString('base64')
  : '';

// marca a última consulta já processada para não repetir
let ultimoTs = Date.now();

// heurística: nomes de listas/regras que indicam conteúdo adulto quando não há NSFW_FILTER_IDS
const PISTAS_ADULTO = ['nsfw', 'porn', 'adult', 'xxx', 'parental'];

function ehAdulto(entry) {
  if (NSFW_FILTER_IDS.length > 0) {
    return NSFW_FILTER_IDS.includes(String(entry.filterId));
  }
  const alvo = `${entry.rule || ''} ${entry.filterListName || ''}`.toLowerCase();
  return PISTAS_ADULTO.some(p => alvo.includes(p));
}

async function buscarBloqueios() {
  const url = `${ADGUARD_URL}/control/querylog?response_status=blocked&limit=50`;
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`AdGuard respondeu ${r.status}`);
  const json = await r.json();
  return json.data || [];
}

async function avisarBackend(categoria, ts) {
  const r = await fetch(`${BACKEND_URL}/dns/bloqueio-familia`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-service-secret': SERVICE_SECRET },
    body: JSON.stringify({ householdId: HOUSEHOLD_ID, categoria, ts }),
  });
  if (!r.ok) throw new Error(`Backend respondeu ${r.status}`);
}

async function ciclo() {
  try {
    const entradas = await buscarBloqueios();
    // AdGuard devolve do mais recente p/ o mais antigo
    const novas = entradas
      .filter(e => new Date(e.time).getTime() > ultimoTs)
      .filter(ehAdulto);
    if (novas.length > 0) {
      ultimoTs = Math.max(...entradas.map(e => new Date(e.time).getTime()));
      // agrupa: um aviso por ciclo (evita spam)
      await avisarBackend('conteúdo adulto', new Date().toISOString());
      console.log(`[aliança-bridge] ${novas.length} bloqueio(s) de conteúdo adulto → guardião avisado`);
    }
  } catch (e) {
    console.error('[aliança-bridge] erro:', e.message);
  }
}

console.log(`[aliança-bridge] iniciado. AdGuard=${ADGUARD_URL} backend=${BACKEND_URL} intervalo=${POLL_SECONDS}s`);
ciclo();
setInterval(ciclo, POLL_SECONDS * 1000);
