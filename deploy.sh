#!/usr/bin/env bash
# ============================================================
# SystemBase 一键部署到远程服务器（Mac/Linux 版，Windows 请用 deploy.ps1）
# 方式：本机构建 → 打包上传 → 服务器安装依赖/迁移/切换版本/PM2 重启/健康检查（失败自动回滚）
#
# 用法（推荐使用统一入口 ./sb.sh，本脚本等价于 ./sb.sh remote-*）:
#   ./deploy.sh <环境> init              首次：初始化服务器（Node20/pnpm/PM2/Nginx/MySQL、建库、站点）并发布
#   ./deploy.sh <环境>                   日常发布（一条命令）
#   ./deploy.sh <环境> fresh             重置发布：清空远程数据库全部数据后重建（需输入库名确认）
#   ./deploy.sh <环境> status            服务状态 / 当前版本 / 健康检查 / 今日错误数
#   ./deploy.sh <环境> logs [级别|pm2|follow] [日期]
#                                       应用日志（默认今天最近 100 行；ERROR/WARN 过滤；follow 持续跟踪）
#   ./deploy.sh <环境> releases          已发布版本列表
#   ./deploy.sh <环境> rollback [版本号] 回滚到上一版本（或指定版本），数据库不回退
#   ./deploy.sh <环境> restart|start|stop
#   ./deploy.sh <环境> ssl 域名          部署 HTTPS（Let's Encrypt + 自动续期）
#   ./deploy.sh <环境> db-remote-on [IP] / db-remote-off [IP]   临时开放 / 关闭数据库远程访问
#   ./deploy.sh <环境> ssh               登录服务器
# 环境: remote-pre（预发布）/ remote-release（正式），对应 deploy/envs/<环境>.env
# 前置:
#   1. cp deploy/envs/remote-pre.env.example deploy/envs/remote-pre.env 并填写 SSH_HOST 与应用配置
#   2. SSH 免密登录（推荐）: ssh-copy-id root@服务器IP；或在 env 里填 SSH_PASSWORD（需本机安装 sshpass）
# 可选环境变量: SKIP_TESTS=1 跳过发布前单测；DB_ROOT_PASS=xxx init 时提供 MySQL root 密码
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] && shift
CMD="${1:-deploy}"
[ $# -gt 0 ] && shift
ENV_FILE="deploy/envs/$ENV_NAME.env"
mkdir -p .run
ENV_PROD="$ROOT/.run/env.production"   # 从环境文件剔除部署键后生成的应用配置（产物，gitignore）
ENV_TOOL="deploy/server/env-tool.cjs"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
step() { echo -e "\n${C}==> $*${N}"; }
die()  { echo -e "${R}✗ $*${N}" >&2; exit 1; }

usage() { sed -n '6,23p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
case "$ENV_NAME" in -h|--help|help|"") usage ;; esac
case "$CMD" in -h|--help|help) usage ;; esac

# ---------- 读取环境配置（deploy/envs/<环境>.env） ----------
command -v node >/dev/null 2>&1 || die "需要 Node.js ≥ 20"
[ -f "$ENV_FILE" ] || die "缺少 ${ENV_FILE}（cp deploy/envs/$ENV_NAME.env.example $ENV_FILE 后填写）"
get_env() { node "$ENV_TOOL" get "$ENV_FILE" "$1" "${2:-}"; }

