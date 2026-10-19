# Camada de DNS (o que de fato bloqueia)

O bloqueio acontece aqui, no servidor de DNS, não no celular. O celular só é
apontado para este servidor. Usamos o **AdGuard Home** (open source), que já
resolve o mais difícil: identificar cada aparelho, aplicar listas por aparelho e
manter um log consultável.

## Como as peças se ligam

```
Celular (DNS-over-TLS, client id = dnsId)
        │  a1b2c3d4.dns.aliancaapp.com.br
        ▼
AdGuard Home  ──(log de consultas)──►  bridge.mjs  ──►  Backend  /dns/evento
   bloqueia                               lê o log         registra + avisa o guardião
```

1. O **app** configura o DNS privado do Android apontando para
   `<dnsId>.dns.aliancaapp.com.br` (o `dnsId` vem do backend ao provisionar o
   aparelho, na rota `POST /devices`).
2. O **AdGuard Home** recebe as consultas, bloqueia conteúdo adulto (ver
   `blocklists.md`) e identifica o aparelho pelo client id.
3. A **ponte** (`bridge.mjs`) lê o log do AdGuard e reenvia ao backend: sinal de
   vida a cada consulta e um aviso a cada tentativa bloqueada.
4. O **backend** registra e avisa o guardião — só categoria e horário.

## Rodar em desenvolvimento

```bash
# 1. backend
npm start

# 2. servidor de DNS
cd dns && docker compose up -d        # painel em http://localhost:3001

# 3. no painel: crie usuário/senha, adicione as listas (blocklists.md),
#    importe custom-bloqueio.txt, ligue a busca segura.

# 4. ponte DNS → backend
AGH_USER=admin AGH_PASS=suasenha node dns/bridge.mjs
```

Sem Docker à mão, dá para testar o backend sozinho com o simulador:
`node tools/simula-dns.mjs <dnsId>` (faz o papel do AdGuard).

## Produção (o desenvolvedor assume)

- Registrar `dns.aliancaapp.com.br` e emitir certificado TLS (wildcard
  `*.dns.aliancaapp.com.br`), para o DNS-over-TLS com client id funcionar.
- Rodar o AdGuard Home num VPS no Brasil (ex.: São Paulo), com as portas 853
  (DoT) e 443 (DoH) abertas.
- Trocar a ponte por polling confiável do log (ou pela API de streaming), com
  reinício automático.
- Guardar o mínimo no log por pouco tempo (LGPD) — categoria e horário, nunca o
  domínio cheio do lado do backend.
