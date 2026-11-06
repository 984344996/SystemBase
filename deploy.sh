#!/usr/bin/env bash
# ============================================================
# SystemBase 一键部署到远程服务器（Mac/Linux 版，Windows 请用 deploy.ps1）
# 方式：本机构建 → 打包上传 → 服务器后台执行发布（装依赖/备份/迁移/切换版本/PM2 重启/健康检查，失败自动回滚）
#
# 用法（推荐用统一入口 ./sb.sh，本脚本等价于 ./sb.sh remote-*）:
#   ./deploy.sh <环境> init              首次：初始化服务器（Node20/pnpm/PM2/Nginx/MySQL、建库、站点）并发布
#   ./deploy.sh <环境>                   日常发布（一条命令）
#   ./deploy.sh <环境> fresh             重置发布：清空远程数据库全部数据后重建（需输入库名确认）
#   ./deploy.sh <环境> deploy-log [版本号] 查看最近一次（或指定版本）发布的完整输出；发布进行中则持续跟踪
#   ./deploy.sh <环境> status            服务状态 / 当前版本 / 健康检查 / 今日错误数
#   ./deploy.sh <环境> logs [级别|pm2|follow] [日期]
#                                       应用日志（默认今天最近 100 行；ERROR/WARN 过滤；follow 持续跟踪）
#   ./deploy.sh <环境> releases          已发布版本列表
#   ./deploy.sh <环境> rollback [版本号] 回滚到上一版本（或指定版本）：代码 + 配置 + Nginx，数据库不回退
#   ./deploy.sh <环境> restart|start|stop  重启 / 启动 / 停止（stop 后页面显示维护中）
#   ./deploy.sh <环境> migrate-status    查看数据库迁移状态（待执行 / 执行失败的迁移）
#   ./deploy.sh <环境> migrate-resolve <applied|rolled-back> <迁移名>   人工处理失败迁移后标记结果
#   ./deploy.sh <环境> ssl 域名          部署 HTTPS（Let's Encrypt + 自动续期；子路径部署不适用）
#   ./deploy.sh <环境> db-backup [备注]  备份服务器数据库并拉回本地 backup/<环境>/（服务器保留 7 天）
#   ./deploy.sh <环境> db-restore <文件>  用本地 backup/<环境>/xxx.sql.gz 恢复服务器数据库（需输入库名确认）
#   ./deploy.sh <环境> doctor            环境体检：版本/服务/健康检查/磁盘/错误日志/备份 + 本地与服务器配置差异
#   ./deploy.sh <环境> db-remote-on [IP] / db-remote-off [IP]   临时开放 / 关闭数据库远程访问
#   ./deploy.sh <环境> ssh               登录服务器
#
# 环境: remote-<名字>（如 remote-pre 预发布 / remote-release 正式），对应 deploy/envs/<环境>.env
# 前置:
#   1. cp deploy/envs/remote.env.example deploy/envs/<环境>.env 并填写 SSH_HOST 与应用配置
#   2. SSH 免密登录（推荐）: ssh-copy-id root@服务器IP；或在 env 里填 SSH_PASSWORD（需本机安装 sshpass）
#
# 可选环境变量:
#   SKIP_TESTS=1        跳过发布前单测（正式环境不允许）
#   DB_ROOT_PASS=xxx    init 建库用的 MySQL root 密码（优先于 env 文件部署段）
#   SKIP_DB_BACKUP=1    跳过服务器端「迁移前自动备份」
#   FORCE_FRESH=1       fresh 清库前备份失败时仍继续
#   ALLOW_FRESH=1       允许对正式环境执行 fresh
#   CONFIRM=<环境名>    跳过正式环境的交互确认（脚本/CI 中使用）
#   FORCE=1             跳过正式环境的发布检查（工作区干净 / main|master 分支 / 不跳过测试）
# 正式环境 = env 部署段 PROTECTED=true，或未配置 PROTECTED 时环境名为 remote-release
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
ENV_NAME="${1:-}"
[ -n "$ENV_NAME" ] && shift
CMD="${1:-deploy}"
[ $# -gt 0 ] && shift
ENV_FILE="deploy/envs/$ENV_NAME.env"
ENV_TOOL="deploy/server/env-tool.cjs"
mkdir -p .run

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; C='\033[0;36m'; N='\033[0m'
step() { echo -e "\n${C}==> $*${N}"; }   # 步骤标题
die()  { echo -e "${R}✗ $*${N}" >&2; exit 1; }   # 打印错误并退出

# 打印顶部注释里的用法说明（从第 3 行到注释块结束）
usage() { awk 'NR>2 { if (/^# ={10}/) exit; print }' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
case "$ENV_NAME" in -h|--help|help|"") usage ;; esac
case "$CMD" in -h|--help|help) usage ;; esac

