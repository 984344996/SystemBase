#!/usr/bin/env bash
# ============================================================
# 服务器端发布脚本（由 deploy.sh / deploy.ps1 上传到 /tmp 后执行）
#   bash remote-deploy.sh APP_DIR TAR_PATH [MODE] [APP_NAME] [KEEP_RELEASES]
#     MODE=deploy（默认）常规发布：安装依赖 → 迁移 → seed → 切换版本 → 重启 → 健康检查（失败自动回滚）
#     MODE=fresh          重置发布：停服务 → 清空数据库重建 → seed → 切换版本 → 启动
#
# 目录结构（多版本 + 软链，支持秒级回滚）：
#   APP_DIR/
#   ├── current -> releases/20260930120000   Nginx 与 PM2 都指向这里
#   ├── releases/<时间戳>/                    每次发布一个目录，保留最近 KEEP_RELEASES 个
#   └── shared/.env | logs/ | pm2/           跨版本共享：配置、应用日志、PM2 输出
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

APP_DIR="${1:?用法: remote-deploy.sh APP_DIR TAR [MODE] [APP_NAME] [KEEP]}"
TAR="${2:?缺少发布包路径}"
MODE="${3:-deploy}"
APP_NAME="${4:-systembase}"
KEEP="${5:-5}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PNPM_VERSION="${PNPM_VERSION:-9}"   # 由 deploy.sh 按仓库 packageManager 传入
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

PM2_NAME="$APP_NAME-server"
SHARED="$APP_DIR/shared"
STAMP="$(basename "$TAR" | sed -E 's/.*-([0-9]{14})\.tar\.gz$/\1/')"
[[ "$STAMP" =~ ^[0-9]{14}$ ]] || STAMP="$(date +%Y%m%d%H%M%S)"
REL="$APP_DIR/releases/$STAMP"
# 上一版本：current 不存在/悬空时必须为空。注意 GNU readlink -f 对缺失的末级路径会原样输出
# "/…/current" 本身，曾导致首次发布健康检查失败回滚时把 current 切成指向自身的悬空软链
PREV=""
[ -d "$APP_DIR/current/" ] && PREV="$(readlink -f "$APP_DIR/current")"

export CI=true                      # pnpm 非交互
export SB_APP_DIR="$APP_DIR" SB_APP_NAME="$APP_NAME"
# 国内服务器下载 Prisma 引擎走镜像（可在执行前覆盖）
export PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"

[ "$KEEP" -ge 2 ] 2>/dev/null || KEEP=2   # 至少保留上一版本，保证可回滚

step() { echo "==> $*"; }
mkdir -p "$APP_DIR/releases" "$SHARED/logs" "$SHARED/pm2"

# 发布互斥：防止同一秒/并发的两次发布命中同一版本目录互相覆盖（flock 随脚本退出自动释放）
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "!! 已有另一个发布正在服务器上执行，请等它结束后再试"; exit 1; }

# 切换前任何一步失败：删除半成品目录，线上版本保持不变
SWITCHED=0
cleanup_on_fail() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$SWITCHED" = 0 ] && [ -d "$REL" ]; then
    rm -rf "$REL"
    echo "!! 发布中止（线上版本未变）: $(basename "$REL") 已清理"
  fi
}
trap cleanup_on_fail EXIT

# ---------- 解压 ----------
step "解压发布包 → releases/$STAMP"
rm -rf "$REL" && mkdir -p "$REL"
tar -xzf "$TAR" -C "$REL"
# 发布包在本机打包，tar 保留了开发机属主（uid 501）与打包暂存目录的 700 权限：
# 统一为 root 属主、目录可进入（755）、文件可读（保留原有可执行位），
# 否则 nginx worker（非 root）无法进入版本目录读取静态资源（Permission denied → 500）
chown -R root:root "$REL"
chmod -R u+rwX,go+rX "$REL"
find "$REL/deploy" -name "*.sh" -exec sh -c 'for f; do tr -d "\r" < "$f" > "$f.lf" && mv "$f.lf" "$f"; done' _ {} +

