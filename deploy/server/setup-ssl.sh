#!/usr/bin/env bash
# ============================================================
# 为站点部署 HTTPS（Let's Encrypt 免费证书 + 自动续期 + HTTP 301 跳转）
#   bash setup-ssl.sh 域名 [APP_NAME] [APP_DIR]
# 由 ./sb.sh <环境> ssl 域名 调用。前置：
#   1. 域名 A 记录已解析到本服务器公网 IP
#   2. 云厂商安全组已放行 80、443（证书 HTTP-01 校验依赖 80）
#   3. 本环境是「独立域名」部署（SITE_PATH 为空）；子路径部署时证书由共享域名的站点管理，本脚本会拒绝执行
# 完成后请把 deploy/envs/<环境>.env 的 CORS_ORIGINS 改为 https://域名 并重新发布
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

DOMAIN="${1:?用法: setup-ssl.sh 域名 [APP_NAME] [APP_DIR]}"
APP_NAME="${2:-systembase}"
APP_DIR="${3:-/opt/systembase}"
ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"
ENV_FILE="$APP_DIR/shared/.env"

# ---------- 前置检查 ----------
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "!! 域名格式不正确: $DOMAIN"; exit 1; }
# 本应用站点文件：Debian 系 sites-available，CentOS 系 conf.d
SITE="/etc/nginx/conf.d/$APP_NAME.conf"
[ -f "/etc/nginx/sites-available/$APP_NAME" ] && SITE="/etc/nginx/sites-available/$APP_NAME"
[ -f "$SITE" ] || { echo "!! 未找到 Nginx 站点配置 $SITE（请先执行 ./sb.sh <环境> init）"; exit 1; }
# 子路径模式：路由已注入共享域名的 443 块（复用其证书）。此时再对本站点申请证书，
# certbot 可能改写到共享站点的 server 块或产生重复的 listen 443，必须拒绝
SITE_PATH="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_PATH "" 2>/dev/null || true)"
if [ -n "$SITE_PATH" ]; then
  echo "!! 本环境为子路径部署（SITE_PATH=$SITE_PATH），HTTPS 证书由共享域名的站点管理，无需也不能在这里申请"
  echo "   如需独立 HTTPS：在 env 中清空 SITE_PATH、把 SITE_DOMAIN 改为独立子域名，发布后再执行 ssl"
  exit 1
fi

echo "==> [1/5] 安装 certbot"
if ! command -v certbot >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    # 腾讯云 OpenCloudOS 在 dnf.conf 中 exclude 了部分包，失败时用 --disableexcludes 重试
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
# 改写后的站点文件含 ssl_certificate，之后发布时 nginx-setup.sh 不会再覆盖它
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect

echo "==> [4/5] 自动续期"
# 续期成功后自动 reload nginx 让新证书生效；启用系统自带的续期定时器
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/usr/bin/env bash\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
systemctl enable --now certbot-renew.timer >/dev/null 2>&1 || systemctl enable --now certbot.timer >/dev/null 2>&1 || true
certbot renew --dry-run >/dev/null 2>&1 && echo "    续期演练通过" || echo "    （续期演练失败，不影响当前证书；可稍后 certbot renew --dry-run 排查）"

echo "==> [5/5] 验证"
nginx -t
echo -n "    https://$DOMAIN/api/health → "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "https://$DOMAIN/api/health" || true

# 提醒同步 CORS 白名单：前端改走 https 后，旧的 http 地址不在白名单会导致接口跨域失败
CORS="$(node "$ENV_TOOL" get "$ENV_FILE" CORS_ORIGINS 2>/dev/null || true)"
echo ""
echo "✓ HTTPS 部署完成: https://$DOMAIN/"
echo "  证书: /etc/letsencrypt/live/$DOMAIN/（到期前 30 天自动续期）"
case ",$CORS," in
  *",https://$DOMAIN,"*) ;;
  *) echo "  ⚠ 请把 deploy/envs/<环境>.env 的 CORS_ORIGINS 改为 https://$DOMAIN（当前: ${CORS:-未设置}），然后执行 ./sb.sh <环境> deploy" ;;
esac
