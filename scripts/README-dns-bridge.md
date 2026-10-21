# Ponte DNS → backend (alerta "tentativa bloqueada")

Leva ao guardião o aviso de que houve uma tentativa bloqueada (categoria + horário).

## Rodar no servidor (onde está o AdGuard)
```bash
cd /opt/alianca-backend
ADGUARD_URL=http://127.0.0.1:3000 \
ADGUARD_USER=<usuario> ADGUARD_PASS=<senha> \
BACKEND_URL=https://api.xn--aliana-0ua.app:8443 \
SERVICE_SECRET=<segredo de serviço do backend> \
ALIANCA_DNS_ID=<dnsId do aparelho> \
node scripts/dns-bridge.js
```
Para rodar sempre, crie um serviço systemd apontando para esse comando.

## Evolução (atribuição por aparelho)
Hoje os eventos vão para um único `ALIANCA_DNS_ID`. Para dizer de qual celular
veio a tentativa, cada aparelho precisa usar um DoH com ID próprio no AdGuard
(DNS-over-HTTPS por-cliente). Quando fizermos isso, o app passa o ID do aparelho
e o script mapeia cliente → dnsId.
