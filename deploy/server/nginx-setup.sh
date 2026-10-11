#!/usr/bin/env bash
# ============================================================
# Nginx 站点配置生成（服务器端，root 执行，幂等，可重复执行）
#   bash nginx-setup.sh APP_DIR APP_NAME ENV_FILE
# 由 setup-server.sh（init）与 remote-deploy.sh（每次发布）调用：
#   1. 生成 /etc/nginx/snippets/<APP_NAME>-locations.conf（API 反代/静态/SPA 路由）
#   2. 生成本应用站点 server 块（sites-available 或 conf.d；已配置 HTTPS 的不覆盖）
#   3. 配置了 SITE_PATH + SITE_DOMAIN 时，把路由片段注入该域名已有的 server 块
#      （如与本应用共用一台服务器的其他站点），实现 https://域名/子路径 访问
# 读取 env：PORT / SITE_PORT / SITE_DOMAIN / SITE_PATH
# 安全性：修改任何配置前先备份，nginx -t 失败自动还原，不影响线上
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
APP_DIR="${1:?用法: nginx-setup.sh APP_DIR APP_NAME ENV_FILE}"
APP_NAME="${2:?缺少 APP_NAME}"
ENV_FILE="${3:?缺少 ENV_FILE}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_TOOL="$HERE/env-tool.cjs"
[ "$(id -u)" = "0" ] || { echo "!! 请使用 root 执行"; exit 1; }
command -v nginx >/dev/null 2>&1 || { echo "!! 服务器未安装 nginx"; exit 1; }

PORT="$(node "$ENV_TOOL" get "$ENV_FILE" PORT 3000)"
SITE_PORT="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_PORT 80)"
SITE_DOMAIN="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_DOMAIN "")"
SITE_PATH="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_PATH "")"
[ -n "$SITE_PORT" ] || SITE_PORT=80
[ -n "$SITE_DOMAIN" ] || SITE_DOMAIN="_"

