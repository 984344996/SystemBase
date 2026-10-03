#!/usr/bin/env bash
# ============================================================
# SystemBase 本地一键启动（Mac/Linux 版，Windows 请用 start-local.ps1）
# 统一入口: ./sb.sh local <命令>（本脚本等价于 ./sb.sh local）
# 用法:
#   ./start-local.sh           启动/重启前后端（保留数据；自动执行未应用的迁移并补齐种子数据）
#   ./start-local.sh restart   同上
#   ./start-local.sh fresh     完全重置：清空本地数据库 → 重新执行全部迁移 → 种子数据 → 启动
#   ./start-local.sh stop      停止前后端
#   ./start-local.sh status    查看运行状态
#   ./start-local.sh logs      跟踪前后端开发进程输出
#
# 说明:
#   - 配置源是 deploy/envs/local.env（端口/数据库等，含 WEB_PORT 前端端口）；每次启动自动同步为
#     apps/server/.env（Nest 实际读取的文件），两份文件请只编辑前者
#   - 数据库连接取 DATABASE_URL，仅允许本机库（localhost/127.0.0.1）
#   - 表结构统一走 prisma migrate（与生产一致），首次运行会自动创建数据库
#   - 应用日志仍写 apps/server/logs/app.YYYY-MM-DD.log；进程输出写 .run/server.log、.run/web.log
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
SERVER="$ROOT/apps/server"
ENV_FILE="$SERVER/.env"
LOCAL_ENV="$ROOT/deploy/envs/local.env"
ENV_TOOL="$ROOT/deploy/server/env-tool.cjs"
RUN_DIR="$ROOT/.run"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
info() { echo -e "${G}==> $*${N}"; }
warn() { echo -e "${Y}!! $*${N}"; }
die()  { echo -e "${R}✗ $*${N}" >&2; exit 1; }
usage() { sed -n '5,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

command -v node >/dev/null 2>&1 || die "需要 Node.js ≥ 20"
mkdir -p deploy/envs
if [ ! -f "$LOCAL_ENV" ]; then
  if [ -f "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ]; then
    # 老项目迁移：现有普通文件 apps/server/.env → deploy/envs/local.env（此后请编辑 local.env）
    cp "$ENV_FILE" "$LOCAL_ENV"
    grep -qE '^[[:space:]]*WEB_PORT=' "$LOCAL_ENV" || printf '\n# 前端开发端口（Vite；临时覆盖可用 SB_WEB_PORT=xxxx ./sb.sh local start）\nWEB_PORT=5173\n' >> "$LOCAL_ENV"
    info "已将 apps/server/.env 迁移为 deploy/envs/local.env（今后请编辑该文件）"
  else
    cp "$ROOT/deploy/envs/local.env.example" "$LOCAL_ENV"
    printf '\n# 前端开发端口（Vite；临时覆盖可用 SB_WEB_PORT=xxxx ./sb.sh local start）\nWEB_PORT=5173\n' >> "$LOCAL_ENV"
    warn "已从模板生成 deploy/envs/local.env，请确认其中 DATABASE_URL 的账号密码后重新执行"
    exit 1
  fi
fi
# 唯一配置源 deploy/envs/local.env；apps/server/.env 软链接到它（Nest / Prisma / seed 都读这个路径）
if [ ! "$ENV_FILE" -ef "$LOCAL_ENV" ]; then
  rm -f "$ENV_FILE"
  ln -s ../../deploy/envs/local.env "$ENV_FILE"
fi

DB_INFO="$(node "$ENV_TOOL" db "$ENV_FILE")" || exit 1
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"; DB_PORT="$(sed -n 2p <<< "$DB_INFO")"; DB_NAME="$(sed -n 5p <<< "$DB_INFO")"
case "$DB_HOST" in localhost|127.0.0.1) ;; *) die "DATABASE_URL 指向 ${DB_HOST}，本地脚本只操作本机数据库" ;; esac
SERVER_PORT="$(node "$ENV_TOOL" get "$ENV_FILE" PORT 3000)"
WEB_PORT="${SB_WEB_PORT:-$(node "$ENV_TOOL" get "$ENV_FILE" WEB_PORT 5173)}"

