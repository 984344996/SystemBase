#!/usr/bin/env bash
# ============================================================
# 为站点部署 HTTPS（Let's Encrypt 免费证书 + 自动续期 + HTTP 301 跳转）
#   bash setup-ssl.sh 域名 [APP_NAME] [APP_DIR]
# 前置：
#   1. 域名 A 记录已解析到本服务器公网 IP
#   2. 云厂商安全组已放行 80、443（证书 HTTP-01 校验依赖 80）
# 完成后请把 shared/.env 的 CORS_ORIGINS 改为 https://域名 并重新部署
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

DOMAIN="${1:?用法: setup-ssl.sh 域名 [APP_NAME] [APP_DIR]}"
APP_NAME="${2:-systembase}"
APP_DIR="${3:-/opt/systembase}"

[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "!! 域名格式不正确: $DOMAIN"; exit 1; }
SITE="/etc/nginx/conf.d/$APP_NAME.conf"
[ -f "/etc/nginx/sites-available/$APP_NAME" ] && SITE="/etc/nginx/sites-available/$APP_NAME"
[ -f "$SITE" ] || { echo "!! 未找到 Nginx 站点配置 $SITE（请先执行 ./deploy.sh init）"; exit 1; }

echo "==> [1/5] 安装 certbot"
if ! command -v certbot >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx || dnf install -y --disableexcludes=main certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y epel-release && yum install -y certbot python3-certbot-nginx
  else
    echo "!! 未找到 apt/dnf/yum，请手动安装 certbot"; exit 1
  fi
fi
certbot --version

echo "==> [2/5] 站点 server_name 设为 $DOMAIN（HTTP-01 校验需要请求路由到本站点）"
if ! grep -qE "server_name[[:space:]]+$DOMAIN;" "$SITE"; then
  sed -i "s/server_name .*/server_name $DOMAIN;/" "$SITE"
  nginx -t && systemctl reload nginx
fi

echo "==> [3/5] 申请并安装证书（certbot 自动改写站点配置 + 301 跳转）"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "==> [4/5] 自动续期"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/usr/bin/env bash\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || systemctl enable --now certbot.timer >/dev/null 2>&1 || true
certbot renew --dry-run >/dev/null 2>&1 && echo "    续期演练通过" || echo "    （续期演练失败，不影响当前证书；可稍后 certbot renew --dry-run 排查）"

echo "==> [5/5] 验证"
nginx -t
echo -n "    https://$DOMAIN/api/health → "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "https://$DOMAIN/api/health" || true

CORS="$(node "$APP_DIR/current/deploy/server/env-tool.cjs" get "$APP_DIR/shared/.env" CORS_ORIGINS 2>/dev/null || true)"
echo ""
echo "✓ HTTPS 部署完成: https://$DOMAIN/"
echo "  证书: /etc/letsencrypt/live/$DOMAIN/（到期前 30 天自动续期）"
case ",$CORS," in
  *",https://$DOMAIN,"*) ;;
  *) echo "  ⚠ 请把本地 apps/server/.env.production 的 CORS_ORIGINS 改为 https://$DOMAIN（当前: ${CORS:-未设置}），然后重新执行 ./deploy.sh" ;;
esac
