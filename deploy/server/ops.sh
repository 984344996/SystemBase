#!/usr/bin/env bash
# ============================================================
# 服务器端运维命令（由 deploy.sh / deploy.ps1 通过 ssh 调用，也可登录服务器直接执行）
#   bash ops.sh APP_DIR APP_NAME <命令> [参数]
#     status              服务 / 版本 / 健康检查 / 磁盘
#     logs [级别|pm2|follow] [日期]
#                         应用日志：默认今天最近 100 行；级别 ERROR/WARN/INFO 过滤；
#                         pm2 看进程启动/崩溃输出；follow 持续跟踪
#     releases            列出已发布版本
#     rollback [版本号]    回滚到上一版本（或指定版本），不回退数据库
#     restart|start|stop  重启 / 启动（含 Nginx）/ 停止（含 Nginx，页面下线）
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu

APP_DIR="${1:?用法: ops.sh APP_DIR APP_NAME 命令}"
APP_NAME="${2:?缺少 APP_NAME}"
CMD="${3:-status}"
ARG1="${4:-}"
ARG2="${5:-}"

PM2_NAME="$APP_NAME-server"
SHARED="$APP_DIR/shared"
ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"
export SB_APP_DIR="$APP_DIR" SB_APP_NAME="$APP_NAME"

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'
[ -L "$APP_DIR/current" ] || { echo "尚未发布过（$APP_DIR/current 不存在），请先执行 ./deploy.sh 或 ./deploy.sh init"; exit 1; }

port() { node "$ENV_TOOL" get "$SHARED/.env" PORT 3000; }
current_stamp() { basename "$(readlink -f "$APP_DIR/current")"; }
reload_pm2() {
  pm2 startOrReload "$APP_DIR/current/deploy/server/ecosystem.config.js" --update-env >/dev/null
  pm2 save >/dev/null 2>&1 || true
}
svc_state() { systemctl is-active "$1" 2>/dev/null || echo "inactive"; }
mysql_state() {
  local s
  for s in mysqld mysql; do systemctl cat "$s" >/dev/null 2>&1 && { svc_state "$s"; return; }; done
  echo "未安装（外部数据库）"
}

case "$CMD" in
  status)
    echo "当前版本: $(current_stamp)"
    pm2 describe "$PM2_NAME" 2>/dev/null | grep -E "status|uptime|restarts|memory|script path" | sed 's/│/ /g; s/  */ /g' || echo "PM2 未运行 $PM2_NAME"
    echo "nginx: $(svc_state nginx)    mysql: $(mysql_state)"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$(port)/api/health" || true)"
    if [ "$code" = "200" ]; then echo -e "健康检查: ${G}正常${N}"; else echo -e "健康检查: ${R}异常（HTTP ${code:-无响应}）${N}"; fi
    today="$SHARED/logs/app.$(date +%F).log"
    if [ -f "$today" ]; then
      echo "今日日志: $(du -h "$today" | cut -f1)，ERROR $(grep -c '"level":"ERROR"' "$today" || true) 条，WARN $(grep -c '"level":"WARN"' "$today" || true) 条"
    fi
    echo "磁盘: $(df -h "$APP_DIR" | awk 'NR==2{print $4" 可用 / 共 "$2}')"
    ;;

  logs)
    case "$ARG1" in
      pm2) pm2 logs "$PM2_NAME" --lines 100 --nostream ;;
      follow|-f) tail -n 50 -F "$SHARED/logs/app.$(date +%F).log" ;;
      *)
        day="${ARG2:-$(date +%F)}"
        file="$SHARED/logs/app.$day.log"
        [ -f "$file" ] || { echo "没有 $day 的日志文件；现有日志："; ls -1 "$SHARED/logs" | tail -n 10; exit 1; }
        if [ -n "$ARG1" ]; then
          lvl="$(echo "$ARG1" | tr '[:lower:]' '[:upper:]')"
          grep "\"level\":\"$lvl\"" "$file" | tail -n 100 || echo "（$day 没有 $lvl 级别日志）"
        else
          tail -n 100 "$file"
        fi
        ;;
    esac
    ;;

  releases)
    cur="$(current_stamp)"
    echo "已发布版本（* 为当前）："
    ls -1 "$APP_DIR/releases" | sort -r | while read -r r; do
      if [ "$r" = "$cur" ]; then echo -e "  ${G}* $r${N}"; else echo "    $r"; fi
    done
    [ -f "$APP_DIR/releases.log" ] && { echo "最近发布记录："; tail -n 5 "$APP_DIR/releases.log" | sed 's/^/    /'; }
    ;;

  rollback)
    cur="$(current_stamp)"
    if [ -n "$ARG1" ]; then
      target="$ARG1"
    else
      # 上一个成功版本：按名称倒序，取当前版本之后的第一个（跳过 .failed）
      target="$(ls -1 "$APP_DIR/releases" | grep -E '^[0-9]{14}$' | sort -r | awk -v c="$cur" 'f{print; exit} $0==c{f=1}')"
    fi
    [ -n "$target" ] && [ -d "$APP_DIR/releases/$target" ] || { echo "没有可回滚的版本（当前 $cur）；用 releases 查看列表"; exit 1; }
    [ "$target" != "$cur" ] || { echo "已经是 $target"; exit 0; }
    echo -e "${Y}回滚: $cur → $target（数据库迁移不会回退；如新版本做过破坏性变更，请先确认兼容）${N}"
    ln -sfn "$APP_DIR/releases/$target" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
    reload_pm2
    for _ in $(seq 1 60); do
      curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$(port)/api/health" && { echo "$target $(date '+%F %T') rollback OK" >> "$APP_DIR/releases.log"; echo -e "${G}✓ 已回滚到 $target，健康检查通过${N}"; exit 0; }
      sleep 1
    done
    echo -e "${R}!! 回滚后健康检查未通过，请执行 ./deploy.sh logs pm2 排查${N}"; exit 1
    ;;

  restart) reload_pm2; echo "后端已重启" ;;
  start)   systemctl start nginx; reload_pm2; echo "后端与 Nginx 已启动" ;;
  stop)    pm2 stop "$PM2_NAME" >/dev/null; systemctl stop nginx; echo "后端与 Nginx 已停止（页面不可访问）" ;;
  *) echo "未知命令: $CMD（status / logs / releases / rollback / restart / start / stop）"; exit 1 ;;
esac
