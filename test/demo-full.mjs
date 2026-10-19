// Demonstração das Partes 2–5 + decisões novas: mensagens dentro do app e Asaas.
process.env.CARENCIA_CANCEL_MS = '250';
process.env.JANELA_REMOCAO_MS = '1800000';

import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
try { rmSync(join(here, '..', 'data', 'db.json')); } catch {}

const { criaApp } = await import('../src/server.js');
const server = criaApp().listen(0);
const base = `http://localhost:${server.address().port}`;
const SEG = 'servico-prototipo-trocar';
const ASAAS = 'asaas-prototipo-trocar';

const call = async (metodo, rota, corpo, { token, servico, asaas } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (servico) headers['x-service-secret'] = SEG;
  if (asaas) headers['asaas-access-token'] = ASAAS;
  const r = await fetch(base + rota, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗ FALHOU'}  ${msg}`); if (!cond) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('\n=== Aliança · Partes 2–5 + decisões novas ===\n');

// preparar família: titular + guardião pareado na mesma conta
let r = await call('POST', '/auth/signup', { nome: 'Marcos', email: 'm@e.com', senha: 'segredo123', genero: 'ele' });
const token = r.body.token;
const hid = (await call('GET', '/me', null, { token })).body.usuario.householdId;
const codigo = (await call('POST', '/household/guardiao', { nome: 'Ana' }, { token })).body.codigoPareamento;
const tokenAna = (await call('POST', '/auth/guardiao/entrar', { codigo, email: 'ana@e.com', senha: 'senhaana1' }, {})).body.token;
await call('POST', '/household/pin', { pin: '2580' }, { token });

console.log('— Parte 2: aparelhos e o olho do DNS —');
r = await call('POST', '/devices', { nome: 'Celular do Marcos' }, { token });
ok(r.status === 201 && /\.dns\.aliancaapp\.com\.br$/.test(r.body.dnsConfig.hostname), '1. Aparelho provisionado com ID de DNS');
const dev = r.body.aparelho;
r = await call('POST', '/dns/evento', { dnsId: dev.dnsId, tipo: 'bloqueado' }, { servico: true });
ok(r.status === 200, '2. DNS registrou tentativa bloqueada');
r = await call('POST', '/dns/evento', { dnsId: dev.dnsId, tipo: 'bloqueado' }, {});
ok(r.status === 403, '3. Ponto do DNS negado sem o segredo de serviço');
const agora31 = new Date(Date.now() + 31 * 60 * 1000).toISOString();
await call('POST', `/devices/${dev.id}/app-heartbeat`, { ts: agora31 }, { servico: true });
r = await call('POST', '/admin/varredura', { agora: agora31 }, { servico: true });
ok(r.body.alertados.includes(dev.id), '4. Varredura detectou remoção e alertou');

console.log('\n— Alertas e convite DENTRO do app (sem WhatsApp, sem chat) —');
// a Ana (guardiã) recebe os alertas como mensagens internas
r = await call('GET', '/messages', null, { token: tokenAna });
ok(r.body.naoLidas >= 2, '5. Ana recebeu os alertas como mensagens no app');
const primeira = r.body.mensagens[0];
r = await call('POST', `/messages/${primeira.id}/lida`, null, { token: tokenAna });
ok(r.status === 200, '6. Marcar mensagem como lida funcionou');
// convite da noite a sós: Marcos convida, Ana aceita com horário
r = await call('POST', '/convite', null, { token });
ok(r.status === 201 && r.body.convite.estado === 'pendente', '7. Marcos enviou o convite da noite a sós');
r = await call('POST', '/convite/responder', { aceita: true, quando: 'hoje à noite' }, { token: tokenAna });
ok(r.status === 200 && r.body.convite.estado === 'aceito' && r.body.convite.quando === 'hoje à noite', '8. Ana aceitou o convite com horário');
r = await call('GET', '/messages', null, { token });
ok(r.body.mensagens.some(m => m.tipo === 'convite' && m.corpo.includes('hoje à noite')), '8b. Marcos recebeu a resposta no app');

console.log('\n— Dependentes (filhos) na mesma conta —');
r = await call('POST', '/household/dependente', { nome: 'Júlia', idade: 14 }, { token });
ok(r.status === 201 && r.body.dependente.papel === 'dependente', '8c. Dependente (Júlia, 14) adicionada à família');
r = await call('POST', '/devices', { nome: 'Celular da Júlia', donoId: r.body.dependente.id }, { token });
ok(r.status === 201, '8d. Aparelho da dependente provisionado pelos pais');

console.log('\n— Parte 3: caminhada —');
r = await call('GET', '/journey', null, { token });
ok(r.body.diasFirmes === 0 && r.body.proximoMarco === 7 && r.body.meta === 90, '9. Caminhada: 0 dias, marco 7, meta 90');

console.log('\n— Parte 4: cancelamento, logout, reset —');
r = await call('POST', '/subscription/cancelar', null, { token });
ok(r.status === 200 && r.body.cancelamento.estado === 'carencia', '10. Cancelamento abriu a janela de espera');
r = await call('POST', '/subscription/cancelar/confirmar', null, { token });
ok(r.status === 425, '11. Confirmar antes da espera foi barrado');
await sleep(300);
r = await call('POST', '/subscription/cancelar/confirmar', null, { token });
ok(r.status === 200 && r.body.protecaoAte, '12. Após a espera, cancelamento confirmado');
r = await call('POST', '/auth/logout', { pin: '0000' }, { token });
ok(r.status === 403, '13. Sair com senha errada do guardião foi negado');
r = await call('POST', '/auth/logout', { pin: '2580' }, { token });
ok(r.status === 200, '14. Sair com a senha do guardião funcionou');
r = await call('POST', '/support/reset-pin', { householdId: hid, novoPin: '1357' }, { servico: true });
ok(r.status === 200, '15. Suporte redefiniu o PIN (reset só pelo suporte)');

console.log('\n— Parte 5: pagamento com Asaas —');
// webhook do Asaas confirma o pagamento (externalReference = householdId)
r = await call('POST', '/billing/asaas/webhook', { event: 'PAYMENT_CONFIRMED', payment: { externalReference: hid, customer: 'cus_123' } }, { asaas: true });
ok(r.status === 200, '16. Webhook do Asaas (PAYMENT_CONFIRMED) processado');
r = await call('POST', '/billing/asaas/webhook', { event: 'PAYMENT_CONFIRMED', payment: { externalReference: hid } }, {});
ok(r.status === 403, '17. Webhook do Asaas sem token foi negado');
r = await call('GET', '/subscription', null, { token });
ok(r.body.assinatura.estado === 'ativa' && r.body.assinatura.vigenteAte, '18. Assinatura ativa e com validade após o Asaas');
// assinar dentro do app sem a chave do Asaas responde de forma clara
r = await call('POST', '/billing/assinar', { cpfCnpj: '12345678900', plano: 'anual' }, { token });
ok(r.status === 503, '19. /billing/assinar avisa que o Asaas não está configurado (sem a chave)');

const { db } = await import('../src/db.js');
console.log(`\nMensagens internas geradas: ${db.messages.all().length}`);

server.close();
console.log('\n=== fim ===\n');