# SITE_PATH 规范化：以 / 开头、不以 / 结尾；留空 = 根路径部署
if [ -n "$SITE_PATH" ]; then
  case "$SITE_PATH" in /*) ;; *) SITE_PATH="/$SITE_PATH" ;; esac
  SITE_PATH="${SITE_PATH%/}"
  [[ "$SITE_PATH" =~ ^/[A-Za-z0-9._-]+$ ]] || { echo "!! SITE_PATH 格式不正确: '$SITE_PATH'（形如 /systembase-pre）"; exit 1; }
fi

SNIPPET_DIR=/etc/nginx/snippets
SNIPPET="$SNIPPET_DIR/$APP_NAME-locations.conf"
mkdir -p "$SNIPPET_DIR"

# ---------- 备份/还原：nginx -t 失败时恢复所有被修改的文件 ----------
BACKUPS=""
backup() { [ -f "$1" ] || return 0; cp -a "$1" "$1.sb-bak"; BACKUPS="$BACKUPS $1"; }
restore_all() {
  local f
  for f in $BACKUPS; do [ -f "$f.sb-bak" ] && mv -f "$f.sb-bak" "$f"; done
}
clean_bak() { local f; for f in $BACKUPS; do rm -f "$f.sb-bak"; done; }

# ---------- 1. 路由片段（前缀/端口/目录随 env 变化，每次重新生成） ----------
backup "$SNIPPET"
sed -e "s#__PREFIX__#$SITE_PATH#g" -e "s#__PORT__#$PORT#g" -e "s#__APP_DIR__#$APP_DIR#g" \
  < "$HERE/nginx-locations.conf" | tr -d '\r' > "$SNIPPET"
echo "    路由片段: $SNIPPET（路径前缀: ${SITE_PATH:-/} → 后端 127.0.0.1:$PORT）"

# ---------- 2. 本应用站点 server 块 ----------
SITE_CONF="$(mktemp)"
sed -e "s#__LISTEN__#$SITE_PORT#g" -e "s#__SERVER_NAME__#$SITE_DOMAIN#g" -e "s#__APP_NAME__#$APP_NAME#g" \
  < "$HERE/nginx-site.conf" | tr -d '\r' > "$SITE_CONF"
install_site() {  # $1 = 目标文件
  # 已配置过 HTTPS（certbot 改写过）的站点不覆盖，避免丢失证书配置
  if [ -f "$1" ] && grep -q "ssl_certificate" "$1"; then
    echo "    已存在 HTTPS 站点配置，保留不覆盖: $1"
  else
    backup "$1"
    cat "$SITE_CONF" > "$1"
    echo "    站点配置: $1（监听 :$SITE_PORT  域名: $SITE_DOMAIN）"
  fi
}
if [ -d /etc/nginx/sites-available ]; then
  install_site "/etc/nginx/sites-available/$APP_NAME"
  ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  rm -f /etc/nginx/sites-enabled/default
else
  install_site "/etc/nginx/conf.d/$APP_NAME.conf"
  if [ -f /etc/nginx/conf.d/default.conf ]; then
    backup /etc/nginx/conf.d/default.conf
    rm -f /etc/nginx/conf.d/default.conf
  fi
fi
rm -f "$SITE_CONF"

# ---------- 3. 共享域名注入（SITE_PATH 子路径方式） ----------
inject_include() {
  # $1=配置文件  $2=域名(正则已转义)  $3=1 只注入监听 443 的块 / 0 任意块
  # awk 按大括号配对解析 server 块，仅向「server_name 含该域名」的块内插入 include 行
  local tmp; tmp="$(mktemp)"
  awk -v inc="    include $SNIPPET; # managed by systembase($APP_NAME)" -v dom="$2" -v ssl="$3" '
    BEGIN { inblk = 0; depth = 0; changed = 0 }
    {
      if (!inblk && $0 ~ /server[ \t]*[{]/) {
        inblk = 1; buf = $0
        depth = gsub(/[{]/, "{") - gsub(/[}]/, "}")
        if (depth <= 0) { call_flush(buf); inblk = 0 }
        next
      }
      if (inblk) {
        buf = buf "\n" $0
        depth += gsub(/[{]/, "{") - gsub(/[}]/, "}")
        if (depth <= 0) { call_flush(buf); inblk = 0 }
        next
      }
      print
    }
    function call_flush(b) {
      ok = (b ~ ("server_name[^;]*" dom))
      if (ok && ssl == 1) ok = (b ~ /listen[^;]*443/)
      if (ok) { sub(/[}][[:space:]]*$/, inc "\n}", b); changed = 1 }
      print b
    }
    END { exit changed ? 0 : 1 }
  ' "$1" > "$tmp" || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$1" && rm -f "$tmp"
  return 0
}

INJECTED=0
if [ -n "$SITE_PATH" ] && [ "$SITE_DOMAIN" != "_" ]; then
  DOMAIN_RE="$(printf '%s' "$SITE_DOMAIN" | sed 's/[.]/\\./g')"
  # 候选：声明了该域名、且不是本应用自己的配置文件。优先注入 443 块（80 块常是
  # certbot 的 301 跳转，注入会让 HTTP 也直出内容）；一个都没有再放宽到任意块
  for pass in 1 0; do
    INJECTED=0
    for f in /etc/nginx/conf.d/*.conf /etc/nginx/sites-available/*; do
      [ -f "$f" ] || continue
      case "$f" in */"$APP_NAME".conf|*/"$APP_NAME") continue ;; esac
      grep -qE "server_name[^;]*$DOMAIN_RE" "$f" || continue
      if grep -qF "include $SNIPPET;" "$f"; then INJECTED=1; continue; fi   # 之前已注入过
      backup "$f"
      if inject_include "$f" "$DOMAIN_RE" "$pass"; then
        echo "    已注入路由片段 → $f（域名 $SITE_DOMAIN 的 server 块）"
        INJECTED=1
      else
        rm -f "$f.sb-bak"   # 该文件没有匹配的块，去掉多余备份
      fi
    done
    [ "$INJECTED" = 1 ] && break
  done
  if [ "$INJECTED" = 0 ]; then
    echo "    !! 未找到域名 $SITE_DOMAIN 的 server 块，无法挂载子路径 $SITE_PATH"
    echo "       请确认该域名已在 Nginx 配置（如已配置 HTTPS），或改用独立子域名 + ./sb.sh <env> ssl <域名>"
  fi
fi

# ---------- 校验并生效（失败自动还原，不影响线上） ----------
if ! nginx -t; then
  restore_all
  echo "!! nginx -t 校验失败，已还原全部被修改的配置（线上未受影响）"
  exit 1
fi
# nginx 未运行时（首次 init）直接启动，否则平滑重载
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl enable --now nginx >/dev/null 2>&1 || true
fi
clean_bak
