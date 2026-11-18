#!/usr/bin/env bash
# SaudaGo one-shot installer for a fresh Ubuntu 22.04/24.04 VPS (OVHcloud VPS-1 or any).
# Run as root on the server:
#   bash ovh-install.sh yourdomain.com you@email.com  [git-repo-url]
# Leave the domain as "-" to run on the server IP over plain HTTP (no HTTPS).
set -euo pipefail

DOMAIN="${1:--}"
EMAIL="${2:-admin@example.com}"
REPO="${3:-https://github.com/mahbooburrahman/marketplace.git}"
APP_DIR=/opt/saudago
DB_NAME=saudago; DB_USER=saudago
DB_PASS="$(openssl rand -hex 16)"
ADMIN_PASS="$(openssl rand -base64 12 | tr -d '=+/')"
IP="$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')"

[ "$(id -u)" = 0 ] || { echo "Run as root (sudo -i)"; exit 1; }

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx postgresql ufw ca-certificates gnupg openssl certbot python3-certbot-nginx
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm i -g pm2

echo "==> Database"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"
npm install --no-audit --no-fund
npm run build

if [ "$DOMAIN" = "-" ]; then APP_URL="http://$IP"; else APP_URL="https://$DOMAIN"; fi
if [ ! -f server/.env ]; then
cat > server/.env <<ENV
NODE_ENV=production
PORT=4000
APP_URL=$APP_URL
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
DATABASE_SSL=false
AUTO_MIGRATE=true
TRUST_PROXY=true
ADMIN_EMAIL=$EMAIL
ADMIN_NAME=Site Administrator
ADMIN_PASSWORD=$ADMIN_PASS
STORAGE_DRIVER=local
UPLOAD_PUBLIC_DIR=/var/saudago/public
UPLOAD_PRIVATE_DIR=/var/saudago/private
DEV_OUTBOX=false
RATE_LIMIT_RELAXED=false
SMTP_HOST=
MAIL_FROM="SaudaGo <no-reply@${DOMAIN/#-/localhost}>"
PAYMENT_GATEWAY=none
ENV
  chmod 600 server/.env
fi
mkdir -p /var/saudago/public /var/saudago/private

echo "==> Start app (PM2)"
cd "$APP_DIR/server"
pm2 delete saudago >/dev/null 2>&1 || true
pm2 start dist/index.js --name saudago --time
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> Nginx"
cat > /etc/nginx/sites-available/saudago <<NGINX
server {
  listen 80;
  server_name ${DOMAIN/#-/_};
  client_max_body_size 25m;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 300s;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/saudago /etc/nginx/sites-enabled/saudago
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH >/dev/null; ufw allow 'Nginx Full' >/dev/null; ufw --force enable >/dev/null

if [ "$DOMAIN" != "-" ]; then
  echo "==> HTTPS (domain must already point to $IP)"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "Certbot failed: check the DNS A record, then run: certbot --nginx -d $DOMAIN"
fi

echo
echo "=============================================="
echo " SaudaGo is installed:  $APP_URL"
echo " Admin login:           $EMAIL"
echo " Admin password:        $ADMIN_PASS   (saved in $APP_DIR/server/.env)"
echo " Logs:                  pm2 logs saudago"
echo " Update later:          cd $APP_DIR && git pull && npm install && npm run build && pm2 restart saudago"
echo "=============================================="
