# Aliança — Backend (o cérebro)

Servidor que faz a ideia funcionar. É o centro do sistema: o app, o servidor de
DNS, o pagamento e o WhatsApp conversam com ele. Por isso foi construído
primeiro e de forma independente — onde cada peça externa encosta, existe um
ponto de entrada e, no protótipo, um simulador.

**Partes 1 a 5 construídas e testadas** (28 testes automáticos passando).

## Como rodar (qualquer computador com Node 18+)

```bash
npm install
npm start            # sobe em http://localhost:3000
npm run demo         # Parte 1 — fundação (12 testes)
npm run demo:full    # Partes 2–5 (16 testes)
```

Para ver o DNS alimentando o sistema ao vivo: suba o servidor, crie um aparelho
(rota `POST /devices`) e rode `node tools/simula-dns.mjs <dnsId>`.

## O que já funciona

**Parte 1 — Fundação:** cadastro do titular, login, convite do guardião, PIN de
proteção. Senha com hash, sessão por token, e-mail único, um guardião por
família, PIN só depois do guardião.

**Parte 2 — Aparelhos e o olho do DNS:** cada aparelho ganha um ID único de DNS
(`<id>.dns.aliancaapp.com.br`). O servidor de DNS avisa o backend a cada
consulta (sinal de vida) e a cada tentativa bloqueada. Uma varredura detecta
quando a proteção cai com o celular ainda ligado e avisa o guardião — só com a
categoria e o horário, **nunca** o endereço do site.

**Parte 3 — A caminhada:** dias firmes, metas (7/21/66/90), histórico de eventos
e contadores da semana. Registro de recaída que recomeça a contagem.

**Parte 4 — Cancelamento, logout e reset:** cancelar abre uma espera de 30 min e
avisa o guardião; confirmar só depois da espera (72h de carência); sair da conta
exige a senha do guardião; **o PIN só é redefinido pelo suporte** (não existe
rota de usuário para trocar — evita burla).

**Parte 5 — Pagamento:** webhook do gateway (pago / vencido / falha), troca de
plano e status da assinatura.

## Mapa das rotas

| Papel | Rota | Quem chama |
| --- | --- | --- |
| Conta | `POST /auth/signup`, `POST /auth/login`, `GET /me`, `POST /auth/logout` | App |
| Pareamento | `POST /household/guardiao` (gera código), `POST /auth/guardiao/entrar` (cônjuge entra na mesma conta) | App |
| Família | `POST /household/pin` | App |
| Dependentes | `POST /household/dependente`, `GET /household/dependentes` | App |
| Alertas no app | `GET /messages`, `POST /messages/:id/lida` | App |
| Convite noite a sós | `POST /convite`, `POST /convite/responder`, `GET /convite` | App |
| Aparelhos | `POST /devices`, `GET /devices` | App |
| DNS | `POST /dns/evento`, `POST /devices/:id/app-heartbeat`, `POST /admin/varredura` | Servidor de DNS / cron (segredo de serviço) |
| Caminhada | `GET /journey`, `POST /journey/recaida` | App |
| Assinatura | `POST /subscription/cancelar[/confirmar\|/desistir]`, `GET /subscription`, `POST /subscription/plano` | App |
| Pagamento | `POST /billing/assinar` (cria assinatura + Pix no app), `POST /billing/asaas/webhook` | App / Asaas |
| Suporte | `POST /support/reset-pin` | Suporte (segredo de serviço) |

Decisões de produto já no backend: **não é app de conversa** — a única interação
do casal é o convite da noite a sós (aceita/recusa), além dos alertas, tudo dentro
do app, sem WhatsApp; **o casal compartilha uma conta** (o cônjuge entra pelo
próprio aparelho com um código de pareamento) e **os dependentes (filhos)** entram
como membros gerenciados pelos pais; **pagamento pelo Asaas dentro do app**
(`/billing/assinar` gera o Pix; o webhook liga a cobrança à família por
`externalReference = householdId`). A chave do Asaas vai em `ASAAS_API_KEY`.

Pontos de **serviço** (DNS, pagamento, suporte) não usam token de usuário; usam
o cabeçalho `x-service-secret`. Pontos de **app** usam `Authorization: Bearer`.

## Estrutura

```
src/db.js            Camada de dados (JSON no protótipo → Postgres/Supabase na produção)
src/auth.js          Hash de senha e token
src/config.js        Janelas de tempo, metas e segredo de serviço
src/notify.js        Aviso ao guardião (STUB → trocar pelo WhatsApp/push)
src/server.js        Conta e família (Parte 1) + monta as demais
src/routes/          devices (2) · journey (3) · lifecycle (4) · billing (5)
tools/simula-dns.mjs Simulador do servidor de DNS
test/                Demonstrações ponta a ponta
```

## O que falta para produção (o desenvolvedor assume daqui)

1. Trocar `src/db.js` por Postgres/Supabase e os segredos por variáveis de ambiente.
2. Somar push (FCM) para a entrega imediata das mensagens internas (o conteúdo já
   vive no app, via `GET /messages`; o push é só o "toque" no celular).
3. Subir o servidor de DNS (AdGuard Home) apontando o `/dns/evento` para cá.
4. Construir o app Android que consome esta API (com a trava de administrador do
   dispositivo) e publicá-lo na Play Store.
5. Ligar o Asaas ao `/billing/asaas/webhook` e criar a cobrança com
   `externalReference = householdId`.
6. Agendar a varredura (`POST /admin/varredura`) como um cron a cada poucos minutos.
