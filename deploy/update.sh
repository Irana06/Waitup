#!/bin/sh
# Tarik update terbaru Waitup dari GitHub, install, build, lalu restart service.
# Pakai dari folder repo: sh deploy/update.sh
set -e

cd "$(dirname "$0")/.."
echo "==> git pull"
git pull --ff-only
echo "==> npm ci"
npm ci --no-audit --no-fund
echo "==> npm run build"
npm run build
echo "==> restart (butuh sudo)"
sudo systemctl restart waitup
echo "==> selesai: $(git log -1 --oneline)"