# ---------- 配置（随包上传则覆盖 shared/.env；发布目录内不保留密钥） ----------
if [ -f "$REL/.env.production" ]; then
  tr -d '\r' < "$REL/.env.production" > "$SHARED/.env"
  rm -f "$REL/.env.production"
fi
[ -f "$SHARED/.env" ] || { echo "!! 缺少 $SHARED/.env（请先执行 ./deploy.sh init）"; exit 1; }
chmod 600 "$SHARED/.env"
node "$REL/deploy/server/env-tool.cjs" check "$SHARED/.env" >/dev/null
ln -sfn "$SHARED/.env" "$REL/apps/server/.env"
rm -rf "$REL/apps/server/logs" && ln -sfn "$SHARED/logs" "$REL/apps/server/logs"
PORT="$(node "$REL/deploy/server/env-tool.cjs" get "$SHARED/.env" PORT 3000)"

# ---------- 数据库预检：迁移前确认可达，避免装完依赖才在 migrate 失败 ----------
DB_INFO="$(node "$REL/deploy/server/env-tool.cjs" db "$SHARED/.env")"
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"
DB_PORT="$(sed -n 2p <<< "$DB_INFO")"
ENV_TAG="$(sed -n 's/^env=//p' "$REL/RELEASE" 2>/dev/null || true)"
step "等待数据库就绪（${DB_HOST}:${DB_PORT}，最长 30s）"
if ! node "$REL/deploy/server/env-tool.cjs" wait-tcp "$DB_HOST" "$DB_PORT" 30; then
  if [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "localhost" ]; then
    MYSQL_SVC=""
    for s in mysqld mysql; do systemctl cat "$s" >/dev/null 2>&1 && { MYSQL_SVC=$s; break; }; done
    if [ -n "$MYSQL_SVC" ]; then
      echo "    本机 MySQL（服务: $MYSQL_SVC）未在监听，尝试启动..."
      systemctl start "$MYSQL_SVC" || true
      node "$REL/deploy/server/env-tool.cjs" wait-tcp "$DB_HOST" "$DB_PORT" 60 \
        || { echo "!! MySQL 启动后仍无法连接，请登录服务器排查: systemctl status $MYSQL_SVC"; exit 1; }
    else
      echo "!! 服务器上未检测到 MySQL 服务，数据库不可达"
      echo "   请先执行 ./sb.sh ${ENV_TAG:-<环境>} init 安装并初始化数据库，或在 env 中改用外部数据库地址"
      exit 1
    fi
  else
    echo "!! 外部数据库 ${DB_HOST}:${DB_PORT} 不可达，请检查数据库状态 / 网络 / 安全组后重试"
    exit 1
  fi
fi