# ============================================================
# 一、读取环境配置（deploy/envs/<环境>.env）
# ============================================================
command -v node >/dev/null 2>&1 || die "需要 Node.js ≥ 20"
[ -f "$ENV_FILE" ] || die "缺少 ${ENV_FILE}（先 cp deploy/envs/remote.env.example $ENV_FILE 后填写）"

# 读取 env 文件中的变量：get_env KEY [默认值]
get_env() { node "$ENV_TOOL" get "$ENV_FILE" "$1" "${2:-}"; }

HOST="$(get_env SSH_HOST)"
SSH_PORT="$(get_env SSH_PORT 22)";  [ -n "$SSH_PORT" ] || SSH_PORT=22
SSH_USER="$(get_env SSH_USER root)"; [ -n "$SSH_USER" ] || SSH_USER=root
SSH_PASSWORD="$(get_env SSH_PASSWORD)"
APP_DIR="$(get_env DEPLOY_DIR /opt/systembase)"
APP_NAME="$(get_env APP_NAME systembase)"
KEEP="$(get_env KEEP_RELEASES 5)"
NPM_REGISTRY="$(get_env NPM_REGISTRY https://registry.npmmirror.com)"
# init 建库用的 MySQL root 密码（环境变量优先，其次 env 文件部署段；以文件方式上传，用完即删）
DB_ROOT_PASS="${DB_ROOT_PASS:-$(get_env DB_ROOT_PASS)}"
[ -n "$HOST" ] && [[ "$HOST" != *YOUR_* ]] || die "请先在 $ENV_FILE 中填写 SSH_HOST"
# 部署目录会拼进远程命令：必须是绝对路径且只含安全字符
[[ "$APP_DIR" =~ ^/[A-Za-z0-9._/-]+$ ]] && [ "$APP_DIR" != "/" ] || die "DEPLOY_DIR 必须是绝对路径且只含字母数字 . _ - /，如 /opt/systembase"
[[ "$APP_NAME" =~ ^[a-z][a-z0-9-]*$ ]] || die "APP_NAME 只能包含小写字母、数字、连字符"

# 正式环境标记：PROTECTED=true/1 → 是；false/0 → 否；未配置时环境名为 remote-release 视为正式
case "$(get_env PROTECTED "")" in
  1|true|yes) PROTECTED=1 ;;
  0|false|no) PROTECTED=0 ;;
  *) if [ "$ENV_NAME" = remote-release ]; then PROTECTED=1; else PROTECTED=0; fi ;;
esac

OPS="bash $APP_DIR/current/deploy/server/ops.sh $APP_DIR $APP_NAME"   # 服务器运维命令前缀
TARGET="$SSH_USER@$HOST"
# 服务器安装/使用的 pnpm 版本与仓库 packageManager 锁定值保持一致（取不到时用服务器脚本内置默认）
PM_SPEC="$(node -p "require('./package.json').packageManager || ''")"
PM_VER="9"
if [[ "$PM_SPEC" == pnpm@* ]]; then PM_VER="${PM_SPEC#pnpm@}"; fi

# ============================================================
# 二、应用配置文件 + 退出清理
# ============================================================
# 应用配置 = 环境文件剔除部署专用键（上传为服务器 shared/.env）。每次执行生成一个独立的临时文件：
# 同时操作两个环境（或同一环境的两个命令）互不覆盖；退出时自动删除，生产密钥不在本机常驻
# ⚠ 新增部署段变量时必须加进这份名单（deploy.ps1 的 $deployKeys 同步），否则会被上传到服务器
DEPLOY_KEYS="SSH_HOST|SSH_PORT|SSH_USER|SSH_PASSWORD|DEPLOY_DIR|APP_NAME|KEEP_RELEASES|NPM_REGISTRY|DB_ROOT_PASS|PROTECTED"
rm -f .run/env.production   # 清理旧版本脚本留下的固定文件名配置
ENV_PROD="$(mktemp "$ROOT/.run/env.$ENV_NAME.XXXXXX")"   # mktemp 创建的文件权限即为 600

