// Demonstração da Parte 1 (fundação) com pareamento do cônjuge na mesma conta.
import { criaApp } from '../src/server.js';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
try { rmSync(join(here, '..', 'data', 'db.json')); } catch {}

const app = criaApp();
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;

const call = async (metodo, rota, corpo, token) => {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, body: await r.json() };
};
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗ FALHOU'}  ${msg}`); if (!cond) process.exitCode = 1; };

console.log('\n=== Aliança · Parte 1 — fundação (com pareamento) ===\n');

// 1. cadastro do titular
let r = await call('POST', '/auth/signup', { nome: 'Marcos', email: 'marcos@email.com', senha: 'segredo123', genero: 'ele' });
ok(r.status === 201 && r.body.token, '1. Marcos se cadastrou e recebeu token');
const token = r.body.token;

// 2. e-mail duplicado é barrado
r = await call('POST', '/auth/signup', { nome: 'Outro', email: 'marcos@email.com', senha: 'outrasenha123' });
ok(r.status === 409, '2. Cadastro com e-mail repetido foi barrado');

// 3/4. login
r = await call('POST', '/auth/login', { email: 'marcos@email.com', senha: 'errada' });
ok(r.status === 401, '3. Login com senha errada foi recusado');
r = await call('POST', '/auth/login', { email: 'marcos@email.com', senha: 'segredo123' });
ok(r.status === 200 && r.body.token, '4. Login correto devolveu token');

// 5. rota protegida sem token
r = await call('GET', '/me');
ok(r.status === 401, '5. /me sem token foi bloqueada');

// 6. /me com token
r = await call('GET', '/me', null, token);
ok(r.status === 200 && r.body.familia && !r.body.familia.temGuardiao, '6. /me devolveu o perfil (ainda sem guardião)');

// 7. PIN antes do pareamento é barrado
r = await call('POST', '/household/pin', { pin: '2580' }, token);
ok(r.status === 400, '7. Definir PIN antes do cônjuge parear foi barrado');

// 8. convidar guardião → gera código de pareamento
r = await call('POST', '/household/guardiao', { nome: 'Ana' }, token);
ok(r.status === 201 && /^\d{6}$/.test(r.body.codigoPareamento), '8. Convite gerou um código de pareamento de 6 dígitos');
const codigo = r.body.codigoPareamento;

// 9. cônjuge entra na MESMA conta com o código, pelo próprio aparelho
r = await call('POST', '/auth/guardiao/entrar', { codigo, email: 'ana@email.com', senha: 'senhadaana1' });
ok(r.status === 201 && r.body.token && r.body.usuario.papel === 'guardiao', '9. Ana pareou e entrou na mesma conta');
const tokenAna = r.body.token;

// 10. código errado é recusado
r = await call('POST', '/auth/guardiao/entrar', { codigo: '000000', email: 'x@email.com', senha: 'senha123' });
ok(r.status === 404, '10. Código de pareamento inválido foi recusado');

// 11. PIN válido (agora que o guardião pareou)
r = await call('POST', '/household/pin', { pin: '2580' }, token);
ok(r.status === 200, '11. PIN de 4 dígitos foi salvo após o pareamento');

// 12. estado final
r = await call('GET', '/me', null, tokenAna);
ok(r.body.familia.temGuardiao && r.body.familia.temPin && r.body.familia.membros.length === 2,
  '12. Família final: guardião pareado ✓, PIN ✓, 2 membros na mesma conta');

server.close();
console.log('\n=== fim da Parte 1 ===\n');
