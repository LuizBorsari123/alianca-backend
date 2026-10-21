#!/usr/bin/env node
/**
 * Ponte DNS do Aliança (modo arquivo de log — sem credenciais)
 * -----------------------------------------------------------
 * Lê o querylog.json do AdGuard Home direto do disco, identifica BLOQUEIOS de
 * conteúdo adulto e avisa o backend (que notifica o guardião — só categoria +
 * horário, NUNCA o endereço do site).
 *
 * Roda no mesmo servidor do AdGuard. Requer Node 18+.
 */

import { readFileSync, statSync } from 'node:fs';

const QUERYLOG     = process.env.ADGUARD_QUERYLOG || '/home/ubuntu/adguard/work/data/querylog.json';
const BACKEND_URL  = process.env.BACKEND_URL      || 'https://api.xn--aliana-0ua.app:8443';
const SERVICE_SECRET = process.env.SERVICE_SECRET || '';
const HOUSEHOLD_ID = process.env.HOUSEHOLD_ID     || '';
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 20);
// opcional: IDs das listas NSFW no AdGuard. Vazio = conta qualquer bloqueio por lista/parental.
const NSFW_FILTER_IDS = (process.env.NSFW_FILTER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!SERVICE_SECRET || !HOUSEHOLD_ID) {
  console.error('[aliança-bridge] Defina SERVICE_SECRET e HOUSEHOLD_ID no /etc/alianca-bridge.env');
  process.exit(1);
}

// Razões de bloqueio do AdGuard: 3=lista de bloqueio, 5=controle parental, 8=serviço bloqueado
const RAZOES_BLOQUEIO = new Set([3, 5, 8]);
const PISTAS_ADULTO = ['nsfw', 'porn', 'adult', 'xxx', 'parental', 'sex'];

let ultimoTs = Date.now();

function ehAdulto(e) {
  const res = e.Result || {};
  if (!res.IsFiltered) return false;
  if (!RAZOES_BLOQUEIO.has(res.Reason)) return false;
  if (NSFW_FILTER_IDS.length > 0) {
    const fids = [];
    if (res.FilterID != null) fids.push(String(res.FilterID));
    for (const r of (res.Rules || [])) if (r.FilterListID != null) fids.push(String(r.FilterListID));
    return fids.some(f => NSFW_FILTER_IDS.includes(f));
  }
  // instância dedicada a bloquear adulto → qualquer bloqueio por lista/parental conta
  return true;
}

function lerEntradas() {
  let txt;
  try {
    const size = statSync(QUERYLOG).size;
    txt = readFileSync(QUERYLOG, 'utf8');
    if (txt.length > 500000) {
      txt = txt.slice(txt.length - 500000);
      const nl = txt.indexOf('\n');
      if (nl >= 0) txt = txt.slice(nl + 1); // descarta a 1ª linha parcial
    }
  } catch (e) {
    return [];
  }
  const out = [];
  for (const linha of txt.split('\n')) {
    if (!linha) continue;
    try { out.push(JSON.parse(linha)); } catch (e) { /* linha incompleta */ }
  }
  return out;
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
    const entradas = lerEntradas();
    let maiorTs = ultimoTs;
    let novas = 0;
    for (const e of entradas) {
      const t = e.T ? new Date(e.T).getTime() : 0;
      if (t > ultimoTs && ehAdulto(e)) novas++;
      if (t > maiorTs) maiorTs = t;
    }
    ultimoTs = maiorTs;
    if (novas > 0) {
      await avisarBackend('conteúdo adulto', new Date().toISOString());
      console.log(`[aliança-bridge] ${novas} bloqueio(s) de conteúdo adulto → guardião avisado`);
    }
  } catch (e) {
    console.error('[aliança-bridge] erro:', e.message);
  }
}

console.log(`[aliança-bridge] iniciado. log=${QUERYLOG} backend=${BACKEND_URL} intervalo=${POLL_SECONDS}s`);
ciclo();
setInterval(ciclo, POLL_SECONDS * 1000);
