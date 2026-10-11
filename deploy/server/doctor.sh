#!/usr/bin/env bash
# ============================================================
# 远程环境体检（由 deploy.sh 通过 ssh 调用，也可登录服务器直接执行）
#   bash doctor.sh APP_DIR APP_NAME [本地期望 env 文件路径]
#
# 体检项：版本与构建信息 / PM2 / Nginx / MySQL / 端口与健康检查 / 磁盘 / 今日错误日志 /
#         备份情况 / **本地 env 与服务器 shared/.env 的配置差异**（防止改了配置忘记发布）
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

APP_DIR="${1:?用法: doctor.sh APP_DIR APP_NAME [期望env文件]}"
APP_NAME="${2:?缺少 APP_NAME}"
EXPECT_ENV="${3:-}"

SHARED="$APP_DIR/shared"
CURRENT="$APP_DIR/current"
SCRIPTS="$CURRENT/deploy/server"
ENV_TOOL="$SCRIPTS/env-tool.cjs"
PM2_NAME="$APP_NAME-server"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "  ${G}●${N} $*"; }
bad()  { echo -e "  ${R}○${N} $*"; }
warn2(){ echo -e "  ${Y}▲${N} $*"; }
sec()  { echo -e "\n${C}$*${N}"; }

[ -L "$CURRENT" ] || { echo "尚未发布过（$CURRENT 不存在）"; exit 1; }
PORT="$(node "$ENV_TOOL" get "$SHARED/.env" PORT 3000)"

sec "版本"
STAMP="$(basename "$(readlink -f "$CURRENT")")"
ok "当前版本: $STAMP"
if [ -f "$CURRENT/RELEASE" ]; then
  sed 's/^/  /' "$CURRENT/RELEASE"
fi

sec "服务"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 describe "$PM2_NAME" | grep -E "status|uptime|restarts|memory" | sed 's/│/ /g; s/  */ /g; s/^/  /' || true
  else
    bad "PM2 中未找到 $PM2_NAME"
  fi
else
  warn2 "未安装 PM2"
fi
svc_state() { systemctl is-active "$1" 2>/dev/null || echo "inactive"; }
[ "$(svc_state nginx)" = active ] && ok "nginx: 运行中" || bad "nginx: $(svc_state nginx)"
MYSQL_ST="$(systemctl is-active mysqld 2>/dev/null || systemctl is-active mysql 2>/dev/null || echo "未安装（外部数据库）")"
[ "$MYSQL_ST" = active ] && ok "mysql: 运行中" || warn2 "mysql: ${MYSQL_ST}"

sec "健康检查"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/health" || true)"
[ "$CODE" = 200 ] && ok "/api/health 正常（端口 ${PORT}）" || bad "/api/health 异常（HTTP ${CODE:-无响应}，端口 ${PORT}）"
if [ -f "$CURRENT/deploy/server/doctor.sh" ]; then
  READY="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/health/ready" || true)"
  case "$READY" in 200) ok "/api/health/ready 就绪" ;; 503) warn2 "/api/health/ready 未就绪（依赖异常）" ;; *) warn2 "/api/health/ready 不可用（HTTP ${READY:-无响应}，老版本无此接口）" ;; esac
fi

sec "磁盘"
echo "  $(df -h "$APP_DIR" | awk 'NR==2{print "应用目录可用 " $4 " / 共 " $2 "（使用率 " $5 "）"}')"
echo "  $(df -h / | awk 'NR==2{print "系统盘 可用 " $4 " / 共 " $2 "（使用率 " $5 "）"}')"

sec "今日日志"
TODAY="$SHARED/logs/app.$(date +%F).log"
if [ -f "$TODAY" ]; then
  ERRORS="$(grep -c '"level":"ERROR"' "$TODAY" || true)"
  WARNS="$(grep -c '"level":"WARN"' "$TODAY" || true)"
  echo "  文件: $TODAY（$(du -h "$TODAY" | cut -f1)）"
  [ "${ERRORS:-0}" = 0 ] && ok "ERROR 0 条" || bad "ERROR ${ERRORS} 条（用 ./sb.sh <环境> logs ERROR 查看）"
  [ "${WARNS:-0}" = 0 ] && ok "WARN 0 条" || warn2 "WARN ${WARNS} 条"
else
  warn2 "今日尚无日志"
fi

sec "备份"
if [ -d "$SHARED/backup" ]; then
  LAST="$(ls -1t "$SHARED/backup"/*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$LAST" ] && ok "最近备份: $(basename "$LAST")（$(du -h "$LAST" | cut -f1)，$(date -r "$LAST" '+%F %T')）" || warn2 "备份目录存在但没有备份文件"
else
  warn2 "尚未备份过（./sb.sh <环境> db-backup）"
fi

if [ -n "$EXPECT_ENV" ] && [ -f "$EXPECT_ENV" ] && [ -f "$SCRIPTS/env-diff.cjs" ]; then
  sec "配置差异（本地 env vs 服务器 shared/.env）"
  set +e
  node "$SCRIPTS/env-diff.cjs" "$EXPECT_ENV" "$SHARED/.env" | sed 's/^/  /'
  RC=$?
  set -e
  [ "$RC" = 0 ] || warn2 "存在未同步的配置，若刚改过 deploy/envs 请执行发布"
else
  sec "配置差异"
  echo "  （未提供本地 env 或服务器缺少 env-diff.cjs，跳过比对）"
fi

echo ""
echo -e "${C}体检完成${N}"