TAR_FILE=""      # 本地发布包（退出时删除）
STAGE_DIR=""     # 打包暂存目录（退出时删除）
LOCAL_LOCK=""    # 本机构建锁目录（本进程持有时退出删除）
# 退出时统一清理：发布包、暂存目录、临时配置、本机构建锁
cleanup_local() {
  [ -n "$TAR_FILE" ] && rm -f "$TAR_FILE"
  [ -n "$STAGE_DIR" ] && rm -rf "$STAGE_DIR"
  rm -f "$ENV_PROD"
  [ -n "$LOCAL_LOCK" ] && rm -rf "$LOCAL_LOCK"
  return 0
}
trap cleanup_local EXIT

# 兼容 `export KEY=` 写法；去掉 CRLF
grep -vE "^[[:space:]]*(export[[:space:]]+)?($DEPLOY_KEYS)[[:space:]]*=" "$ENV_FILE" | sed 's/\r$//' > "$ENV_PROD"

# ============================================================
# 三、SSH 执行（免密优先；配置了 SSH_PASSWORD 则走 sshpass）
# ============================================================
if [ -n "$SSH_PASSWORD" ]; then
  command -v sshpass >/dev/null 2>&1 || die "已配置 SSH_PASSWORD，但本机未安装 sshpass（macOS: brew install sshpass / Ubuntu: apt install sshpass）"
  # 密码经 SSHPASS 环境变量传入（不出现在 ps 参数里）；首次连接自动接受主机指纹
  run_ssh()  { env SSHPASS="$SSH_PASSWORD" sshpass -e "$@"; }
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)
  remote()     { run_ssh ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }      # 远程执行一条命令
  remote_tty() { run_ssh ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }   # 远程执行（分配终端，可交互）
  upload()     { run_ssh scp -P "$SSH_PORT" -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -q "$@"; }   # scp 上传/下载
