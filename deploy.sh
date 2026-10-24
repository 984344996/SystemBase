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
#   ./deploy.sh <环境> db-backup [备注]  备份服务器数据库并拉回本地 backup/<环境>/（服务器保留 7 天）
#   ./deploy.sh <环境> db-restore <文件>  用本地 backup/<环境>/xxx.sql.gz 恢复服务器数据库（需输入库名确认）
#   ./deploy.sh <环境> doctor            环境体检：版本/服务/健康检查/磁盘/错误日志/备份 + 本地与服务器配置差异
#   ./deploy.sh <环境> db-remote-on [IP] / db-remote-off [IP]   临时开放 / 关闭数据库远程访问
#   ./deploy.sh <环境> ssh               登录服务器
# 环境: remote-<名字>（如 remote-pre 预发布 / remote-release 正式），对应 deploy/envs/<环境>.env
# 前置:
#   1. cp deploy/envs/remote.env.example deploy/envs/<环境>.env 并填写 SSH_HOST 与应用配置
#      （所有远程环境共用这一份模板；新增环境复制同一份，环境名只能小写字母、数字、连字符）
#   2. SSH 免密登录（推荐）: ssh-copy-id root@服务器IP；或在 env 里填 SSH_PASSWORD（需本机安装 sshpass）
# 可选环境变量: SKIP_TESTS=1 跳过发布前单测；DB_ROOT_PASS 优先取环境变量，其次 env 文件部署段（init 建库用）
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

usage() { sed -n '6,26p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
case "$ENV_NAME" in -h|--help|help|"") usage ;; esac
case "$CMD" in -h|--help|help) usage ;; esac

# ---------- 读取环境配置（deploy/envs/<环境>.env） ----------
command -v node >/dev/null 2>&1 || die "需要 Node.js ≥ 20"
[ -f "$ENV_FILE" ] || die "缺少 ${ENV_FILE}（先 cp deploy/envs/remote.env.example $ENV_FILE 后填写）"
get_env() { node "$ENV_TOOL" get "$ENV_FILE" "$1" "${2:-}"; }

