# Ponte DNS do Aliança

Faz o AdGuard avisar o backend quando há um **bloqueio de conteúdo adulto**, para o
guardião receber o alerta "Tentativa bloqueada" (só categoria + horário, nunca o site).

Roda no **mesmo servidor** do AdGuard + backend. Requer Node 18+.

> Observação honesta: nesta versão, o alerta é em **nível de família** (não diz qual
> aparelho), porque o DNS hoje é compartilhado. Para dizer o aparelho exato, precisamos
> depois configurar **DNS por-dispositivo** (um ID de cliente por celular no AdGuard).

## 1. Descobrir o HOUSEHOLD_ID

No servidor, dentro da pasta do backend:

```
cd /opt/alianca-backend
grep -o '"id":"[^"]*"' data/households.json | head
```

(ou abra `data/households.json` e copie o `id` da sua família).

## 2. Pegar as credenciais do AdGuard

São o usuário e senha com que você entra no painel do AdGuard (porta 3000).

## 3. Instalar como serviço

```
# copie o script pra um lugar fixo
sudo mkdir -p /opt/alianca-bridge
sudo cp /opt/alianca-backend/bridge/alianca-dns-bridge.mjs /opt/alianca-bridge/

# crie o arquivo de ambiente (troque os valores)
sudo tee /etc/alianca-bridge.env >/dev/null <<'ENV'
ADGUARD_URL=http://127.0.0.1:3000
ADGUARD_USER=SEU_USUARIO_ADGUARD
ADGUARD_PASS=SUA_SENHA_ADGUARD
BACKEND_URL=https://api.xn--aliana-0ua.app:8443
SERVICE_SECRET=O_MESMO_SERVICE_SECRET_DO_BACKEND
HOUSEHOLD_ID=O_ID_DA_SUA_FAMILIA
POLL_SECONDS=20
# opcional: IDs das listas NSFW no AdGuard (Configurações → Listas de bloqueio)
# NSFW_FILTER_IDS=1,2
ENV

# serviço systemd
sudo tee /etc/systemd/system/alianca-bridge.service >/dev/null <<'UNIT'
[Unit]
Description=Aliança DNS bridge
After=network.target

[Service]
EnvironmentFile=/etc/alianca-bridge.env
ExecStart=/usr/bin/node /opt/alianca-bridge/alianca-dns-bridge.mjs
Restart=always
User=root

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now alianca-bridge
sudo systemctl status alianca-bridge --no-pager
```

## 4. Testar

Tente abrir um site adulto num aparelho protegido. Em até ~20s o guardião recebe o
alerta "Tentativa bloqueada" (no app, e como notificação).

Logs: `sudo journalctl -u alianca-bridge -f`

## Afinando o filtro

Se chegar alerta demais (bloqueios que não são adultos), preencha `NSFW_FILTER_IDS`
com os IDs das suas listas NSFW/parental do AdGuard. Sem isso, a ponte usa uma
heurística pelo nome da regra (`nsfw`, `porn`, `adult`, `xxx`, `parental`).
