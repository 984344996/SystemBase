#!/usr/bin/env bash
# ============================================================
# 服务器端运维命令（由 deploy.sh / deploy.ps1 通过 ssh 调用，也可登录服务器直接执行）
#   bash ops.sh APP_DIR APP_NAME <命令> [参数]
#     status                服务 / 版本 / 健康检查 / 磁盘 / 今日错误数
#     logs [级别|pm2|follow] [日期]
#                           应用日志：默认今天最近 100 行；级别 ERROR/WARN/INFO 过滤；
#                           pm2 看进程启动/崩溃输出；follow 持续跟踪
#     releases              列出已发布版本与最近发布记录
#     rollback [版本号]      回滚到上一版本（或指定版本）：代码 + 该版本的配置快照 + Nginx 路由；不回退数据库
#     restart               重启后端（PM2 reload）
#     start                 启动后端 + 恢复本环境站点
#     stop                  本环境站点换成「维护中」页面 + 停止后端（同机其他环境不受影响）
#     migrate-status        查看数据库迁移状态（待执行 / 执行失败的迁移）
#     migrate-resolve <applied|rolled-back> <迁移名>
#                           人工处理完失败的迁移后，标记其结果（解除 Prisma P3009 阻塞）
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

APP_DIR="${1:?用法: ops.sh APP_DIR APP_NAME 命令}"
APP_NAME="${2:?缺少 APP_NAME}"
CMD="${3:-status}"
ARG1="${4:-}"
ARG2="${5:-}"

PM2_NAME="$APP_NAME-server"
SHARED="$APP_DIR/shared"
ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"
SNIPPET="/etc/nginx/snippets/$APP_NAME-locations.conf"   # nginx-setup.sh 生成的路由片段
export SB_APP_DIR="$APP_DIR" SB_APP_NAME="$APP_NAME"   # ecosystem.config.js 读取

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'
[ -L "$APP_DIR/current" ] || { echo "尚未发布过（$APP_DIR/current 不存在），请先执行 ./sb.sh <环境> init"; exit 1; }

# ============================================================
# 通用函数
# ============================================================

# 后端监听端口（shared/.env 的 PORT）
port() { node "$ENV_TOOL" get "$SHARED/.env" PORT 3000; }

# 当前版本号（current 软链指向的目录名）
current_stamp() { basename "$(readlink -f "$APP_DIR/current")"; }

# 按 current 重新加载 PM2；失败不中断，由调用方的健康检查判断结果
reload_pm2() {
  pm2 startOrReload "$APP_DIR/current/deploy/server/ecosystem.config.js" --update-env >/dev/null || true
  pm2 save >/dev/null 2>&1 || true
}

# 轮询健康检查，最长 60 秒；通过返回 0
wait_health() {
  local _
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$(port)/api/health" && return 0
    sleep 1
  done
  return 1
}

# systemd 服务状态（active / inactive / failed…）
svc_state() { systemctl is-active "$1" 2>/dev/null || echo "inactive"; }

# MySQL 服务状态；没有本机服务时视为外部数据库
mysql_state() {
  local s
  for s in mysqld mysql; do systemctl cat "$s" >/dev/null 2>&1 && { svc_state "$s"; return; }; done
  echo "未安装（外部数据库）"
}

# 获取发布锁（与 remote-deploy.sh 共用）：回滚 / 标记迁移时不能和发布同时进行
acquire_lock() {
  exec 9>"$APP_DIR/.deploy.lock"
  flock -n 9 || { echo -e "${R}!! 服务器上正在发布或回滚，请等它结束后再试${N}"; exit 1; }
}

# 用指定版本目录里的 nginx-setup.sh 按当前 shared/.env 重新生成 Nginx 配置（非 root / 未装 nginx 时跳过）
refresh_nginx() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  [ -f "$1/deploy/server/nginx-setup.sh" ] || return 0
  bash "$1/deploy/server/nginx-setup.sh" "$APP_DIR" "$APP_NAME" "$SHARED/.env" | sed 's/^/  /'
}

# ---------- 站点级启停（同一台机器部署多个环境时，不能停整机 Nginx） ----------

# 本应用站点配置文件路径（Debian 系 sites-enabled 软链 / CentOS 系 conf.d）
site_path() {
  if [ -d /etc/nginx/sites-available ]; then echo "/etc/nginx/sites-enabled/$APP_NAME"; else echo "/etc/nginx/conf.d/$APP_NAME.conf"; fi
}