HOST="$(get_env SSH_HOST)"
SSH_PORT="$(get_env SSH_PORT 22)";  [ -n "$SSH_PORT" ] || SSH_PORT=22
SSH_USER="$(get_env SSH_USER root)"; [ -n "$SSH_USER" ] || SSH_USER=root
SSH_PASSWORD="$(get_env SSH_PASSWORD)"
APP_DIR="$(get_env DEPLOY_DIR /opt/systembase)"
APP_NAME="$(get_env APP_NAME systembase)"
KEEP="$(get_env KEEP_RELEASES 5)"
NPM_REGISTRY="$(get_env NPM_REGISTRY https://registry.npmmirror.com)"
[ -n "$HOST" ] && [[ "$HOST" != *YOUR_* ]] || die "请先在 $ENV_FILE 中填写 SSH_HOST"
[ -n "$APP_DIR" ] || die "DEPLOY_DIR 不能为空"
[ "$APP_DIR" != "/" ] && [[ "$APP_DIR" == /* ]] || die "DEPLOY_DIR 必须是绝对路径，如 /opt/systembase"
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || die "APP_NAME 只能包含小写字母、数字、连字符"
OPS="bash $APP_DIR/current/deploy/server/ops.sh $APP_DIR $APP_NAME"
TARGET="$SSH_USER@$HOST"

# 应用配置 = 环境文件剔除部署专用键（上传为服务器 .env，每次发布前重新生成）
grep -vE "^[[:space:]]*(SSH_HOST|SSH_PORT|SSH_USER|SSH_PASSWORD|DEPLOY_DIR|APP_NAME|KEEP_RELEASES|NPM_REGISTRY)=" "$ENV_FILE" \
  | sed 's/\r$//' > "$ENV_PROD"

# ---------- SSH 执行（免密优先；配置了 SSH_PASSWORD 则走 sshpass） ----------
if [ -n "$SSH_PASSWORD" ]; then
  command -v sshpass >/dev/null 2>&1 || die "已配置 SSH_PASSWORD，但本机未安装 sshpass（macOS: brew install sshpass / Ubuntu: apt install sshpass）"
  # 密码经 SSHPASS 环境变量传入（不出现在 ps 参数里）；首次连接自动接受主机指纹
  run_ssh()  { env SSHPASS="$SSH_PASSWORD" sshpass -e "$@"; }
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)
  remote()     { run_ssh ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
  remote_tty() { run_ssh ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }
  upload()     { run_ssh scp -P "$SSH_PORT" -o ConnectTimeout=10 -q "$@"; }
else
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o BatchMode=yes)
  remote()     { ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
  remote_tty() { ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }
  upload()     { scp -P "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 -q "$@"; }
fi

check_ssh() {
  remote "true" 2>/dev/null || die "无法登录 $TARGET:${SSH_PORT}。请配置免密（ssh-copy-id -p $SSH_PORT ${TARGET}）或在 $ENV_FILE 填写 SSH_PASSWORD"
}
check_env() {
  node "$ENV_TOOL" check "$ENV_PROD" >/dev/null || exit 1
}
site_url() {
  local cors; cors="$(node "$ENV_TOOL" get "$ENV_PROD" CORS_ORIGINS "http://$HOST")"
  echo "${cors%%,*}"
}

# ---------- 构建 ----------
build() {
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）"
  local pv; pv="$(pnpm -v 2>/dev/null || true)"
  [[ "$pv" == 9.* ]] || die "需要 pnpm 9.x（当前: ${pv:-无法运行}）。执行 corepack enable，或 npm i -g pnpm@9"
  [ -d node_modules ] || { step "安装依赖"; pnpm install --frozen-lockfile; }
  step "构建共享包 + 生成 Prisma Client"
  pnpm --filter @sb/shared build
  pnpm --filter @sb/server prisma:generate >/dev/null
  if [ "${SKIP_TESTS:-0}" != "1" ]; then
    step "后端单元测试（SKIP_TESTS=1 可跳过）"
    pnpm --filter @sb/server test --silent
  fi
  step "构建后端（nest build）"
  pnpm --filter @sb/server build
  step "构建前端（vue-tsc + vite build）"
  pnpm --filter @sb/web build
}

# ---------- 打包：只含运行所需文件，node_modules 在服务器按 lockfile 安装 ----------
pack() {
  local stamp="$1" stage tar
  stage="$(mktemp -d)"
  mkdir -p "$stage/packages/shared" "$stage/apps/server" "$stage/apps/web" "$stage/deploy"
  cp package.json pnpm-workspace.yaml pnpm-lock.yaml "$stage/"
  cp packages/shared/package.json "$stage/packages/shared/" && cp -R packages/shared/dist "$stage/packages/shared/dist"
  cp apps/server/package.json "$stage/apps/server/"
  cp -R apps/server/dist apps/server/prisma "$stage/apps/server/"
  cp apps/web/package.json "$stage/apps/web/" && cp -R apps/web/dist "$stage/apps/web/dist"
  cp -R deploy/server "$stage/deploy/server"
  cp "$ENV_PROD" "$stage/.env.production"
  {
    echo "release=$stamp"
    echo "env=$ENV_NAME"
    echo "builtAt=$(date '+%F %T')"
    echo "builtBy=$(whoami)@$(hostname)"
    echo "commit=$(git rev-parse --short HEAD 2>/dev/null || echo none)"
    echo "version=$(node -p 'require("./package.json").version')"
  } > "$stage/RELEASE"
  tar="$ROOT/$APP_NAME-$stamp.tar.gz"
  # COPYFILE_DISABLE / --no-xattrs：不打 macOS 扩展属性，避免服务器 GNU tar 报 unknown extended header
  local xattr=""
  [ "$(uname)" = "Darwin" ] && tar --help 2>&1 | grep -q -- --no-xattrs && xattr="--no-xattrs"
  COPYFILE_DISABLE=1 tar $xattr -czf "$tar" -C "$stage" .
  rm -rf "$stage"
  echo "$tar"
}

# ---------- 发布（mode: deploy | fresh） ----------
TAR_FILE=""
trap '[ -n "$TAR_FILE" ] && rm -f "$TAR_FILE"' EXIT   # 无论成功失败都删除本地发布包

deploy() {
  local mode="${1:-deploy}" stamp name rscript
  check_env
  check_ssh
  build
  stamp="$(date +%Y%m%d%H%M%S)"
  step "打包发布文件（环境: ${ENV_NAME}）"
  TAR_FILE="$(pack "$stamp")"; name="$(basename "$TAR_FILE")"
  echo "    ${name}（$(du -h "$TAR_FILE" | cut -f1)）"

  step "上传到 $TARGET"
  rscript="/tmp/$APP_NAME-deploy-$stamp.sh"
  upload "$TAR_FILE" "$TARGET:/tmp/$name"
  upload deploy/server/remote-deploy.sh "$TARGET:$rscript"

  if [ "$mode" = fresh ]; then step "服务器执行重置发布"; else step "服务器执行发布（依赖/迁移/切换/重启/健康检查）"; fi
  local rc=0
  remote "tr -d '\r' < $rscript > $rscript.lf; NPM_REGISTRY='$NPM_REGISTRY' bash $rscript.lf '$APP_DIR' '/tmp/$name' '$mode' '$APP_NAME' '$KEEP'; rc=\$?; rm -f $rscript $rscript.lf '/tmp/$name'; exit \$rc" || rc=$?
  [ "$rc" = 0 ] || die "发布失败（线上仍为原版本或已自动回滚）。排查: ./sb.sh $ENV_NAME logs pm2"

  echo ""
  echo -e "${G}===========================================${N}"
  echo -e "${G} 发布完成: ${stamp}（环境: $ENV_NAME → ${TARGET}）${N}"
  echo -e "${G} 访问地址: $(site_url)/${N}"
  if [ "$mode" = fresh ]; then echo -e "${R} 数据已重置，默认账号 admin / admin123，请立即登录修改密码！${N}"; fi
  echo -e "${G} 查看状态: ./sb.sh $ENV_NAME status    回滚: ./sb.sh $ENV_NAME rollback${N}"
  echo -e "${G}===========================================${N}"
}

need_release() { remote "test -L $APP_DIR/current" || die "服务器尚未发布过，请先执行 ./sb.sh $ENV_NAME init"; }

# ---------- 命令分发 ----------
case "$CMD" in
  deploy) deploy ;;

  init)
    check_env
    check_ssh
    step "1/3 上传环境配置与初始化脚本"
    remote "mkdir -p '$APP_DIR/shared' /tmp/$APP_NAME-setup"
    upload "$ENV_PROD" "$TARGET:$APP_DIR/shared/.env"
    upload deploy/server/setup-server.sh deploy/server/env-tool.cjs deploy/server/nginx-site.conf "$TARGET:/tmp/$APP_NAME-setup/"
    step "2/3 初始化服务器（Node20 / pnpm / PM2 / Nginx / MySQL / 建库 / 站点）"
    remote_tty "cd /tmp/$APP_NAME-setup && tr -d '\r' < setup-server.sh > s.sh && DB_ROOT_PASS='${DB_ROOT_PASS:-}' NPM_REGISTRY='$NPM_REGISTRY' bash s.sh '$APP_DIR' '$APP_NAME'; rc=\$?; rm -rf /tmp/$APP_NAME-setup; exit \$rc"
    step "3/3 首次发布"
    deploy
    echo -e "${Y}首次部署完成（${ENV_NAME}）：默认账号 admin / admin123，请立即登录修改密码；确认安全组已放行 80/443。${N}"
    ;;

  fresh)
    check_env
    DB_NAME="$(node "$ENV_TOOL" db "$ENV_PROD" | sed -n 5p)"
    echo ""
    echo -e "${R}====================================================${N}"
    echo -e "${R}  危险操作：远程数据库将被完全重置${N}"
    echo -e "${R}  环境: $ENV_NAME    服务器: $TARGET    数据库: $DB_NAME${N}"
    echo -e "${R}  全部业务数据将被删除且不可恢复，账号恢复为默认密码${N}"
    echo -e "${R}  （日志文件不受影响）${N}"
    echo -e "${R}====================================================${N}"
    read -r -p "请输入数据库名 $DB_NAME 确认: " CONFIRM
    [ "$CONFIRM" = "$DB_NAME" ] || { echo "已取消，未做任何改动"; exit 0; }
    deploy fresh
    ;;

  status|releases|restart|start|stop)
    need_release; remote "$OPS $CMD" ;;
  logs)
    need_release
    if [ "${1:-}" = follow ] || [ "${1:-}" = -f ]; then remote_tty "$OPS logs follow"; else remote "$OPS logs '${1:-}' '${2:-}'"; fi ;;
  rollback)
    need_release; remote "$OPS rollback '${1:-}'" ;;
  ssl)
    DOMAIN="${1:?用法: ./sb.sh $ENV_NAME ssl 你的域名}"
    need_release
    remote "bash $APP_DIR/current/deploy/server/setup-ssl.sh '$DOMAIN' '$APP_NAME' '$APP_DIR'" ;;
  db-remote-on)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' on '${1:-%}'" ;;
  db-remote-off)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' off '${1:-}'" ;;
  ssh)
    if [ -n "$SSH_PASSWORD" ]; then remote_tty "bash -l"; else ssh "${SSH_OPTS[@]}" "$TARGET"; fi ;;
  *) echo "未知命令: $CMD"; echo; usage ;;
esac