else
  # 免密（密钥）方式：BatchMode 禁止交互式输入密码，密钥不可用时直接失败而不是卡住；三个函数含义同上
  SSH_OPTS=(-p "$SSH_PORT" -o ConnectTimeout=10 -o ServerAliveInterval=30 -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
  remote()     { ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
  remote_tty() { ssh "${SSH_OPTS[@]}" -t "$TARGET" "$1"; }
  upload()     { scp -P "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -q "$@"; }
fi

# 检查能否登录服务器
check_ssh() {
  remote "true" 2>/dev/null || die "无法登录 $TARGET:${SSH_PORT}。请配置免密（ssh-copy-id -p $SSH_PORT ${TARGET}）或在 $ENV_FILE 填写 SSH_PASSWORD"
}

# 校验应用配置（NODE_ENV / 数据库密码 / JWT_SECRET / CORS_ORIGINS / PORT）
check_env() {
  node "$ENV_TOOL" check "$ENV_PROD" >/dev/null || exit 1
}

# 发布完成后提示的访问地址：CORS_ORIGINS 第一个地址 + SITE_PATH
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

# 服务器上必须已发布过（current 软链存在）
need_release() { remote "test -L $APP_DIR/current" || die "服务器尚未发布过，请先执行 ./sb.sh $ENV_NAME init"; }

# ============================================================
# 四、本机防护
# ============================================================

# 本机构建锁：同一工作目录同时只允许一个构建/发布（dist 与依赖只有一份，并发构建会把两个环境的产物串在一起）
#   用 mkdir 实现原子锁（macOS 无 flock）；持有者进程已不存在时自动接管
acquire_local_lock() {
  [ -z "$LOCAL_LOCK" ] || return 0
  local lock="$ROOT/.run/build.lock" pid
  if ! mkdir "$lock" 2>/dev/null; then
    pid="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      die "本机已有另一个发布正在构建（PID $pid）。构建产物只有一份，请等它结束后再发布"
    fi
    rm -rf "$lock" && mkdir "$lock"
  fi
  echo $$ > "$lock/pid"
  LOCAL_LOCK="$lock"
}

# 当前 commit；有未提交的已跟踪改动时追加 -dirty（写入 RELEASE，便于追溯线上代码）
git_commit() {
  local c
  c="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
  if [ "$c" != none ] && [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then c="$c-dirty"; fi
  echo "$c"
}

# 正式环境要求输入环境名确认（CONFIRM=<环境名> 可跳过；非交互且未设置时拒绝）
#   $1 = 即将执行的操作说明
confirm_env() {
  [ "$PROTECTED" = 1 ] || return 0
  [ "${CONFIRM:-}" = "$ENV_NAME" ] && return 0
  [ -t 0 ] || die "非交互执行正式环境操作，需设置 CONFIRM=$ENV_NAME"
  echo -e "${Y}即将对【正式环境 $ENV_NAME】执行：$1（服务器 $TARGET）${N}"
  local c; read -r -p "请输入环境名 $ENV_NAME 确认: " c
  [ "$c" = "$ENV_NAME" ] || { echo "已取消，未做任何改动"; exit 0; }
}

# 正式环境发布检查：工作区无未提交改动、在 main/master 分支、没有跳过测试（FORCE=1 可跳过），然后确认
#   $1 = 即将执行的操作说明
guard_release() {
  [ "$PROTECTED" = 1 ] || return 0
  if [ "${FORCE:-0}" = 1 ]; then
    echo -e "${Y}!! FORCE=1：跳过正式环境发布检查${N}"
  else
    local br
    git rev-parse --git-dir >/dev/null 2>&1 || die "正式环境要求在 git 仓库中发布（FORCE=1 可跳过）"
    [ -z "$(git status --porcelain --untracked-files=no)" ] \
      || die "正式环境要求工作区干净：有未提交的改动（git status 查看；FORCE=1 可跳过）"
    br="$(git rev-parse --abbrev-ref HEAD)"
    case "$br" in main|master) ;; *) die "正式环境只能从 main/master 发布（当前分支 $br；FORCE=1 可跳过）" ;; esac
    [ "${SKIP_TESTS:-0}" != 1 ] || die "正式环境不允许 SKIP_TESTS=1（FORCE=1 可跳过）"
  fi
  confirm_env "$1"
}

# ============================================================
# 五、构建 / 打包
# ============================================================

# 本机构建：依赖 → 共享包 → Prisma Client → 单测 → 后端 → 前端
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
  else
    echo -e "${Y}!! SKIP_TESTS=1：已跳过单元测试${N}"
  fi
  step "构建后端（nest build）"
  pnpm --filter @sb/server build
  step "构建前端（vue-tsc + vite build）"
  # 子路径部署（SITE_PATH，如 /systembase-pre）：vite base / 路由 / API 前缀随构建产物自动适配
  SB_BASE_PATH="$(site_base_path)" pnpm --filter @sb/web build
}

# 打包：只含运行所需文件（node_modules 在服务器按 lockfile 安装），结果写入全局 TAR_FILE
#   注意：必须直接调用（不能写成 x="$(pack)"）——命令替换的子 shell 里 set -e 失效，出错也会继续
pack() {
  local stamp="$1" xattr=""
  STAGE_DIR="$(mktemp -d)"
  mkdir -p "$STAGE_DIR/packages/shared" "$STAGE_DIR/apps/server" "$STAGE_DIR/apps/web" "$STAGE_DIR/deploy"
  cp package.json pnpm-workspace.yaml pnpm-lock.yaml "$STAGE_DIR/"
  cp packages/shared/package.json "$STAGE_DIR/packages/shared/"
  cp -R packages/shared/dist "$STAGE_DIR/packages/shared/dist"
  cp apps/server/package.json "$STAGE_DIR/apps/server/"
  cp -R apps/server/dist apps/server/prisma "$STAGE_DIR/apps/server/"
  cp apps/web/package.json "$STAGE_DIR/apps/web/"
  cp -R apps/web/dist "$STAGE_DIR/apps/web/dist"
  cp -R deploy/server "$STAGE_DIR/deploy/server"
  cp "$ENV_PROD" "$STAGE_DIR/.env.production"
  # 版本信息：服务器健康检查据 release 确认新进程已启动；commit 带 -dirty 表示含未提交改动
  {
    echo "release=$stamp"
    echo "env=$ENV_NAME"
    echo "builtAt=$(date '+%F %T')"
    echo "builtBy=$(whoami)@$(hostname)"
    echo "commit=$(git_commit)"
    echo "version=$(node -p 'require("./package.json").version')"
  } > "$STAGE_DIR/RELEASE"
  TAR_FILE="$ROOT/$APP_NAME-$stamp.tar.gz"
  # 不打 macOS 扩展属性（如 com.apple.provenance），否则服务器 GNU tar 解压时报
  #   "Ignoring unknown extended header keyword 'LIBARCHIVE.xattr...'"（不影响文件，但刷屏）
  #   COPYFILE_DISABLE=1 只去掉 ._* 资源文件，xattr 必须靠 --no-xattrs / --no-mac-metadata；
  #   bsdtar 的 --help 不列这两个选项，所以逐个实测是否支持，不支持的 tar（如 GNU tar）不加
  local opt
  for opt in --no-xattrs --no-mac-metadata; do
    tar "$opt" -cf /dev/null /dev/null 2>/dev/null && xattr="$xattr $opt"
  done
  COPYFILE_DISABLE=1 tar $xattr -czf "$TAR_FILE" -C "$STAGE_DIR" .
  rm -rf "$STAGE_DIR"; STAGE_DIR=""
}

# 校验发布包：关键文件缺一个都不上传（防止磁盘满、构建产物缺失时把残缺包发上线）
verify_pack() {
  local listing f
  listing="$(tar -tzf "$TAR_FILE")" || die "发布包损坏，无法读取: $TAR_FILE"
  for f in apps/server/dist/main.js apps/server/dist/database/seed.js apps/server/prisma/schema.prisma \
           apps/web/dist/index.html deploy/server/remote-deploy.sh .env.production RELEASE; do
    grep -qxF "./$f" <<< "$listing" || die "发布包不完整：缺少 $f（检查构建输出与磁盘空间后重试）"
  done
  grep -q '^\./apps/server/prisma/migrations/' <<< "$listing" || die "发布包不完整：缺少 apps/server/prisma/migrations"
}

# ============================================================
# 六、服务器端后台发布 + 跟踪
# ============================================================

# 在服务器后台启动发布（setsid + nohup：脱离 SSH 会话，断网 / 合上笔记本也不会中断）
#   $1=mode  $2=版本号  $3=发布包文件名  $4=已上传的远程脚本路径
#   输出 shared/deploy-logs/<版本号>.log 及 .pid（进程号）/ .rc（退出码）
start_remote_deploy() {
  local mode="$1" stamp="$2" name="$3" rs="$4" log="$APP_DIR/shared/deploy-logs/$2.log"
  # 注意只把最后一条命令放到后台（前面的准备步骤失败要立即报错）；输出全部重定向，ssh 才能立即返回
  remote "mkdir -p '$APP_DIR/shared/deploy-logs' && tr -d '\r' < '$rs' > '$rs.lf' && rm -f '$rs' || exit 1; cd /tmp; \
SB_PID_FILE='$log.pid' SB_RC_FILE='$log.rc' SB_CLEANUP='$rs.lf' \
NPM_REGISTRY='$NPM_REGISTRY' PNPM_VERSION='$PM_VER' SKIP_DB_BACKUP='${SKIP_DB_BACKUP:-0}' FORCE_FRESH='${FORCE_FRESH:-0}' \
\$(command -v setsid || true) nohup bash '$rs.lf' '$APP_DIR' '/tmp/$name' '$mode' '$APP_NAME' '$KEEP' > '$log' 2>&1 < /dev/null &"
}

# 跟踪服务器上的发布日志，直到发布进程结束；退出码 = 发布脚本的退出码
#   $1 = 日志路径，或 latest（最近一次）
#   特殊退出码：98 没有该日志 / 99 发布进程异常退出未写退出码 / 255 SSH 连接中断
follow_remote_log() {
  local sel
  if [ "$1" = latest ]; then
    sel="L=\$(ls -1t '$APP_DIR'/shared/deploy-logs/*.log 2>/dev/null | head -n 1)"
  else
    sel="L='$1'"
  fi
  remote "$sel; [ -n \"\$L\" ] && [ -f \"\$L\" ] || { echo '没有找到发布日志'; exit 98; }; \
echo \"发布日志（服务器）: \$L\"; \
for i in \$(seq 1 40); do [ -s \"\$L.pid\" ] && break; sleep 0.25; done; \
P=\$(cat \"\$L.pid\" 2>/dev/null); \
if [ -n \"\$P\" ] && kill -0 \"\$P\" 2>/dev/null; then tail -n +1 -f --pid=\"\$P\" \"\$L\"; else cat \"\$L\"; fi; \
R=\$(cat \"\$L.rc\" 2>/dev/null); exit \${R:-99}"
}

# 发布（mode: deploy | fresh）：校验 → 构建 → 打包校验 → 上传 → 服务器后台执行 → 跟踪结果
deploy() {
  local mode="${1:-deploy}" stamp name rscript rc
  check_env
  check_ssh
  acquire_local_lock
  build
  stamp="$(date +%Y%m%d%H%M%S)"
  step "打包发布文件（环境: ${ENV_NAME}）"
  pack "$stamp"
  verify_pack
  name="$(basename "$TAR_FILE")"
  echo "    ${name}（$(du -h "$TAR_FILE" | cut -f1)）"

  step "上传到 $TARGET"
  rscript="/tmp/$APP_NAME-deploy-$stamp.sh"
  upload "$TAR_FILE" "$TARGET:/tmp/$name"
  upload deploy/server/remote-deploy.sh "$TARGET:$rscript"

  if [ "$mode" = fresh ]; then step "服务器执行重置发布（后台运行）"; else step "服务器执行发布（后台运行：依赖/备份/迁移/切换/重启/健康检查）"; fi
  start_remote_deploy "$mode" "$stamp" "$name" "$rscript"
  echo -e "${Y}    Ctrl-C 只停止查看，不会中断服务器上的发布；之后可用 ./sb.sh $ENV_NAME deploy-log 继续查看${N}"
  trap 'echo; echo -e "${Y}已停止查看；发布仍在服务器继续执行。查看进度与结果: ./sb.sh $ENV_NAME deploy-log${N}"; exit 130' INT
  rc=0; follow_remote_log "$APP_DIR/shared/deploy-logs/$stamp.log" || rc=$?
  trap - INT
  case "$rc" in
    0) ;;
    255) die "与服务器的连接中断，发布仍在服务器继续执行。查看进度与结果: ./sb.sh $ENV_NAME deploy-log" ;;
    99)  die "无法取得发布结果（发布进程异常退出）。查看日志: ./sb.sh $ENV_NAME deploy-log" ;;
    *)   die "发布失败（线上仍为原版本或已自动回滚，原因见上方输出）。完整日志: ./sb.sh $ENV_NAME deploy-log" ;;
  esac

  echo ""
  echo -e "${G}===========================================${N}"
  echo -e "${G} 发布完成: ${stamp}（环境: $ENV_NAME → ${TARGET}）${N}"
  echo -e "${G} 访问地址: $(site_url)/${N}"
  if [ "$mode" = fresh ]; then echo -e "${R} 数据已重置：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），首次登录需修改密码${N}"; fi
  echo -e "${G} 查看状态: ./sb.sh $ENV_NAME status    回滚: ./sb.sh $ENV_NAME rollback${N}"
  echo -e "${G}===========================================${N}"
}

