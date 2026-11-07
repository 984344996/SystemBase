#!/usr/bin/env bash
# ============================================================
# Nginx 站点配置生成（服务器端，root 执行，幂等，可重复执行）
#   bash nginx-setup.sh APP_DIR APP_NAME ENV_FILE
# 由 setup-server.sh（init）、remote-deploy.sh（每次发布）、ops.sh（rollback）调用：
#   1. 生成 /etc/nginx/snippets/<APP_NAME>-locations.conf（API 反代 / 静态资源 / SPA 路由）
#   2. 生成本应用站点 server 块（sites-available 或 conf.d；已配置 HTTPS 的不覆盖）
#   3. 配置了 SITE_PATH + SITE_DOMAIN 时，把路由片段 include 进该域名已有的 server 块
#      （如与本应用共用一台服务器的其他站点），实现 https://域名/子路径 访问；
#      注入前先清理本应用以前注入过的 include（域名/子路径改过时旧注入不会残留）
# 读取 env：PORT / SITE_PORT / SITE_DOMAIN / SITE_PATH
# 安全性：修改任何文件前先备份，nginx -t 失败自动还原全部文件，不影响线上
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

# ---------- 读取站点参数 ----------
PORT="$(node "$ENV_TOOL" get "$ENV_FILE" PORT 3000)"              # 后端端口（反代目标）
SITE_PORT="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_PORT 80)"      # Nginx 监听端口
SITE_DOMAIN="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_DOMAIN "")"  # server_name
SITE_PATH="$(node "$ENV_TOOL" get "$ENV_FILE" SITE_PATH "")"      # 子路径前缀
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
MARK="# managed by systembase($APP_NAME)"   # 注入行的尾注释，用于识别与清理
mkdir -p "$SNIPPET_DIR"

# ---------- 备份 / 还原：nginx -t 失败时恢复本次修改过的所有文件 ----------
BACKUPS=""   # 被修改的文件（同目录 .sb-bak 备份）
MOVED=""     # 被停用的默认站点：「原路径=新路径」或「link:软链路径」

# 备份文件（同一文件只备份一次，保证还原的是最初内容）
backup() {
  [ -f "$1" ] || return 0
  case " $BACKUPS " in *" $1 "*) return 0 ;; esac
  cp -a "$1" "$1.sb-bak"
  BACKUPS="$BACKUPS $1"
}

# 还原所有备份过的文件，并把停用的默认站点放回原处
restore_all() {
  local f m
  for f in $BACKUPS; do [ -f "$f.sb-bak" ] && mv -f "$f.sb-bak" "$f"; done
  for m in $MOVED; do
    case "$m" in
      link:*) f="${m#link:}"; [ -f /etc/nginx/sites-available/default ] && ln -sf /etc/nginx/sites-available/default "$f" ;;
      *=*)    [ -f "${m#*=}" ] && mv -f "${m#*=}" "${m%%=*}" ;;
    esac
  done
}

# 成功后删除备份文件
clean_bak() { local f; for f in $BACKUPS; do rm -f "$f.sb-bak"; done; }

# 列出可能声明了其他站点的配置文件（排除本应用自己的文件与备份/临时文件）
other_site_files() {
  local f
  for f in /etc/nginx/conf.d/*.conf /etc/nginx/sites-available/*; do
    [ -f "$f" ] || continue
    case "$f" in */"$APP_NAME".conf|*/"$APP_NAME"|*.sb-bak|*.sb-tmp|*.disabled) continue ;; esac
    echo "$f"
  done
}

# ============================================================
# 1. 路由片段（前缀 / 端口 / 目录随 env 变化，每次重新生成）
# ============================================================
backup "$SNIPPET"
sed -e "s#__PREFIX__#$SITE_PATH#g" -e "s#__PORT__#$PORT#g" -e "s#__APP_DIR__#$APP_DIR#g" \
  < "$HERE/nginx-locations.conf" | tr -d '\r' > "$SNIPPET"
# 子路径部署：不带尾斜杠的入口（如 /systembase-pre）不匹配 location /systembase-pre/，
# 在共享域名的 server 块里会落到那个站点自己的 location /（打开的是别的系统的页面），这里精确匹配后跳转
#   return 以 / 开头时 nginx 按本次请求的协议、域名、端口拼出完整地址（443 → https，8080 → :8080）
if [ -n "$SITE_PATH" ]; then
  cat >> "$SNIPPET" <<EOF

# ---- 不带尾斜杠的入口 $SITE_PATH → $SITE_PATH/（保留查询参数） ----
location = $SITE_PATH {
    return 301 $SITE_PATH/\$is_args\$args;
}
EOF
fi
echo "    路由片段: $SNIPPET（路径前缀: ${SITE_PATH:-/} → 后端 127.0.0.1:$PORT）"

# ============================================================
# 2. 本应用站点 server 块
# ============================================================
SITE_CONF="$(mktemp)"
sed -e "s#__LISTEN__#$SITE_PORT#g" -e "s#__SERVER_NAME__#$SITE_DOMAIN#g" -e "s#__APP_NAME__#$APP_NAME#g" \
  < "$HERE/nginx-site.conf" | tr -d '\r' > "$SITE_CONF"

