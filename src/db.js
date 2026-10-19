// Camada de dados do Aliança.
// Para o protótipo, guardamos tudo num arquivo JSON. As funções abaixo são o
// "contrato" de persistência: na produção, troque o corpo delas por Postgres/
// Supabase sem mexer em mais nada do backend.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

const EMPTY = {
  users: {},         // usuários (titular e guardião)
  households: {},    // famílias
  devices: {},       // aparelhos protegidos
  events: {},        // histórico (tentativas, remoções, etc.)
  subscriptions: {}, // assinaturas
  messages: {},      // mensagens DENTRO do app (titular <-> guardião, e avisos)
};

function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) writeFileSync(DB_FILE, JSON.stringify(EMPTY, null, 2));
}
function load() {
  ensure();
  try {
    const raw = JSON.parse(readFileSync(DB_FILE, 'utf8'));
    return { ...structuredClone(EMPTY), ...raw };
  } catch { return structuredClone(EMPTY); }
}
function save(db) {
  ensure();
  const tmp = DB_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, DB_FILE);
}

// helper genérico para coleções simples
function makeCol(name) {
  return {
    get(id) { return load()[name][id] || null; },
    all() { return Object.values(load()[name]); },
    create(obj) {
      const d = load();
      const id = obj.id || randomUUID();
      d[name][id] = { id, criadoEm: new Date().toISOString(), ...obj };
      save(d);
      return d[name][id];
    },
    update(id, patch) {
      const d = load();
      if (!d[name][id]) return null;
      d[name][id] = { ...d[name][id], ...patch };
      save(d);
      return d[name][id];
    },
    where(pred) { return Object.values(load()[name]).filter(pred); },
  };
}

export const db = {
  _load: load,
  _save: save,
  id: () => randomUUID(),
  // id curto e único para o DNS identificar o aparelho (ex.: a1b2c3d4)
  dnsId: () => randomBytes(4).toString('hex'),
  // código de 6 dígitos para o cônjuge parear o aparelho na mesma conta
  codigoPareamento: () => String(Math.floor(100000 + Math.random() * 900000)),

  // usuários
  findUserByEmail(email) {
    const d = load();
    return Object.values(d.users).find(u => u.email === email.toLowerCase()) || null;
  },
  getUser(id) { return load().users[id] || null; },
  createUser(user) {
    const d = load();
    const id = user.id || randomUUID();
    d.users[id] = { id, criadoEm: new Date().toISOString(), ...user, email: user.email.toLowerCase() };
    save(d);
    return d.users[id];
  },
  updateUser(id, patch) {
    const d = load();
    if (!d.users[id]) return null;
    d.users[id] = { ...d.users[id], ...patch };
    save(d);
    return d.users[id];
  },

  // famílias
  getHousehold(id) { return load().households[id] || null; },
  createHousehold(h) {
    const d = load();
    const id = h.id || randomUUID();
    d.households[id] = { id, criadoEm: new Date().toISOString(), ...h };
    save(d);
    return d.households[id];
  },
  updateHousehold(id, patch) {
    const d = load();
    if (!d.households[id]) return null;
    d.households[id] = { ...d.households[id], ...patch };
    save(d);
    return d.households[id];
  },
  membersOf(householdId) {
    return Object.values(load().users).filter(u => u.householdId === householdId);
  },
  guardiaoDe(householdId) {
    const h = load().households[householdId];
    return h?.guardiaoId ? load().users[h.guardiaoId] : null;
  },

  // coleções novas
  devices: makeCol('devices'),
  events: makeCol('events'),
  subscriptions: makeCol('subscriptions'),
  messages: makeCol('messages'),

  householdByCodigo(codigo) {
    return Object.values(load().households).find(h => h.codigoPareamento === codigo) || null;
  },
  messagesFor(userId) {
    return this.messages.where(m => m.paraUsuarioId === userId).sort((a, b) => (a.ts < b.ts ? 1 : -1));
  },
  outroMembro(householdId, userId) {
    return this.membersOf(householdId).find(u => u.id !== userId) || null;
  },

  devicesOf(householdId) { return this.devices.where(x => x.householdId === householdId); },
  deviceByDnsId(dnsId) { return this.devices.where(x => x.dnsId === dnsId)[0] || null; },
  eventsOf(householdId) {
    return this.events.where(x => x.householdId === householdId)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1)); // mais novos primeiro
  },
  subscriptionOf(householdId) {
    return this.subscriptions.where(x => x.householdId === householdId)[0] || null;
  },
};
