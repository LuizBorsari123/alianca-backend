#!/usr/bin/env bash
# Instalador do backend do Aliança no servidor Ubuntu.
# Sobe a API em HTTPS na porta 8443, com certificado próprio, como serviço que
# reinicia sozinho. Não mexe no AdGuard (só pausa por segundos para emitir o
# certificado). Rode com:  bash deploy.sh
set -euo pipefail

API_HOST="api.xn--aliana-0ua.app"
APP_DIR="/opt/alianca-backend"
REPO="https://github.com/LuizBorsari123/alianca-backend"
PORT=8443
EMAIL="buscandocristo.com.br@gmail.com"
ADGUARD_COMPOSE="/home/ubuntu/adguard/docker-compose.yml"

echo ">> 1/6 Instalando o Node.js 20..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo ">> 2/6 Baixando o código do backend..."
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin main && git -C "$APP_DIR" reset --hard origin/main
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm install --omit=dev

echo ">> 3/6 Emitindo o certificado para $API_HOST..."
if ! sudo test -d "/etc/letsencrypt/live/$API_HOST"; then
  sudo certbot certonly --standalone -d "$API_HOST" \
    --agree-tos --no-eff-email -m "$EMAIL" \
    --pre-hook  "docker compose -f $ADGUARD_COMPOSE stop" \
    --post-hook "docker compose -f $ADGUARD_COMPOSE start"
fi

echo ">> 4/6 Escrevendo as variáveis de ambiente..."
if [ ! -f /etc/alianca-backend.env ]; then
  sudo tee /etc/alianca-backend.env >/dev/null <<EOF
PORT=$PORT
CERT_FULLCHAIN=/etc/letsencrypt/live/$API_HOST/fullchain.pem
CERT_KEY=/etc/letsencrypt/live/$API_HOST/privkey.pem
JWT_SECRET=$(openssl rand -hex 32)
SERVICE_SECRET=$(openssl rand -hex 24)
ASAAS_ENV=prod
ASAAS_API_KEY=COLOQUE_SUA_CHAVE_ASAAS_AQUI
ASAAS_WEBHOOK_TOKEN=$(openssl rand -hex 16)
SUPORTE_EMAIL=$EMAIL
EOF
  echo "   (arquivo /etc/alianca-backend.env criado — depois coloque sua chave Asaas nele)"
else
  echo "   (já existe /etc/alianca-backend.env — mantido)"
fi

echo ">> 5/6 Criando o serviço que roda sozinho..."
sudo tee /etc/systemd/system/alianca-backend.service >/dev/null <<EOF
[Unit]
Description=Alianca Backend
After=network.target

[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=/etc/alianca-backend.env
ExecStart=/usr/bin/node src/start.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable alianca-backend
sudo systemctl restart alianca-backend

echo ">> 6/6 Liberando a porta $PORT no firewall..."
sudo iptables -C INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT
sudo netfilter-persistent save >/dev/null 2>&1 || true

sleep 2
echo ""
echo "============================================================"
echo " Backend instalado. Status:"
systemctl is-active alianca-backend && echo " -> ativo em https://$API_HOST:$PORT"
echo ""
echo " FALTA:"
echo "  1) Abrir a porta $PORT na Oracle (painel, como fizemos antes)."
echo "  2) Colocar sua chave Asaas em /etc/alianca-backend.env e reiniciar:"
echo "     sudo nano /etc/alianca-backend.env   (edite ASAAS_API_KEY)"
echo "     sudo systemctl restart alianca-backend"
echo "============================================================"
