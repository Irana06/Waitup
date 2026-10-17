#!/bin/sh
# Pasang Waitup sebagai service systemd di belakang nginx + Cloudflare Tunnel.
# Jalankan sekali dengan sudo dari folder repo:
#   sudo sh deploy/install-homeserver.sh waitup.yushika.my.id
set -e

DOMAIN="${1:?Pakai: sudo sh deploy/install-homeserver.sh <domain>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
NODE="$(sudo -u "$APP_USER" sh -lc 'command -v node')"
[ -n "$NODE" ] || { echo "node tidak ketemu untuk user $APP_USER"; exit 1; }

echo "==> systemd service (user $APP_USER, node $NODE)"
sed -e "s|__APP_USER__|$APP_USER|g" -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__NODE__|$NODE|g" \
  "$APP_DIR/deploy/waitup.service" > /etc/systemd/system/waitup.service
systemctl daemon-reload
systemctl enable --now waitup
systemctl restart waitup

echo "==> nginx"
sed -e "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/waitup.nginx.conf" > /etc/nginx/sites-available/waitup
ln -sf /etc/nginx/sites-available/waitup /etc/nginx/sites-enabled/waitup
nginx -t
systemctl reload nginx

echo "==> cloudflared"
CFG=/etc/cloudflared/config.yml
if ! grep -q "$DOMAIN" "$CFG"; then
  cp "$CFG" "$CFG.bak-$(date +%Y%m%d%H%M%S)"
  sed -i "s|^\(\s*\)- service: http_status:404|\1- hostname: $DOMAIN\n\1  service: http://localhost:80\n&|" "$CFG"
fi
cloudflared tunnel --config "$CFG" ingress validate
systemctl restart cloudflared

sleep 2
systemctl --no-pager --lines=5 status waitup || true
echo "OK: https://$DOMAIN"