port_pids() { lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true; }
pid_cwd() {
  if [ -e "/proc/$1/cwd" ]; then readlink "/proc/$1/cwd" 2>/dev/null
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; fi
}
# 只认工作目录在本项目内的进程：端口可能被别的项目占用，不能误杀
is_ours() { case "$(pid_cwd "$1")" in "$ROOT"|"$ROOT"/*) return 0 ;; *) return 1 ;; esac; }
our_port_pids() { local p; for p in $(port_pids "$1"); do is_ours "$p" && echo "$p"; done; return 0; }
foreign_port_pids() { local p; for p in $(port_pids "$1"); do is_ours "$p" || echo "$p"; done; return 0; }
prisma() { (cd "$SERVER" && pnpm exec prisma "$@"); }

ensure_tools() {
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）"
  local pv; pv="$(pnpm -v 2>/dev/null || true)"
  [[ "$pv" == 9.* ]] || die "需要 pnpm 9.x（当前: ${pv:-无法运行}）。执行 corepack enable，或 npm i -g pnpm@9"
  command -v lsof >/dev/null 2>&1 || die "需要 lsof（用于按端口停止进程）"
}

wait_mysql() {
  node "$ENV_TOOL" wait-tcp "$DB_HOST" "$DB_PORT" 1 && return 0
  info "等待 MySQL 就绪（$DB_HOST:${DB_PORT}）..."
  node "$ENV_TOOL" wait-tcp "$DB_HOST" "$DB_PORT" 15 || die "MySQL 未运行。请先启动（如 brew services start mysql）后重试"
}

ensure_deps() {
  if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
    info "安装依赖（pnpm install）..."
    pnpm install --frozen-lockfile
  fi
  info "构建共享包 + 生成 Prisma Client..."
  pnpm --filter @sb/shared build >/dev/null
  pnpm --filter @sb/server prisma:generate >/dev/null
}

# ---------- 停止 ----------
stop_services() {
  info "停止本地服务..."
  local stopped=0 name pid port pids
  for name in server web; do
    if [ -f "$RUN_DIR/$name.pid" ]; then
      pid="$(cat "$RUN_DIR/$name.pid")"
      # 先停整个进程组（pnpm → nest/vite → node），再兜底按端口清理
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      rm -f "$RUN_DIR/$name.pid"
      stopped=1
    fi
  done
  sleep 1
  for port in "$SERVER_PORT" "$WEB_PORT"; do
    pids="$(our_port_pids "$port")"
    [ -n "$pids" ] && { echo "$pids" | xargs kill 2>/dev/null || true; stopped=1; }
  done
  sleep 1
  for port in "$SERVER_PORT" "$WEB_PORT"; do
    pids="$(our_port_pids "$port")"
    [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
  done
  if [ "$stopped" = 1 ]; then echo "  已停止"; else echo "  （本来就没在运行）"; fi
}

# 端口被其他程序占用时拒绝启动（不杀别人的进程）
assert_ports_free() {
  local port pid busy=0
  for port in "$SERVER_PORT" "$WEB_PORT"; do
    for pid in $(foreign_port_pids "$port"); do
      warn "端口 $port 被其他程序占用: PID ${pid}（$(pid_cwd "$pid")）"
      busy=1
    done
  done
  [ "$busy" = 0 ] || die "请先停止占用端口的程序后重试（本脚本不会结束非本项目的进程）"
}

# ---------- 数据库 ----------
db_migrate() {
  info "数据库迁移（prisma migrate deploy：只执行未应用的迁移，库不存在会自动创建）..."
  prisma migrate deploy
  info "补齐种子数据（幂等）..."
  pnpm --filter @sb/server prisma:seed
}

db_fresh() {
  warn "[fresh] 清空本地数据库 $DB_NAME 并重新执行全部迁移（数据不可恢复）..."
  prisma migrate reset --force --skip-seed --skip-generate
  info "[fresh] 初始化种子数据..."
  pnpm --filter @sb/server prisma:seed
}

# ---------- 启动 ----------
start_services() {
  mkdir -p "$RUN_DIR"
  # set -m：后台进程各自独立成进程组，stop 时可整组结束（含 watch 模式派生的子进程）
  set -m
  info "启动后端（Nest :${SERVER_PORT}，watch 模式）→ .run/server.log"
  nohup pnpm --filter @sb/server dev > "$RUN_DIR/server.log" 2>&1 &
  echo $! > "$RUN_DIR/server.pid"
  # SERVER_PORT：vite 开发代理指向的后端端口（vite.config.ts 读取），与 .env 的 PORT 保持一致
  info "启动前端（Vite :${WEB_PORT}，代理 → :${SERVER_PORT}）→ .run/web.log"
  SERVER_PORT="$SERVER_PORT" nohup pnpm --filter @sb/web dev --port "$WEB_PORT" --strictPort > "$RUN_DIR/web.log" 2>&1 &
  echo $! > "$RUN_DIR/web.pid"
  set +m
}

wait_http() {
  local url="$1" name="$2" log="$3" timeout="$4" i code
  info "等待${name}就绪..."
  for i in $(seq 1 "$timeout"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$url" 2>/dev/null || true)"
    if [ -n "$code" ] && [ "$code" != 000 ]; then echo -e "  ${G}${name}已就绪（HTTP ${code}）${N}"; return 0; fi
    sleep 1
  done
  warn "$name ${timeout}s 内未响应，请查看 $log"
  tail -n 15 "$log" 2>/dev/null || true
  return 1
}

print_summary() {
  echo ""
  echo -e "${C}==========================================${N}"
  echo -e " 前端:    http://localhost:$WEB_PORT"
  echo -e " 后端API: http://localhost:$SERVER_PORT/api（前端已配代理）"
  echo -e " 账号:    admin / admin123（超级管理员）"
  echo -e " 应用日志: apps/server/logs/app.$(date +%F).log"
  echo -e " 进程输出: ./sb.sh local logs"
  echo -e " 停止:    ./sb.sh local stop"
  echo -e " 配置文件: deploy/envs/local.env"
  echo -e "${C}==========================================${N}"
}

show_status() {
  local pair name port pids
  for pair in "后端(Nest):$SERVER_PORT" "前端(Vite):$WEB_PORT"; do
    name="${pair%%:*}"; port="${pair##*:}"
    pids="$(our_port_pids "$port")"
    if [ -n "$pids" ]; then echo -e "${G}●${N} $name 运行中（:${port}，PID $(echo $pids | tr '\n' ' ')）"
    else
      echo -e "${R}○${N} $name 未运行（:${port}）"
      for pid in $(foreign_port_pids "$port"); do echo -e "    ${Y}端口被其他程序占用: PID ${pid}（$(pid_cwd "$pid")）${N}"; done
    fi
  done
  if node "$ENV_TOOL" wait-tcp "$DB_HOST" "$DB_PORT" 1; then echo -e "${G}●${N} MySQL 运行中（$DB_HOST:${DB_PORT}，库 ${DB_NAME}）"
  else echo -e "${R}○${N} MySQL 未运行（$DB_HOST:${DB_PORT}）"; fi
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$SERVER_PORT/api/health" || true)"
  [ "$code" = 200 ] && echo -e "${G}●${N} 健康检查正常" || echo -e "${R}○${N} 健康检查未通过（HTTP ${code:-无响应}）"
}

start_all() {
  local mode="$1"
  ensure_tools
  wait_mysql
  stop_services      # 先停：避免 prisma generate 时 watch 进程反复重启
  assert_ports_free
  ensure_deps
  if [ "$mode" = fresh ]; then db_fresh; else db_migrate; fi
  start_services
  wait_http "http://localhost:$SERVER_PORT/api/health" "后端" "$RUN_DIR/server.log" 90 || true
  wait_http "http://localhost:$WEB_PORT/" "前端" "$RUN_DIR/web.log" 30 || true
  print_summary
}

# ---------- 命令分发 ----------
case "${1:-restart}" in
  restart|start) start_all restart ;;
  fresh)
    echo -e "${R}将清空本地数据库 $DB_NAME 的全部数据${N}"
    read -r -p "确认请输入 yes: " CONFIRM
    [ "$CONFIRM" = yes ] || { echo "已取消"; exit 0; }
    start_all fresh
    ;;
  stop)   stop_services ;;
  status) show_status ;;
  logs)   tail -n 30 -F "$RUN_DIR/server.log" "$RUN_DIR/web.log" ;;
  -h|--help|help) usage ;;
  *) echo "未知命令: $1"; usage ;;
esac