# ---------- 数据库凭据预检：TCP 可达 ≠ 账号密码正确（P1000），装依赖前先验证 ----------
# 本机装有 mysql 客户端时，用 DATABASE_URL 里的账号实际登录一次，失败立即给出修复指引
if command -v mysql >/dev/null 2>&1; then
  DB_USER="$(sed -n 3p <<< "$DB_INFO")"
  DB_PASS="$(sed -n 4p <<< "$DB_INFO")"
  DB_NAME="$(sed -n 5p <<< "$DB_INFO")"
  step "校验数据库账号 $DB_USER（${DB_HOST}:${DB_PORT}）"
  if ! MYSQL_PWD="$DB_PASS" mysql --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" \
        -e "USE \`$DB_NAME\`; SELECT 1;" >/dev/null 2>&1; then
    echo "!! 数据库账号 '$DB_USER' 认证失败（对应 Prisma P1000）：账号不存在、密码与 DATABASE_URL 不一致，或库 $DB_NAME 未创建"
    echo "   常见原因:"
    echo "     1. 修改过 env 文件中 DATABASE_URL 的密码，但服务器上的账号密码未同步"
    echo "     2. 从未对该服务器执行过 init（建库/建账号步骤缺失）"
    echo "   修复: 重新执行 ./sb.sh ${ENV_TAG:-<环境>} init（幂等，会按当前 env 密码重建账号并自动发布）"
    echo "         外部数据库请在云控制台核对账号密码/白名单后重试"
    exit 1
  fi
fi

# ---------- 依赖 ----------
# 非交互 SSH 的 PATH 很精简：node 在系统路径，但 pnpm/pm2 可能装在 npm 全局 bin（不在 PATH）
# 或压根未安装。先尝试定位 npm 全局 bin；确实没有则现场安装（与 init 行为一致）
ensure_global_bin() {
  local bin="$1" ver="$2" dir
  command -v "$bin" >/dev/null 2>&1 && return 0
  dir="$(npm prefix -g 2>/dev/null || true)"
  if [ -z "$dir" ] || [ ! -x "$dir/bin/$bin" ]; then
    echo "    服务器缺少 $bin，使用 npm 现场安装"
    npm install -g "$bin${ver:+@$ver}" --no-audit --no-fund --registry="$NPM_REGISTRY"
    dir="$(npm prefix -g 2>/dev/null || true)"
  fi
  if [ -n "$dir" ] && [ -x "$dir/bin/$bin" ]; then
    export PATH="$dir/bin:$PATH"
  fi
  command -v "$bin" >/dev/null 2>&1 || { echo "!! $bin 安装后仍不可用，请检查服务器 node/npm 环境"; return 1; }
}
ensure_global_bin pnpm "$PNPM_VERSION"
ensure_global_bin pm2 ""

step "安装后端生产依赖（pnpm，锁定版本）"
cd "$REL"
pnpm install --prod --frozen-lockfile --filter "@sb/server..." --registry="$NPM_REGISTRY" --reporter=append-only
cd "$REL/apps/server"
step "生成 Prisma Client"
./node_modules/.bin/prisma generate >/dev/null

# ---------- 数据库 ----------
if [ "$MODE" = "fresh" ]; then
  step "[fresh] 停止服务，避免清库期间写入"
  pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true
  # 清库前自动备份（与 db-restore 的安全策略一致）；备份失败不阻断（外部数据库可能未装 mysqldump）
  step "[fresh] 清库前自动备份当前库（auto-before-fresh）"
  if bash "$REL/deploy/server/db-backup.sh" "$APP_DIR" "$APP_NAME" backup "auto-before-fresh" >/dev/null 2>&1; then
    echo "    已备份到 $SHARED/backup（按 KEEP_BACKUP_DAYS 滚动清理）"
  else
    echo "    !! 自动备份失败，将继续重置（如需留底请手动 ./sb.sh <env> db-backup 后重试）"
  fi
  step "[fresh] 重置数据库（删除全部表 → 重新执行全部迁移）"
  ./node_modules/.bin/prisma migrate reset --force --skip-seed --skip-generate
else
  # ★ 建表/改表：执行随代码提交的迁移 SQL，只跑未应用过的，不删数据
  step "数据库迁移（prisma migrate deploy，只执行未应用的迁移）"
  ./node_modules/.bin/prisma migrate deploy
fi
step "初始化/补齐种子数据（幂等：只补缺失的菜单、权限点、超管与默认任务）"
# ★ 种子数据：幂等补齐（超管/菜单/权限点/默认任务/内置字典与参数），可重复执行
node dist/database/seed.js

# ---------- 前端静态资源 SELinux 标签 ----------
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  chcon -R -t httpd_sys_content_t "$REL/apps/web/dist" 2>/dev/null || true
fi

# ---------- 切换版本 + 重启 ----------
switch_to() {
  # ★ 原子切换版本：先建临时软链再 mv 覆盖，保证任何时刻 current 都指向完整版本
  ln -sfn "$1" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
}
reload_pm2() {
  # || true：PM2 重载失败（如配置缺失）时不中断脚本，交给随后的健康检查/回滚流程收尾
  pm2 startOrReload "$APP_DIR/current/deploy/server/ecosystem.config.js" --update-env >/dev/null || true
  pm2 save >/dev/null 2>&1 || true
}
health_ok() {
  local i
  for i in $(seq 1 "$HEALTH_TIMEOUT"); do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health" && return 0
    sleep 1
  done
  return 1
}

step "切换版本并重启（PM2: $PM2_NAME）"
switch_to "$REL"
SWITCHED=1
reload_pm2

step "健康检查 http://127.0.0.1:$PORT/api/health（最长 ${HEALTH_TIMEOUT}s）"
if ! health_ok; then
  echo "!! 新版本健康检查失败，最近的错误输出："
  tail -n 30 "$SHARED/pm2/error.log" 2>/dev/null || true
  grep -h '"level":"\(ERROR\|FATAL\)"' "$SHARED/logs/app.$(date +%F).log" 2>/dev/null | tail -n 5 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$REL" ]; then
    echo "!! 自动回滚到上一版本: $(basename "$PREV")（注意：本次已执行的数据库迁移不会回退）"
    switch_to "$PREV"
    reload_pm2
    health_ok && echo "   上一版本已恢复服务" || echo "!! 上一版本也未通过健康检查，请登录服务器排查"
    # 标记失败版本：保留现场便于排查，但不会再被当作回滚目标
    mv "$REL" "$REL.failed" 2>/dev/null || true
  fi
  echo "$STAMP $(date '+%F %T') $MODE FAILED" >> "$APP_DIR/releases.log"
  exit 1
fi
echo "    健康检查通过"

# 站点与路由配置随发布刷新：SITE_PORT / SITE_DOMAIN / SITE_PATH 变更后无需重新 init 即可生效
# （生成站点 server 块与路由片段，并把子路径路由注入共享域名的 server 块；nginx -t 失败会自动还原）
if [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1; then
  step "刷新 Nginx 站点配置（域名/子路径变更在此生效）"
  bash "$REL/deploy/server/nginx-setup.sh" "$APP_DIR" "$APP_NAME" "$SHARED/.env" \
    || echo "    !! Nginx 配置刷新失败，保留现有配置继续（可登录服务器执行 nginx -t 排查）"
fi

# 之前执行过 stop 时自动恢复上线：stop 是「站点级」下线（摘配置不停 Nginx 服务），
# 这里把本环境站点配置挂回去；未 stop 过时以下操作全部幂等无副作用
site_enable() {
  if [ -d /etc/nginx/sites-available ]; then
    [ -f "/etc/nginx/sites-available/$APP_NAME" ] && ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  else
    [ -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" ] && mv -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" "/etc/nginx/conf.d/$APP_NAME.conf"
  fi
  systemctl start nginx >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || true
}
site_enable

# ---------- 记录与清理 ----------
echo "$STAMP $(date '+%F %T') $MODE OK" >> "$APP_DIR/releases.log"
step "清理旧版本（保留最近 $KEEP 个）"
CUR="$(readlink -f "$APP_DIR/current")"
# 目录名即时间戳，按名称倒序；失败版本(.failed)只保留最近 1 个
ls -1d "$APP_DIR"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -E '/[0-9]{14}$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r d; do
  [ "$d" = "$CUR" ] || rm -rf "$d"
done
# 失败版本(.failed)只保留最近 1 个；无 .failed 目录时 ls 以 2 退出，pipefail 下会误判发布失败，需容错
ls -1d "$APP_DIR"/releases/*.failed 2>/dev/null | sort -r | tail -n +2 | xargs -r rm -rf || true

echo ""
echo "✓ 发布完成: $STAMP（$(date '+%F %T')）"