HOST="$(get_env SSH_HOST)"
SSH_PORT="$(get_env SSH_PORT 22)";  [ -n "$SSH_PORT" ] || SSH_PORT=22
SSH_USER="$(get_env SSH_USER root)"; [ -n "$SSH_USER" ] || SSH_USER=root
SSH_PASSWORD="$(get_env SSH_PASSWORD)"
APP_DIR="$(get_env DEPLOY_DIR /opt/systembase)"
APP_NAME="$(get_env APP_NAME systembase)"
KEEP="$(get_env KEEP_RELEASES 5)"
NPM_REGISTRY="$(get_env NPM_REGISTRY https://registry.npmmirror.com)"
# init 建库用的 MySQL root 密码（环境变量优先，其次 env 文件部署段；不会上传服务器）
DB_ROOT_PASS="${DB_ROOT_PASS:-$(get_env DB_ROOT_PASS)}"
[ -n "$HOST" ] && [[ "$HOST" != *YOUR_* ]] || die "请先在 $ENV_FILE 中填写 SSH_HOST"
[ -n "$APP_DIR" ] || die "DEPLOY_DIR 不能为空"
[ "$APP_DIR" != "/" ] && [[ "$APP_DIR" == /* ]] || die "DEPLOY_DIR 必须是绝对路径，如 /opt/systembase"
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || die "APP_NAME 只能包含小写字母、数字、连字符"
OPS="bash $APP_DIR/current/deploy/server/ops.sh $APP_DIR $APP_NAME"
TARGET="$SSH_USER@$HOST"
# 服务器安装/使用的 pnpm 版本与仓库 packageManager 锁定值保持一致（取不到时用服务器脚本内置默认）
PM_SPEC="$(node -p "require('./package.json').packageManager || ''")"
PM_VER="9"
if [[ "$PM_SPEC" == pnpm@* ]]; then PM_VER="${PM_SPEC#pnpm@}"; fi

# 应用配置 = 环境文件剔除部署专用键（上传为服务器 .env，每次发布前重新生成）
# ⚠ 新增部署段变量时必须加进这份名单（deploy.ps1 的 $deployKeys 同步），否则会被上传到服务器
grep -vE "^[[:space:]]*(SSH_HOST|SSH_PORT|SSH_USER|SSH_PASSWORD|DEPLOY_DIR|APP_NAME|KEEP_RELEASES|NPM_REGISTRY|DB_ROOT_PASS)=" "$ENV_FILE" \
  | sed 's/\r$//' > "$ENV_PROD"
chmod 600 "$ENV_PROD"   # 含 JWT_SECRET / 数据库密码，限本机当前用户可读

# ---------- SSH 执行（免密优先；配置了 SSH_PASSWORD 则走 sshpass） ----------
if [ -n "$SSH_PASSWORD" ]; then
  command -v sshpass >/dev/null 2>&1 || die "已配置 SSH_PASSWORD，但本机未安装 sshpass（macOS: brew install sshpass / Ubuntu: apt install sshpass）"
  # 密码经 SSHPASS 环境变量传入（不出现在 ps 参数里）；首次连接自动接受主机指纹
  run_ssh()  { env SSHPASS="$SSH_PASSWORD" sshpass -e "$@"; }
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)
  remote()     { run_ssh ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
  remote_tty() { run_ssh ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }
  upload()     { run_ssh scp -P "$SSH_PORT" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -q "$@"; }
else
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o BatchMode=yes)
  remote()     { ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
  remote_tty() { ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }
  upload()     { scp -P "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -q "$@"; }
fi

check_ssh() {
  remote "true" 2>/dev/null || die "无法登录 $TARGET:${SSH_PORT}。请配置免密（ssh-copy-id -p $SSH_PORT ${TARGET}）或在 $ENV_FILE 填写 SSH_PASSWORD"
}
check_env() {
  node "$ENV_TOOL" check "$ENV_PROD" >/dev/null || exit 1
}
site_url() {
  local cors; cors="$(node "$ENV_TOOL" get "$ENV_PROD" CORS_ORIGINS "http://$HOST")"
  echo "${cors%%,*}$(node "$ENV_TOOL" get "$ENV_PROD" SITE_PATH "")"
}

# vite base 路径：根路径部署为 "/"；子路径部署（SITE_PATH=/systembase-pre）为 "/systembase-pre/"（带尾斜杠）
site_base_path() {
  local p; p="$(node "$ENV_TOOL" get "$ENV_PROD" SITE_PATH "")"
  [ -n "$p" ] || { echo "/"; return; }
  case "$p" in /*) ;; *) p="/$p" ;; esac
  echo "${p%/}/"
}

# ---------- 构建 ----------
build() {
  command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请执行 corepack enable（或 npm i -g pnpm@9）"
  local pv; pv="$(pnpm -v 2>/dev/null || true)"
  [[ "$pv" == 9.* ]] || die "需要 pnpm 9.x（当前: ${pv:-无法运行}）。执行 corepack enable，或 npm i -g pnpm@9"
  # 始终按 lockfile 同步依赖：node_modules 存在但 lockfile 已变时，避免用旧依赖构建出与服务器不一致的产物
  step "同步依赖（lockfile 未变化时秒级完成）"
  pnpm install --frozen-lockfile
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
  # 子路径部署（SITE_PATH，如 /systembase-pre）：vite base / 路由 / API 前缀随构建产物自动适配
  SB_BASE_PATH="$(site_base_path)" pnpm --filter @sb/web build
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
  remote "tr -d '\r' < $rscript > $rscript.lf; NPM_REGISTRY='$NPM_REGISTRY' PNPM_VERSION='$PM_VER' bash $rscript.lf '$APP_DIR' '/tmp/$name' '$mode' '$APP_NAME' '$KEEP'; rc=\$?; rm -f $rscript $rscript.lf '/tmp/$name'; exit \$rc" || rc=$?
  [ "$rc" = 0 ] || die "发布失败（线上仍为原版本或已自动回滚）。排查: ./sb.sh $ENV_NAME logs pm2"

  echo ""
  echo -e "${G}===========================================${N}"
  echo -e "${G} 发布完成: ${stamp}（环境: $ENV_NAME → ${TARGET}）${N}"
  echo -e "${G} 访问地址: $(site_url)/${N}"
  if [ "$mode" = fresh ]; then echo -e "${R} 数据已重置：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），请立即登录修改密码${N}"; fi
  echo -e "${G} 查看状态: ./sb.sh $ENV_NAME status    回滚: ./sb.sh $ENV_NAME rollback${N}"
  echo -e "${G}===========================================${N}"
}

need_release() { remote "test -L $APP_DIR/current" || die "服务器尚未发布过，请先执行 ./sb.sh $ENV_NAME init"; }

# ---------- 命令分发 ----------
# 每个命令在服务器上实际发生的动作（详见 sb.sh 顶部注释）：
#   deploy   本机构建打包 → 上传 → 装依赖 → migrate deploy → 切软链 → PM2 重启 → 健康检查（失败自动回滚）
#   init     服务器装环境 → 建库建账号 → Nginx 站点 → 放行防火墙 → PM2 自启 → 再执行一次 deploy
#   fresh    服务端 prisma migrate reset 清库后重新发布（需输入库名确认）
#   status   读取服务器 current 版本、PM2/Nginx 状态、磁盘、今日 ERROR/WARN 数、健康检查
#   logs     读服务器当天日志文件（级别/日期/follow/pm2 四种用法）
#   releases / rollback   列出历史版本 / 切换软链回滚（数据库不回退）
#   restart / start / stop  重启/启动/停止应用（start、stop 连带 Nginx）
#   ssl      申请证书 + 301 跳转 + 自动续期
#   db-remote-on / off     临时开放/关闭数据库远程访问
#   ssh      交互式登录服务器
#   db-backup / db-restore / doctor   见 deploy/server/db-backup.sh 与 doctor.sh
case "$CMD" in
  deploy) deploy ;;

  init)
    check_env
    check_ssh
    step "1/3 上传环境配置与初始化脚本"
    remote "mkdir -p '$APP_DIR/shared' /tmp/$APP_NAME-setup"
    upload "$ENV_PROD" "$TARGET:$APP_DIR/shared/.env"
    upload deploy/server/setup-server.sh deploy/server/env-tool.cjs deploy/server/nginx-setup.sh deploy/server/nginx-site.conf deploy/server/nginx-locations.conf "$TARGET:/tmp/$APP_NAME-setup/"
    step "2/3 初始化服务器（Node20 / pnpm / PM2 / Nginx / MySQL / 建库 / 站点）"
    remote_tty "cd /tmp/$APP_NAME-setup && tr -d '\r' < setup-server.sh > s.sh && DB_ROOT_PASS='${DB_ROOT_PASS:-}' NPM_REGISTRY='$NPM_REGISTRY' PNPM_VERSION='$PM_VER' bash s.sh '$APP_DIR' '$APP_NAME'; rc=\$?; rm -rf /tmp/$APP_NAME-setup; exit \$rc"
    step "3/3 首次发布"
    deploy
    echo -e "${Y}首次部署完成（${ENV_NAME}）：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），请立即登录修改密码；确认安全组已放行 80/443。${N}"
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
    # 参数会拼进远端命令，先做白名单校验（级别仅字母，日期 YYYY-MM-DD）
    case "${1:-}" in ""|pm2|follow|-f) ;; *) [[ "$1" =~ ^[A-Za-z]+$ ]] || die "日志级别参数只支持字母（ERROR/WARN/INFO/pm2/follow）" ;; esac
    [ -z "${2:-}" ] || [[ "$2" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "日期格式应为 YYYY-MM-DD"
    if [ "${1:-}" = follow ] || [ "${1:-}" = -f ]; then remote_tty "$OPS logs follow"; else remote "$OPS logs '${1:-}' '${2:-}'"; fi ;;
  rollback)
    [ -z "${1:-}" ] || [[ "$1" =~ ^[0-9]{14}$ ]] || die "版本号为 14 位时间戳（./sb.sh $ENV_NAME releases 查看）"
    need_release; remote "$OPS rollback '${1:-}'" ;;
  ssl)
    DOMAIN="${1:?用法: ./sb.sh $ENV_NAME ssl 你的域名}"
    need_release
    remote "bash $APP_DIR/current/deploy/server/setup-ssl.sh '$DOMAIN' '$APP_NAME' '$APP_DIR'" ;;
  db-remote-on)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' on '${1:-%}'" ;;
  db-remote-off)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' off '${1:-}'" ;;

  # 备份：服务器端 mysqldump → 拉回本地 backup/<环境>/（服务器备份目录同时保留，由服务器脚本按 7 天清理）
  db-backup)
    need_release; check_ssh
    stamp="$(date +%Y%m%d%H%M%S)"
    mkdir -p "backup/${ENV_NAME}"
    step "在服务器备份数据库（环境: ${ENV_NAME}）"
    rscript="/tmp/${APP_NAME}-dbbackup-${stamp}.sh"
    upload deploy/server/db-backup.sh "$TARGET:${rscript}"
    remote_file="$(remote "tr -d '\r' < ${rscript} > ${rscript}.lf; bash ${rscript}.lf '${APP_DIR}' '${APP_NAME}' backup '${1:-}'; rc=\$?; rm -f ${rscript} ${rscript}.lf; exit \$rc" | tail -n 1)"
    [ -n "$remote_file" ] || die "备份失败：未取得服务器上的备份文件（排查: ./sb.sh ${ENV_NAME} logs pm2）"
    name="$(basename "$remote_file")"
    step "拉回本地 backup/${ENV_NAME}/${name}"
    upload "$TARGET:${remote_file}" "backup/${ENV_NAME}/${name}"
    echo -e "${G}✓ 已保存到 backup/${ENV_NAME}/${name}（$(du -h "backup/${ENV_NAME}/${name}" | cut -f1)）${N}"
    ;;

  # 恢复：危险操作，需输入库名确认；服务器端脚本恢复前会自动先备份当前库
  db-restore)
    need_release; check_ssh
    SRC="${1:?用法: ./sb.sh ${ENV_NAME} db-restore backup/${ENV_NAME}/xxx.sql.gz}"
    [ -f "$SRC" ] || die "本地备份文件不存在: ${SRC}（可用 ls backup/${ENV_NAME} 查看）"
    DB_NAME="$(node "$ENV_TOOL" db "$ENV_PROD" | sed -n 5p)"
    echo ""
    echo -e "${R}====================================================${N}"
    echo -e "${R}  危险操作：服务器数据库将被覆盖${N}"
    echo -e "${R}  环境: ${ENV_NAME}    服务器: ${TARGET}    数据库: ${DB_NAME}${N}"
    echo -e "${R}  来源: ${SRC}${N}"
    echo -e "${R}  现有数据将被备份文件中的内容覆盖（恢复前服务器会自动先备份当前库）${N}"
    echo -e "${R}====================================================${N}"
    read -r -p "请输入数据库名 ${DB_NAME} 确认: " CONFIRM
    [ "$CONFIRM" = "$DB_NAME" ] || { echo "已取消，未做任何改动"; exit 0; }
    stamp="$(date +%Y%m%d%H%M%S)"
    step "上传备份文件并恢复"
    rfile="/tmp/${APP_NAME}-restore-${stamp}.sql.gz"
    rscript="/tmp/${APP_NAME}-restore-${stamp}.sh"
    upload "$SRC" "$TARGET:${rfile}"
    upload deploy/server/db-backup.sh "$TARGET:${rscript}"
    remote "tr -d '\r' < ${rscript} > ${rscript}.lf; bash ${rscript}.lf '${APP_DIR}' '${APP_NAME}' restore '${rfile}'; rc=\$?; rm -f ${rscript} ${rscript}.lf ${rfile}; exit \$rc"
    echo -e "${G}✓ 恢复完成${N}"
    ;;

  # 体检：额外上传本地应用配置，比对服务器 shared/.env 是否有未同步的改动
  doctor)
    need_release; check_ssh
    stamp="$(date +%Y%m%d%H%M%S)"
    expect="/tmp/${APP_NAME}-expect-${stamp}.env"
    rscript="/tmp/${APP_NAME}-doctor-${stamp}.sh"
    step "环境体检（${ENV_NAME} → ${TARGET}）"
    upload "$ENV_PROD" "$TARGET:${expect}"
    upload deploy/server/doctor.sh "$TARGET:${rscript}"
    remote "tr -d '\r' < ${rscript} > ${rscript}.lf; bash ${rscript}.lf '${APP_DIR}' '${APP_NAME}' '${expect}'; rc=\$?; rm -f ${rscript} ${rscript}.lf ${expect}; exit \$rc"
    ;;

  ssh)
    if [ -n "$SSH_PASSWORD" ]; then remote_tty "bash -l"; else ssh "${SSH_OPTS[@]}" "$TARGET"; fi ;;
  *) echo "未知命令: $CMD"; echo; usage ;;
esac