# ============================================================
# 七、命令分发
# ============================================================
# 每个命令在服务器上实际发生的动作（详见 sb.sh 顶部注释与 docs/deploy-review.md）
case "$CMD" in
  # ---------- 日常发布 ----------
  deploy)
    guard_release "发布"
    deploy
    ;;

  # ---------- 首次初始化：装环境 → 建库建账号 → Nginx 站点 → 防火墙 → PM2 自启 → 发布 ----------
  init)
    guard_release "init（初始化服务器并发布）"
    check_env
    check_ssh
    acquire_local_lock
    SETUP_DIR="/tmp/$APP_NAME-setup"
    step "1/3 上传环境配置与初始化脚本"
    remote "mkdir -p '$APP_DIR/shared' && rm -rf '$SETUP_DIR' && mkdir -m 700 '$SETUP_DIR'"
    upload "$ENV_PROD" "$TARGET:$APP_DIR/shared/.env"
    upload deploy/server/setup-server.sh deploy/server/env-tool.cjs deploy/server/nginx-setup.sh \
      deploy/server/nginx-site.conf deploy/server/nginx-locations.conf "$TARGET:$SETUP_DIR/"
    # MySQL root 密码以文件上传（不拼进远程命令行，避免出现在本机与服务器的进程列表里）
    if [ -n "$DB_ROOT_PASS" ]; then
      pwfile="$(mktemp "$ROOT/.run/dbroot.XXXXXX")"
      printf '%s' "$DB_ROOT_PASS" > "$pwfile"
      upload "$pwfile" "$TARGET:$SETUP_DIR/db-root-pass" || { rm -f "$pwfile"; die "上传 MySQL root 密码失败"; }
      rm -f "$pwfile"
    fi
    step "2/3 初始化服务器（Node20 / pnpm / PM2 / Nginx / MySQL / 建库 / 站点）"
    remote_tty "cd $SETUP_DIR && tr -d '\r' < setup-server.sh > s.sh && NPM_REGISTRY='$NPM_REGISTRY' PNPM_VERSION='$PM_VER' bash s.sh '$APP_DIR' '$APP_NAME'; rc=\$?; rm -rf $SETUP_DIR; exit \$rc" \
      || die "服务器初始化失败（见上方输出）。修正后可直接重新执行 init（幂等）"
    step "3/3 首次发布"
    deploy
    echo -e "${Y}首次部署完成（${ENV_NAME}）：超管 admin / env 中 ADMIN_INITIAL_PASSWORD（默认 admin123），首次登录需修改密码；确认安全组已放行 80/443。${N}"
    ;;

  # ---------- 重置发布：清空数据库后重建 ----------
  fresh)
    check_env
    [ "$PROTECTED" = 0 ] || [ "${ALLOW_FRESH:-0}" = 1 ] || die "正式环境禁止 fresh（会清空全部业务数据）。确需执行请设置 ALLOW_FRESH=1"
    DB_NAME="$(node "$ENV_TOOL" db "$ENV_PROD" | sed -n 5p)"
    echo ""
    echo -e "${R}====================================================${N}"
    echo -e "${R}  危险操作：远程数据库将被完全重置${N}"
    echo -e "${R}  环境: $ENV_NAME    服务器: $TARGET    数据库: $DB_NAME${N}"
    echo -e "${R}  全部业务数据将被删除（清库前服务器会自动备份），账号恢复为默认密码${N}"
    echo -e "${R}  （日志文件不受影响）${N}"
    echo -e "${R}====================================================${N}"
    read -r -p "请输入数据库名 $DB_NAME 确认: " CONFIRM_DB
    [ "$CONFIRM_DB" = "$DB_NAME" ] || { echo "已取消，未做任何改动"; exit 0; }
    guard_release "fresh（清空数据库并重新发布）"
    deploy fresh
    ;;

  # ---------- 查看发布日志 ----------
  deploy-log)
    [ -z "${1:-}" ] || [[ "$1" =~ ^[0-9]{14}$ ]] || die "版本号为 14 位时间戳（./sb.sh $ENV_NAME releases 查看）"
    check_ssh
    rc=0
    if [ -n "${1:-}" ]; then follow_remote_log "$APP_DIR/shared/deploy-logs/$1.log" || rc=$?
    else follow_remote_log latest || rc=$?; fi
    case "$rc" in
      0)   echo -e "${G}✓ 该次发布成功${N}" ;;
      98)  exit 1 ;;
      99)  echo -e "${Y}结果未知：发布进程异常退出（未写入退出码）${N}"; exit 1 ;;
      255) die "与服务器的连接中断" ;;
      *)   echo -e "${R}✗ 该次发布失败（退出码 $rc）${N}"; exit 1 ;;
    esac
    ;;

  # ---------- 服务器运维（ops.sh） ----------
  status|releases|restart|start)
    need_release; remote "$OPS $CMD" ;;
  stop)
    need_release; confirm_env "stop（页面下线为维护中）"; remote "$OPS stop" ;;
  logs)
    need_release
    # 参数会拼进远端命令，先做白名单校验（级别仅字母，日期 YYYY-MM-DD）
    case "${1:-}" in ""|pm2|follow|-f) ;; *) [[ "$1" =~ ^[A-Za-z]+$ ]] || die "日志级别参数只支持字母（ERROR/WARN/INFO/pm2/follow）" ;; esac
    [ -z "${2:-}" ] || [[ "$2" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "日期格式应为 YYYY-MM-DD"
    if [ "${1:-}" = follow ] || [ "${1:-}" = -f ]; then remote_tty "$OPS logs follow"; else remote "$OPS logs '${1:-}' '${2:-}'"; fi ;;
  rollback)
    [ -z "${1:-}" ] || [[ "$1" =~ ^[0-9]{14}$ ]] || die "版本号为 14 位时间戳（./sb.sh $ENV_NAME releases 查看）"
    need_release; confirm_env "rollback ${1:-到上一版本}"; remote "$OPS rollback '${1:-}'" ;;
  migrate-status)
    need_release; remote "$OPS migrate-status" ;;
  migrate-resolve)
    case "${1:-}" in applied|rolled-back) ;; *) die "用法: ./sb.sh $ENV_NAME migrate-resolve <applied|rolled-back> <迁移名>" ;; esac
    [[ "${2:-}" =~ ^[0-9]{14}_[A-Za-z0-9_]+$ ]] || die "迁移名格式应为 <14位时间戳>_<名称>（./sb.sh $ENV_NAME migrate-status 查看）"
    need_release; confirm_env "migrate-resolve $1 $2"; remote "$OPS migrate-resolve '$1' '$2'" ;;

  # ---------- HTTPS / 数据库远程访问 ----------
  ssl)
    DOMAIN="${1:?用法: ./sb.sh $ENV_NAME ssl 你的域名}"
    [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "域名格式不正确: $DOMAIN"
    need_release
    remote "bash $APP_DIR/current/deploy/server/setup-ssl.sh '$DOMAIN' '$APP_NAME' '$APP_DIR'" ;;
  db-remote-on)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' on '${1:-%}'" ;;
  db-remote-off)
    need_release; remote_tty "bash $APP_DIR/current/deploy/server/db-remote.sh '$APP_DIR' off '${1:-}'" ;;

  # ---------- 备份：服务器端 mysqldump → 拉回本地 backup/<环境>/ ----------
  db-backup)
    need_release; check_ssh
    stamp="$(date +%Y%m%d%H%M%S)"
    mkdir -p "backup/${ENV_NAME}"
    step "在服务器备份数据库（环境: ${ENV_NAME}）"
    rscript="/tmp/${APP_NAME}-dbbackup-${stamp}.sh"
    upload deploy/server/db-backup.sh "$TARGET:${rscript}"
    out="$(remote "tr -d '\r' < ${rscript} > ${rscript}.lf; bash ${rscript}.lf '${APP_DIR}' '${APP_NAME}' backup '${1:-}'; rc=\$?; rm -f ${rscript} ${rscript}.lf; exit \$rc")" \
      || die "备份失败（见上方输出）"
    printf '%s\n' "$out" | sed '/^BACKUP_FILE=/d'
    # 脚本最后一行固定输出 BACKUP_FILE=<路径>
    remote_file="$(sed -n 's/^BACKUP_FILE=//p' <<< "$out" | tail -n 1)"
    [ -n "$remote_file" ] || die "备份失败：未取得服务器上的备份文件路径"
    name="$(basename "$remote_file")"
    step "拉回本地 backup/${ENV_NAME}/${name}"
    upload "$TARGET:${remote_file}" "backup/${ENV_NAME}/${name}"
    echo -e "${G}✓ 已保存到 backup/${ENV_NAME}/${name}（$(du -h "backup/${ENV_NAME}/${name}" | cut -f1)）${N}"
    ;;

  # ---------- 恢复：危险操作，需输入库名确认；服务器会先备份当前库、停应用、清表、导入、迁移、启动 ----------
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
    echo -e "${R}  恢复期间应用暂停服务；库内现有表会被全部删除后导入（恢复前自动先备份当前库）${N}"
    echo -e "${R}====================================================${N}"
    read -r -p "请输入数据库名 ${DB_NAME} 确认: " CONFIRM_DB
    [ "$CONFIRM_DB" = "$DB_NAME" ] || { echo "已取消，未做任何改动"; exit 0; }
    stamp="$(date +%Y%m%d%H%M%S)"
    step "上传备份文件并恢复"
    rfile="/tmp/${APP_NAME}-restore-${stamp}.sql.gz"
    case "$SRC" in *.sql) rfile="${rfile%.gz}" ;; esac
    rscript="/tmp/${APP_NAME}-restore-${stamp}.sh"
    upload "$SRC" "$TARGET:${rfile}"
    upload deploy/server/db-backup.sh "$TARGET:${rscript}"
    remote "tr -d '\r' < ${rscript} > ${rscript}.lf; bash ${rscript}.lf '${APP_DIR}' '${APP_NAME}' restore '${rfile}'; rc=\$?; rm -f ${rscript} ${rscript}.lf ${rfile}; exit \$rc" \
      || die "恢复失败（见上方输出）"
    echo -e "${G}✓ 恢复完成${N}"
    ;;

  # ---------- 体检：额外上传本地应用配置，比对服务器 shared/.env 是否有未同步的改动 ----------
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

  # ---------- 交互式登录服务器 ----------
  ssh)
    if [ -n "$SSH_PASSWORD" ]; then remote_tty "bash -l"; else ssh "${SSH_OPTS[@]}" "$TARGET"; fi ;;
  *) echo "未知命令: $CMD"; echo; usage ;;
esac