# 写入站点文件；已配置 HTTPS（certbot 改写过）的不覆盖，避免丢失证书配置
install_site() {  # $1 = 目标文件
  if [ -f "$1" ] && grep -q "ssl_certificate" "$1"; then
    echo "    已存在 HTTPS 站点配置，保留不覆盖: $1"
  else
    backup "$1"
    cat "$SITE_CONF" > "$1"
    echo "    站点配置: $1（监听 :$SITE_PORT  域名: $SITE_DOMAIN）"
  fi
}
# 停用系统自带的默认站点（只在确实冲突时，且绝不删除内容）
#   $1 = 默认站点文件（conf.d/default.conf 或 sites-enabled/default）
#   - 不监听本站点端口 SITE_PORT：互不影响，保留不动
#   - 声明了真实域名或 HTTPS 证书：视为你自己的站点，保留不动，只提示
#   - 否则（安装 nginx 自带的欢迎页）：软链直接摘掉（原文件仍在 sites-available），
#     普通文件移到 /etc/nginx/sb-disabled/ 保存（不会被 nginx 加载，需要时可移回）
disable_default_site() {
  local f="$1" dst
  [ -e "$f" ] || return 0
  grep -qE "listen[[:space:]]+([^;]*:)?$SITE_PORT([[:space:];]|$)" "$f" || return 0
  if grep -qE "ssl_certificate|server_name[[:space:]]+[^;]*[A-Za-z0-9-]+\.[A-Za-z]{2,}" "$f"; then
    echo "    !! $f 同样监听 :$SITE_PORT 且包含真实域名/证书，判断为已有站点，保留不动（如有冲突请手动调整）"
    return 0
  fi
  if [ -L "$f" ]; then
    rm -f "$f"
    MOVED="$MOVED link:$f"
    echo "    已停用默认站点（软链）: $f"
  else
    mkdir -p /etc/nginx/sb-disabled
    dst="/etc/nginx/sb-disabled/$(basename "$f").$(date +%Y%m%d%H%M%S)"
    mv -f "$f" "$dst"
    MOVED="$MOVED $f=$dst"
    echo "    已停用默认站点（与本站点同监听 :$SITE_PORT）: $f → $dst"
  fi
}

if [ -d /etc/nginx/sites-available ]; then
  # Debian / Ubuntu：sites-available 存文件，sites-enabled 软链启用
  install_site "/etc/nginx/sites-available/$APP_NAME"
  ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  disable_default_site /etc/nginx/sites-enabled/default
else
  # CentOS / OpenCloudOS：conf.d/*.conf 直接生效
  install_site "/etc/nginx/conf.d/$APP_NAME.conf"
  disable_default_site /etc/nginx/conf.d/default.conf
fi
rm -f "$SITE_CONF"

# ============================================================
# 3. 共享域名注入（SITE_PATH 子路径方式）
# ============================================================

# 3.1 清理本应用以前注入过的 include 行（按尾注释 MARK 识别；随后按当前配置重新注入）
for f in $(other_site_files); do
  grep -qF "$MARK" "$f" || continue
  backup "$f"
  { grep -vF "$MARK" "$f" || true; } > "$f.sb-tmp"
  cat "$f.sb-tmp" > "$f" && rm -f "$f.sb-tmp"   # cat 覆盖保留原文件的属主与权限
done

# 向配置文件中「server_name 含指定域名」的 server 块末尾插入 include 行
#   $1=配置文件  $2=域名（正则已转义）  $3=1 只注入监听 443 的块 / 0 任意块
#   用 awk 按大括号配对切出每个 server 块再判断；没有匹配的块时返回 1（文件不变）
inject_include() {
  local tmp; tmp="$(mktemp)"
  awk -v inc="    include $SNIPPET; $MARK" -v dom="$2" -v ssl="$3" '
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

# 3.2 按当前 SITE_PATH + SITE_DOMAIN 注入
INJECTED=0
if [ -n "$SITE_PATH" ] && [ "$SITE_DOMAIN" != "_" ]; then
  DOMAIN_RE="$(printf '%s' "$SITE_DOMAIN" | sed 's/[.]/\\./g')"
  # 优先注入 443 块（80 块常是 certbot 的 301 跳转，注入会让 HTTP 也直出内容）；一个都没有再放宽到任意块
  for pass in 1 0; do
    INJECTED=0
    for f in $(other_site_files); do
      grep -qE "server_name[^;]*$DOMAIN_RE" "$f" || continue
      backup "$f"
      if inject_include "$f" "$DOMAIN_RE" "$pass"; then
        echo "    已注入路由片段 → $f（域名 $SITE_DOMAIN 的 server 块）"
        INJECTED=1
      fi
    done
    [ "$INJECTED" = 1 ] && break
  done
  if [ "$INJECTED" = 0 ]; then
    echo "    !! 未找到域名 $SITE_DOMAIN 的 server 块，无法挂载子路径 $SITE_PATH"
    echo "       请确认该域名已在 Nginx 配置（如已配置 HTTPS），或改用独立子域名 + ./sb.sh <环境> ssl <域名>"
  fi
fi

# ============================================================
# 4. 校验并生效（失败自动还原，不影响线上）
# ============================================================
if ! nginx -t; then
  restore_all
  echo "!! nginx -t 校验失败，已还原全部被修改的配置（线上未受影响）"
  exit 1
fi
# nginx 未运行（首次 init）直接启动，否则平滑重载（不断开现有连接）
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
else
  systemctl enable --now nginx >/dev/null 2>&1 || true
fi
clean_bak
# ops.sh stop 留下的旧路由备份已无意义（上面生成并生效的就是正式路由）
rm -f "$SNIPPET.disabled"
