#!/usr/bin/env bash
# ============================================================
# 远程环境体检（由 ./sb.sh <环境> doctor 调用，也可登录服务器直接执行）
#   bash doctor.sh APP_DIR APP_NAME [本地期望 env 文件路径]
#
# 体检项（只读，不修改任何东西）：
#   版本与构建信息 / PM2 / Nginx / MySQL / 健康检查 / 磁盘 / 今日错误日志 /
#   最近一次发布结果 / 备份情况与每日备份任务 /
#   **本地 env 与服务器 shared/.env 的配置差异**（防止改了配置忘记发布；只比对键名，不打印值）
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

# ---------- 输出样式 ----------
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
ok()   { echo -e "  ${G}●${N} $*"; }   # 正常
bad()  { echo -e "  ${R}○${N} $*"; }   # 异常
warn2(){ echo -e "  ${Y}▲${N} $*"; }   # 提醒
sec()  { echo -e "\n${C}$*${N}"; }     # 分节标题

# systemd 服务状态（active / inactive / failed…）
svc_state() { systemctl is-active "$1" 2>/dev/null || echo "inactive"; }

[ -L "$CURRENT" ] || { echo "尚未发布过（$CURRENT 不存在）"; exit 1; }
PORT="$(node "$ENV_TOOL" get "$SHARED/.env" PORT 3000)"

# ---------- 版本 ----------
sec "版本"
STAMP="$(basename "$(readlink -f "$CURRENT")")"
ok "当前版本: $STAMP"
[ -f "$CURRENT/RELEASE" ] && sed 's/^/  /' "$CURRENT/RELEASE"
[ -f "$CURRENT/.env.snapshot" ] || warn2 "当前版本没有配置快照（早于该功能的版本），回滚到它时不会恢复配置"

# ---------- 服务 ----------
sec "服务"
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 describe "$PM2_NAME" | grep -E "status|uptime|restarts|memory" | sed 's/│/ /g; s/  */ /g; s/^/  /' || true
  else
    bad "PM2 中未找到 $PM2_NAME"
  fi
else
  warn2 "未安装 PM2（或不在 PATH 中）"
fi
[ "$(svc_state nginx)" = active ] && ok "nginx: 运行中" || bad "nginx: $(svc_state nginx)"
[ -f "/etc/nginx/snippets/$APP_NAME-locations.conf.disabled" ] && warn2 "站点处于停止状态（维护页），执行 ./sb.sh <环境> start 恢复"
MYSQL_ST="$(systemctl is-active mysqld 2>/dev/null || systemctl is-active mysql 2>/dev/null || echo "未安装（外部数据库）")"
[ "$MYSQL_ST" = active ] && ok "mysql: 运行中" || warn2 "mysql: ${MYSQL_ST}"

# ---------- 健康检查 ----------
sec "健康检查"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/health" || true)"
[ "$CODE" = 200 ] && ok "/api/health 正常（端口 ${PORT}）" || bad "/api/health 异常（HTTP ${CODE:-无响应}，端口 ${PORT}）"
# /ready 额外检查 Redis（启用时）与日志目录可写
READY="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$PORT/api/health/ready" || true)"
case "$READY" in 200) ok "/api/health/ready 就绪" ;; 503) warn2 "/api/health/ready 未就绪（依赖异常）" ;; *) warn2 "/api/health/ready 不可用（HTTP ${READY:-无响应}，老版本无此接口）" ;; esac

# ---------- 磁盘 ----------
sec "磁盘"
echo "  $(df -h "$APP_DIR" | awk 'NR==2{print "应用目录可用 " $4 " / 共 " $2 "（使用率 " $5 "）"}')"
echo "  $(df -h / | awk 'NR==2{print "系统盘 可用 " $4 " / 共 " $2 "（使用率 " $5 "）"}')"

# ---------- 今日日志 ----------
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

# ---------- 最近一次发布 ----------
sec "最近一次发布"
LAST_LOG="$(ls -1t "$SHARED"/deploy-logs/*.log 2>/dev/null | head -n 1 || true)"
if [ -n "$LAST_LOG" ]; then
  RC="$(cat "$LAST_LOG.rc" 2>/dev/null || true)"
  case "$RC" in
    0) ok "$(basename "$LAST_LOG" .log) 成功" ;;
    "") warn2 "$(basename "$LAST_LOG" .log) 进行中或异常退出（./sb.sh <环境> deploy-log 查看）" ;;
    *) bad "$(basename "$LAST_LOG" .log) 失败（退出码 $RC，./sb.sh <环境> deploy-log 查看）" ;;
  esac
else
  warn2 "没有发布日志（早于该功能的发布不会记录）"
fi

# ---------- 备份 ----------
sec "备份"
if [ -d "$SHARED/backup" ]; then
  LAST="$(ls -1t "$SHARED/backup"/*.sql.gz 2>/dev/null | head -1 || true)"
  [ -n "$LAST" ] && ok "最近备份: $(basename "$LAST")（$(du -h "$LAST" | cut -f1)，$(date -r "$LAST" '+%F %T')）" || warn2 "备份目录存在但没有备份文件"
else
  warn2 "尚未备份过（./sb.sh <环境> db-backup）"
fi
if [ -f "/etc/cron.d/$APP_NAME-db-backup" ]; then
  ok "每日备份任务: $(grep -E '^[0-9*]' "/etc/cron.d/$APP_NAME-db-backup" | awk '{print $1" "$2" "$3" "$4" "$5}')"
else
  warn2 "未安装每日备份任务（发布后自动安装；外部数据库或 DB_BACKUP_CRON=off 时不安装）"
fi

# ---------- 配置差异 ----------
if [ -n "$EXPECT_ENV" ] && [ -f "$EXPECT_ENV" ] && [ -f "$SCRIPTS/env-diff.cjs" ]; then
  sec "配置差异（本地 env vs 服务器 shared/.env）"
  set +e
  node "$SCRIPTS/env-diff.cjs" "$EXPECT_ENV" "$SHARED/.env" | sed 's/^/  /'
  RC="${PIPESTATUS[0]}"
  set -e
  case "$RC" in
    0) ;;
    2) warn2 "存在未同步的配置，若刚改过 deploy/envs 请执行发布" ;;
    *) bad "配置比对失败（退出码 $RC）" ;;
  esac
else
  sec "配置差异"
  echo "  （未提供本地 env 或服务器缺少 env-diff.cjs，跳过比对）"
fi

echo ""
echo -e "${C}体检完成${N}"
