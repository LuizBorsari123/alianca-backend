// Simulador do servidor de DNS para desenvolvimento.
// Representa o AdGuard Home chamando o backend: manda consultas (heartbeat) e,
// de vez em quando, uma tentativa bloqueada. Rode com o backend no ar:
//   node src/server.js
//   node tools/simula-dns.mjs <dnsId>
const base = process.env.BASE || 'http://localhost:3000';
const SEG = process.env.SERVICE_SECRET || 'servico-prototipo-trocar';
const dnsId = process.argv[2];
if (!dnsId) { console.error('uso: node tools/simula-dns.mjs <dnsId>'); process.exit(1); }

async function evento(tipo) {
  const r = await fetch(base + '/dns/evento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-service-secret': SEG },
    body: JSON.stringify({ dnsId, tipo, categoria: 'conteúdo adulto' }),
  });
  console.log(tipo, '→', r.status);
}

console.log(`Simulando DNS para ${dnsId} (Ctrl+C para parar)`);
setInterval(() => evento('heartbeat'), 5000);       // consultas normais a cada 5s
setInterval(() => evento('bloqueado'), 17000);      // uma tentativa a cada 17s
evento('heartbeat');
