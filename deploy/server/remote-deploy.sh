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
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

PM2_NAME="$APP_NAME-server"
SHARED="$APP_DIR/shared"
STAMP="$(basename "$TAR" | sed -E 's/.*-([0-9]{14})\.tar\.gz$/\1/')"
[[ "$STAMP" =~ ^[0-9]{14}$ ]] || STAMP="$(date +%Y%m%d%H%M%S)"
REL="$APP_DIR/releases/$STAMP"
PREV="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"

export CI=true                      # pnpm 非交互
export SB_APP_DIR="$APP_DIR" SB_APP_NAME="$APP_NAME"
# 国内服务器下载 Prisma 引擎走镜像（可在执行前覆盖）
export PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"

[ "$KEEP" -ge 2 ] 2>/dev/null || KEEP=2   # 至少保留上一版本，保证可回滚

step() { echo "==> $*"; }
mkdir -p "$APP_DIR/releases" "$SHARED/logs" "$SHARED/pm2"

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

# ---------- 依赖 ----------
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
  step "[fresh] 重置数据库（删除全部表 → 重新执行全部迁移）"
  ./node_modules/.bin/prisma migrate reset --force --skip-seed --skip-generate
else
  step "数据库迁移（prisma migrate deploy，只执行未应用的迁移）"
  ./node_modules/.bin/prisma migrate deploy
fi
step "初始化/补齐种子数据（幂等：只补缺失的菜单、权限点、超管与默认任务）"
node dist/database/seed.js

# ---------- 前端静态资源 SELinux 标签 ----------
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  chcon -R -t httpd_sys_content_t "$REL/apps/web/dist" 2>/dev/null || true
fi

# ---------- 切换版本 + 重启 ----------
switch_to() {
  ln -sfn "$1" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
}
reload_pm2() {
  pm2 startOrReload "$APP_DIR/current/deploy/server/ecosystem.config.js" --update-env >/dev/null
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

# 若之前执行过 stop（Nginx 被停），发布后自动拉起
systemctl is-active --quiet nginx 2>/dev/null || { echo "    Nginx 处于停止状态，自动拉起"; systemctl start nginx; }

# ---------- 记录与清理 ----------
echo "$STAMP $(date '+%F %T') $MODE OK" >> "$APP_DIR/releases.log"
step "清理旧版本（保留最近 $KEEP 个）"
CUR="$(readlink -f "$APP_DIR/current")"
# 目录名即时间戳，按名称倒序；失败版本(.failed)只保留最近 1 个
ls -1d "$APP_DIR"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -E '/[0-9]{14}$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r d; do
  [ "$d" = "$CUR" ] || rm -rf "$d"
done
ls -1d "$APP_DIR"/releases/*.failed 2>/dev/null | sort -r | tail -n +2 | xargs -r rm -rf

echo ""
echo "✓ 发布完成: $STAMP（$(date '+%F %T')）"