# 子路径前缀（与 nginx-setup.sh 的规范化规则一致）：如 /systembase-pre；根路径部署为空
site_prefix() {
  local p; p="$(node "$ENV_TOOL" get "$SHARED/.env" SITE_PATH "")"
  [ -n "$p" ] || return 0
  case "$p" in /*) ;; *) p="/$p" ;; esac
  echo "${p%/}"
}

# 路由片段换成「503 维护中」：真实路由移到 .disabled 备份。
# 子路径模式下片段被 include 进共享域名的 server 块，只摘本应用站点文件无法让页面下线，必须换片段
snippet_maintenance() {
  [ -f "$SNIPPET" ] || return 0
  [ -f "$SNIPPET.disabled" ] || mv -f "$SNIPPET" "$SNIPPET.disabled"
  local prefix; prefix="$(site_prefix)"
  cat > "$SNIPPET" <<EOF
# 维护页（由 ops.sh stop 生成；执行 start 或下次发布时恢复正式路由）
location ^~ $prefix/ {
    default_type text/html;
    charset utf-8;
    add_header Retry-After 600 always;
    return 503 '<!doctype html><meta charset="utf-8"><title>系统维护中</title><h2 style="font-family:sans-serif;text-align:center;margin-top:20vh">系统维护中，请稍后再访问</h2>';
}
EOF
}

# 恢复真实路由片段（stop 时备份的 .disabled）
snippet_restore() {
  [ -f "$SNIPPET.disabled" ] && mv -f "$SNIPPET.disabled" "$SNIPPET"
  return 0
}

# 下线本环境：路由换维护页 + 摘掉本应用站点配置 → 校验后 reload（校验失败则全部还原）
site_disable() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  local f; f="$(site_path)"
  snippet_maintenance
  if [ -e "$f" ]; then
    if [ -d /etc/nginx/sites-available ]; then rm -f "$f"; else mv -f "$f" "$f.disabled"; fi
  fi
  if ! nginx -t >/dev/null 2>&1; then
    echo -e "${R}!! 维护页配置校验失败，已还原站点配置（页面仍可访问）${N}"
    snippet_restore
    site_enable
    return 0
  fi
  systemctl reload nginx 2>/dev/null || true
}

# 上线本环境：恢复真实路由 + 挂回站点配置 → 启动/重载 Nginx
site_enable() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  snippet_restore
  if [ -d /etc/nginx/sites-available ]; then
    [ -f "/etc/nginx/sites-available/$APP_NAME" ] && ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  else
    [ -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" ] && mv -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" "/etc/nginx/conf.d/$APP_NAME.conf"
  fi
  systemctl start nginx >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || true
}

# prisma 命令（在线上版本目录执行，读取 shared/.env 的 DATABASE_URL）
prisma_cur() { (cd "$APP_DIR/current/apps/server" && ./node_modules/.bin/prisma "$@"); }

# ============================================================
# 命令分发
# ============================================================
case "$CMD" in
  # ---------- 状态 ----------
  status)
    echo "当前版本: $(current_stamp)"
    pm2 describe "$PM2_NAME" 2>/dev/null | grep -E "status|uptime|restarts|memory|script path" | sed 's/│/ /g; s/  */ /g' || echo "PM2 未运行 $PM2_NAME"
    echo "nginx: $(svc_state nginx)    mysql: $(mysql_state)"
    [ -f "$SNIPPET.disabled" ] && echo -e "站点: ${Y}已停止（维护页），执行 start 恢复${N}"
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$(port)/api/health" || true)"
    if [ "$code" = "200" ]; then echo -e "健康检查: ${G}正常${N}"; else echo -e "健康检查: ${R}异常（HTTP ${code:-无响应}）${N}"; fi
    today="$SHARED/logs/app.$(date +%F).log"
    if [ -f "$today" ]; then
      echo "今日日志: $(du -h "$today" | cut -f1)，ERROR $(grep -c '"level":"ERROR"' "$today" || true) 条，WARN $(grep -c '"level":"WARN"' "$today" || true) 条"
    fi
    echo "磁盘: $(df -h "$APP_DIR" | awk 'NR==2{print $4" 可用 / 共 "$2}')"
    ;;

  # ---------- 日志 ----------
  logs)
    case "$ARG1" in
      pm2) pm2 logs "$PM2_NAME" --lines 100 --nostream ;;            # 进程启动失败 / 崩溃输出
      follow|-f) tail -n 50 -F "$SHARED/logs/app.$(date +%F).log" ;;  # 持续跟踪今天的应用日志
      *)
        day="${ARG2:-$(date +%F)}"
        file="$SHARED/logs/app.$day.log"
        [ -f "$file" ] || { echo "没有 $day 的日志文件；现有日志："; ls -1 "$SHARED/logs" | tail -n 10; exit 1; }
        if [ -n "$ARG1" ]; then
          lvl="$(echo "$ARG1" | tr '[:lower:]' '[:upper:]')"          # 按级别过滤（日志为 JSON 行）
          grep "\"level\":\"$lvl\"" "$file" | tail -n 100 || echo "（$day 没有 $lvl 级别日志）"
        else
          tail -n 100 "$file"
        fi
        ;;
    esac
    ;;

  # ---------- 版本列表 ----------
  releases)
    cur="$(current_stamp)"
    echo "已发布版本（* 为当前）："
    ls -1 "$APP_DIR/releases" | sort -r | while read -r r; do
      if [ "$r" = "$cur" ]; then echo -e "  ${G}* $r${N}"; else echo "    $r"; fi
    done
    [ -f "$APP_DIR/releases.log" ] && { echo "最近发布记录："; tail -n 5 "$APP_DIR/releases.log" | sed 's/^/    /'; }
    ;;

  # ---------- 回滚：代码 + 配置快照 + Nginx 路由；【不回退数据库】 ----------
  rollback)
    acquire_lock
    cur="$(current_stamp)"
    # 1) 确定目标：指定版本，或「按名称倒序排在当前版本之后的第一个」（跳过 .failed）
    if [ -n "$ARG1" ]; then
      target="$ARG1"
    else
      target="$(ls -1 "$APP_DIR/releases" | grep -E '^[0-9]{14}$' | sort -r | awk -v c="$cur" 'f{print; exit} $0==c{f=1}' || true)"
    fi
    [ -n "$target" ] && [ -d "$APP_DIR/releases/$target" ] || { echo "没有可回滚的版本（当前 $cur）；用 releases 查看列表"; exit 1; }
    [ "$target" != "$cur" ] || { echo "已经是 $target"; exit 0; }
    echo -e "${Y}回滚: $cur → $target（数据库迁移不会回退；如新版本做过破坏性变更，请先确认兼容）${N}"
    # 2) 配置：目标版本有配置快照则恢复（当前配置留底 .env.prev）；老版本没有快照时沿用当前配置
    if [ -f "$APP_DIR/releases/$target/.env.snapshot" ]; then
      cp -p "$SHARED/.env" "$SHARED/.env.prev"
      cp -p "$APP_DIR/releases/$target/.env.snapshot" "$SHARED/.env" && chmod 600 "$SHARED/.env"
      echo "  已恢复 $target 发布时的配置（原配置留底 shared/.env.prev）"
    else
      echo -e "  ${Y}$target 没有配置快照（早于该功能的版本），沿用当前 shared/.env${N}"
    fi
    # 3) 原子切换 current → 重载 PM2
    ln -sfn "$APP_DIR/releases/$target" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
    reload_pm2
    # 4) Nginx 路由按目标版本的配置重新生成（两个版本 SITE_PATH 不同时必须）
    refresh_nginx "$APP_DIR/releases/$target" || echo -e "  ${Y}Nginx 配置重新生成失败，沿用现有配置（可登录服务器 nginx -t 排查）${N}"
    # 5) 健康检查
    if wait_health; then
      echo "$target $(date '+%F %T') rollback OK" >> "$APP_DIR/releases.log"
      echo -e "${G}✓ 已回滚到 $target，健康检查通过${N}"
    else
      echo "$target $(date '+%F %T') rollback FAILED" >> "$APP_DIR/releases.log"
      echo -e "${R}!! 回滚后健康检查未通过，请执行 ./sb.sh <环境> logs pm2 排查${N}"; exit 1
    fi
    ;;

  # ---------- 启停：只作用于本环境（摘/挂本环境站点 + PM2 应用），不 systemctl stop nginx ----------
  restart) reload_pm2; echo "后端已重启" ;;
  start)
    reload_pm2                               # 先起后端，再放流量，避免先出现 502
    wait_health || echo -e "${Y}!! 后端 60s 内未通过健康检查，请执行 logs pm2 排查${N}"
    site_enable
    echo "本环境已启动（$APP_NAME）"
    ;;
  stop)
    site_disable                             # 先换维护页，再停后端，避免用户看到 502
    pm2 stop "$PM2_NAME" >/dev/null
    echo "本环境已停止（$APP_NAME：页面显示维护中；同机其他环境不受影响）"
    ;;

  # ---------- 数据库迁移状态 / 标记 ----------
  migrate-status)
    prisma_cur migrate status || true          # 有待执行/失败的迁移时 prisma 返回非 0，这里只做展示
    ;;
  migrate-resolve)
    case "$ARG1" in applied|rolled-back) ;; *) echo "用法: migrate-resolve <applied|rolled-back> <迁移名>"; exit 1 ;; esac
    [[ "$ARG2" =~ ^[0-9]{14}_[A-Za-z0-9_]+$ ]] || { echo "迁移名格式应为 <14位时间戳>_<名称>（见 migrate-status 输出）"; exit 1; }
    acquire_lock
    # applied：你已手工把该迁移剩余部分执行完；rolled-back：你已手工撤销，下次发布会重新执行它
    prisma_cur migrate resolve "--$ARG1" "$ARG2"
    echo -e "${G}✓ 已标记 $ARG2 为 $ARG1，可重新发布${N}"
    ;;

  *) echo "未知命令: $CMD（status / logs / releases / rollback / restart / start / stop / migrate-status / migrate-resolve）"; exit 1 ;;
esac
