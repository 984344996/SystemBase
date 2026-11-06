#!/usr/bin/env bash
# ============================================================
# 服务器端发布脚本（由 deploy.sh / deploy.ps1 上传到 /tmp，在服务器后台执行）
#   bash remote-deploy.sh APP_DIR TAR_PATH [MODE] [APP_NAME] [KEEP_RELEASES]
#     MODE=deploy（默认）常规发布：保留数据，只执行未应用的迁移
#     MODE=fresh          重置发布：备份 → 清空数据库 → 重建
#
# 本机通过环境变量传入（均可选）：
#   NPM_REGISTRY      服务器装依赖用的 npm 镜像
#   PNPM_VERSION      pnpm 版本（与仓库 package.json 的 packageManager 一致）
#   HEALTH_TIMEOUT    健康检查最长等待秒数（默认 60）
#   SKIP_DB_BACKUP=1  跳过「迁移前自动备份」（不建议；外部数据库已有云备份时可用）
#   FORCE_FRESH=1     fresh 清库前备份失败时仍继续清库（默认中止）
#   SB_PID_FILE       写入本进程 PID（本机据此跟踪后台发布）
#   SB_RC_FILE        退出时写入退出码（本机据此判断成功/失败）
#   SB_CLEANUP        退出时额外删除的文件（上传到 /tmp 的脚本本身），空格分隔
#
# 流程（每步失败后线上处于什么状态，见 docs/deploy-review.md 第二节）：
#   解压 → 换配置（旧配置留底 .env.prev）→ 数据库预检 → 装依赖 → 迁移状态检查
#   → 迁移前自动备份 → 迁移 → seed → 切换 current → PM2 重启 → 健康检查（校验版本号）
#   → 刷新 Nginx → 前端入口探测 → 每日备份定时任务 → 清理旧版本
# 失败处理：
#   切换前失败：删除半成品目录、还原配置；fresh 还会把已停止的服务重新拉起；线上代码不变
#   切换后失败：自动回滚「代码 + 配置 + Nginx」到上一版本；数据库迁移不会回退
#
# 目录结构（多版本 + 软链，支持秒级回滚）：
#   APP_DIR/
#   ├── current -> releases/<时间戳>          Nginx 与 PM2 都指向这里
#   ├── releases/<时间戳>/.env.snapshot       该版本发布时的配置快照（rollback 时恢复）
#   ├── releases.log                         发布 / 回滚记录
#   ├── .deploy.lock                         发布互斥锁（rollback 也会获取）
#   └── shared/                              跨版本共享
#       ├── .env / .env.prev                 当前配置 / 上一次发布前的配置
#       ├── logs/ pm2/ uploads/ backup/      应用日志、PM2 输出、上传文件、数据库备份
#       └── deploy-logs/<时间戳>.log          每次发布的完整输出（.rc 退出码 / .pid 进程号）
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true
# 忽略挂断信号：即使不是后台方式启动，SSH 断开也不会把发布杀在半路
trap '' HUP

# ============================================================
# 一、参数与常量
# ============================================================
APP_DIR="${1:?用法: remote-deploy.sh APP_DIR TAR [MODE] [APP_NAME] [KEEP]}"
TAR="${2:?缺少发布包路径}"
MODE="${3:-deploy}"
APP_NAME="${4:-systembase}"
KEEP="${5:-5}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PNPM_VERSION="${PNPM_VERSION:-9}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-60}"

PM2_NAME="$APP_NAME-server"
SHARED="$APP_DIR/shared"
SNIPPET="/etc/nginx/snippets/$APP_NAME-locations.conf"   # nginx-setup.sh 生成的路由片段

# 版本号取自发布包文件名（本机打包时的时间戳），取不到时用服务器当前时间
STAMP="$(basename "$TAR" | sed -E 's/.*-([0-9]{14})\.tar\.gz$/\1/')"
[[ "$STAMP" =~ ^[0-9]{14}$ ]] || STAMP="$(date +%Y%m%d%H%M%S)"
REL="$APP_DIR/releases/$STAMP"

# 上一版本（回滚目标）。current 不存在或悬空时必须为空：GNU readlink -f 对缺失的末级路径
# 会原样输出 "/…/current"，曾导致首次发布失败回滚时把 current 切成指向自身的悬空软链
PREV=""
[ -d "$APP_DIR/current/" ] && PREV="$(readlink -f "$APP_DIR/current")"

[ "$KEEP" -ge 2 ] 2>/dev/null || KEEP=2   # 至少保留上一版本，保证可回滚

export CI=true                                  # pnpm 非交互模式
export SB_APP_DIR="$APP_DIR" SB_APP_NAME="$APP_NAME"   # ecosystem.config.js 读取
# 国内服务器下载 Prisma 引擎走镜像（可在执行前覆盖）
export PRISMA_ENGINES_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"

# 运行状态标记（退出时的清理逻辑依赖它们）
REL_CREATED=0    # 本次是否已创建版本目录（创建后失败才删除）
ENV_REPLACED=0   # shared/.env 是否已被本次发布覆盖（失败时据此还原）
HAD_PREV_ENV=0   # 覆盖前是否存在旧配置（存在才会留底 .env.prev）
PM2_STOPPED=0    # fresh 是否已停止服务（失败时据此重新拉起）
SWITCHED=0       # current 是否已切换到新版本（切换后失败走回滚，不再删除目录）
RECORDED=0       # releases.log 是否已记录本次结果（避免重复记录）

[ -n "${SB_PID_FILE:-}" ] && echo "$$" > "$SB_PID_FILE"

# ============================================================
# 二、通用函数
# ============================================================

# 打印步骤标题
step() { echo "==> $*"; }

# 打印警告（不中断）
warn() { echo "    !! $*"; }

# 读取 env 文件中的变量：env_get 文件 KEY [默认值]（解析器在发布包内）
env_get() { node "$REL/deploy/server/env-tool.cjs" get "$1" "$2" "${3:-}"; }

# 在 releases.log 记录本次结果（每次发布只记一次）
record() {
  [ "$RECORDED" = 0 ] || return 0
  echo "$STAMP $(date '+%F %T') $MODE $1" >> "$APP_DIR/releases.log"
  RECORDED=1
}

# 把 shared/.env 还原为本次发布前的配置（仅当本次覆盖过且有留底）
restore_env_prev() {
  if [ "$ENV_REPLACED" = 1 ] && [ "$HAD_PREV_ENV" = 1 ] && [ -f "$SHARED/.env.prev" ]; then
    cp -p "$SHARED/.env.prev" "$SHARED/.env"
    echo "    已还原 shared/.env 为发布前的配置"
  fi
}

# 原子切换版本：先建临时软链再 mv 覆盖，任何时刻 current 都指向一个完整版本
switch_to() {
  ln -sfn "$1" "$APP_DIR/current.tmp" && mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"
}

# 按 current 重新加载 PM2 进程；失败不中断（交给随后的健康检查 / 回滚收尾）
reload_pm2() {
  pm2 startOrReload "$APP_DIR/current/deploy/server/ecosystem.config.js" --update-env >/dev/null || true
  pm2 save >/dev/null 2>&1 || true
}

# 健康检查：轮询 /api/health 直到 HEALTH_TIMEOUT 秒
#   $1 = 期望版本号：非空时要求返回体里的 release 等于它（确认跑的是新进程而不是没被替换的旧进程）
#        为空时只看 HTTP 状态码（回滚到可能不返回版本号的老版本时用）
health_ok() {
  local want="${1:-}" body _
  for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
    if body="$(curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then
      if [ -z "$want" ] || grep -q "\"release\":\"$want\"" <<< "$body"; then return 0; fi
    fi
    sleep 1
  done
  return 1
}

# 打印最近的错误输出，便于在本机直接看到失败原因
show_recent_errors() {
  echo "!! 最近的错误输出："
  tail -n 30 "$SHARED/pm2/error.log" 2>/dev/null || true
  grep -h '"level":"\(ERROR\|FATAL\)"' "$SHARED/logs/app.$(date +%F).log" 2>/dev/null | tail -n 5 || true
}

# 用指定版本目录里的 nginx-setup.sh 按当前 shared/.env 重新生成 Nginx 配置
#   $1 = 版本目录；非 root 或未装 nginx 时跳过（返回 0）；生成失败返回 1（nginx-setup.sh 已自动还原）
refresh_nginx() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  [ -f "$1/deploy/server/nginx-setup.sh" ] || return 0
  bash "$1/deploy/server/nginx-setup.sh" "$APP_DIR" "$APP_NAME" "$SHARED/.env"
}

# 挂回本环境站点：之前执行过 stop 时（站点配置被摘掉 / 路由换成维护页）在这里恢复；
# 未 stop 过时全部幂等无副作用
site_enable() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  if [ -d /etc/nginx/sites-available ]; then
    [ -f "/etc/nginx/sites-available/$APP_NAME" ] && ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  else
    [ -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" ] && mv -f "/etc/nginx/conf.d/$APP_NAME.conf.disabled" "/etc/nginx/conf.d/$APP_NAME.conf"
  fi
  rm -f "$SNIPPET.disabled"   # stop 留下的真实路由备份；nginx-setup.sh 已重新生成正式路由
  systemctl start nginx >/dev/null 2>&1 || true
  systemctl reload nginx >/dev/null 2>&1 || true
}

# 本次发布是否改动了站点参数（SITE_PORT / SITE_DOMAIN / SITE_PATH）；首次发布视为改动
site_changed() {
  [ -f "$SHARED/.env.prev" ] || return 0
  local k
  for k in SITE_PORT SITE_DOMAIN SITE_PATH; do
    [ "$(env_get "$SHARED/.env.prev" "$k")" = "$(env_get "$SHARED/.env" "$k")" ] || return 0
  done
  return 1
}

# 切换后失败：回滚「代码 + 配置 + Nginx」到上一版本，标记失败版本，退出 1
#   $1 = 失败原因
rollback_to_prev() {
  echo "!! $1"
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$(basename "$PREV")" != "$STAMP" ]; then
    echo "!! 自动回滚到上一版本 $(basename "$PREV")（代码 + 配置 + Nginx；本次已执行的数据库迁移不会回退）"
    restore_env_prev
    PORT="$(env_get "$SHARED/.env" PORT 3000)"
    switch_to "$PREV"
    reload_pm2
    if health_ok ""; then echo "   上一版本已恢复服务"; else echo "!! 上一版本也未通过健康检查，请登录服务器排查"; fi
    refresh_nginx "$PREV" || warn "上一版本的 Nginx 配置重新生成失败，请登录服务器执行 nginx -t 排查"
    site_enable
    # 保留失败版本现场便于排查；改名后不会再被当作回滚目标
    mv "$REL" "$REL.failed" 2>/dev/null || true
  else
    echo "!! 没有可回滚的上一版本（首次发布），current 保持在新版本，请排查后重新发布"
  fi
  record FAILED
  exit 1
}

# 备份数据库（调用发布包内的 db-backup.sh）
#   $1 = 备注；返回 0 成功 / 2 服务器没有 mysqldump（外部数据库）/ 其他 = 备份失败
backup_db() {
  command -v mysqldump >/dev/null 2>&1 || return 2
  bash "$REL/deploy/server/db-backup.sh" "$APP_DIR" "$APP_NAME" backup "$1" | sed '/^BACKUP_FILE=/d; s/^/    /'
}

# 安装每日数据库备份定时任务（/etc/cron.d/<APP_NAME>-db-backup，每次发布刷新）
#   时间取 shared/.env 的 DB_BACKUP_CRON（标准 5 段 cron 表达式）；=off 关闭；
#   未配置时为每天 3 点，分钟按 APP_NAME 散开，避免同机多环境同时备份
install_backup_cron() {
  [ "$(id -u)" = "0" ] && [ -d /etc/cron.d ] && command -v mysqldump >/dev/null 2>&1 || return 0
  local f="/etc/cron.d/$APP_NAME-db-backup" spec node_dir
  spec="$(env_get "$SHARED/.env" DB_BACKUP_CRON "")"
  if [ "$spec" = "off" ]; then
    rm -f "$f"; echo "    每日备份: 已关闭（DB_BACKUP_CRON=off）"; return 0
  fi
  [ -n "$spec" ] || spec="$(( $(printf '%s' "$APP_NAME" | cksum | cut -d' ' -f1) % 60 )) 3 * * *"
  if ! [[ "$spec" =~ ^[0-9*/,-]+([[:space:]]+[0-9*/,-]+){4}$ ]]; then
    warn "DB_BACKUP_CRON 格式不正确（应为 5 段 cron 表达式，如 \"30 3 * * *\"），未安装每日备份"; return 0
  fi
  node_dir="$(dirname "$(command -v node)")"
  mkdir -p "$SHARED/backup"
  {
    echo "# 由 remote-deploy.sh 生成：$APP_NAME 每日数据库备份（env 中 DB_BACKUP_CRON=off 可关闭）"
    echo "SHELL=/bin/bash"
    echo "PATH=$node_dir:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    echo 'MAILTO=""'
    echo "$spec root bash $APP_DIR/current/deploy/server/db-backup.sh $APP_DIR $APP_NAME backup daily >> $SHARED/backup/cron.log 2>&1"
  } > "$f.tmp"
  chmod 644 "$f.tmp" && mv -f "$f.tmp" "$f"
  echo "    每日备份: $spec（$f，备份保留 ${KEEP_BACKUP_DAYS:-7} 天；建议另行同步到对象存储/其他机器）"
}

# 前端入口探测：经 Nginx 请求 SITE_PATH 首页，确认静态资源与路由可用（失败只警告）
probe_frontend() {
  [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1 || return 0
  local port path dom code hdr=()
  port="$(env_get "$SHARED/.env" SITE_PORT 80)"; [ -n "$port" ] || port=80
  path="$(env_get "$SHARED/.env" SITE_PATH "")"
  if [ -n "$path" ]; then case "$path" in /*) ;; *) path="/$path" ;; esac; path="${path%/}"; fi
  dom="$(env_get "$SHARED/.env" SITE_DOMAIN "" | awk '{print $1}')"
  [ -n "$dom" ] && [ "$dom" != "_" ] && hdr=(-H "Host: $dom")
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 ${hdr[@]+"${hdr[@]}"} "http://127.0.0.1:$port$path/" || true)"
  if [ "$code" = "200" ]; then
    echo "    前端入口正常: http://127.0.0.1:$port$path/"
  else
    warn "前端入口 http://127.0.0.1:$port$path/ 返回 HTTP ${code:-无响应}（后端已正常），请检查 Nginx 配置与前端产物"
  fi
}

# 在 PATH 中定位 npm 全局命令（pnpm / pm2），找不到则现场安装
#   非交互 SSH 的 PATH 很精简：node 在系统路径，但 pnpm/pm2 可能装在 npm 全局 bin（不在 PATH）或未安装
ensure_global_bin() {
  local bin="$1" ver="$2" dir
  command -v "$bin" >/dev/null 2>&1 && return 0
  dir="$(npm prefix -g 2>/dev/null || true)"
  if [ -z "$dir" ] || [ ! -x "$dir/bin/$bin" ]; then
    echo "    服务器缺少 $bin，使用 npm 现场安装"
    npm install -g "$bin${ver:+@$ver}" --no-audit --no-fund --registry="$NPM_REGISTRY"
    dir="$(npm prefix -g 2>/dev/null || true)"
  fi
  [ -n "$dir" ] && [ -x "$dir/bin/$bin" ] && export PATH="$dir/bin:$PATH"
  command -v "$bin" >/dev/null 2>&1 || { echo "!! $bin 安装后仍不可用，请检查服务器 node/npm 环境"; return 1; }
}

# 退出时统一收尾（成功、失败、被中断都会执行）
#   切换前失败：删半成品目录 → 还原配置 → fresh 已停服务则重新拉起 → 记录 FAILED
#   无论成败：删除上传到 /tmp 的发布包与脚本，写退出码文件
on_exit() {
  local code=$?
  set +e
  if [ "$code" -ne 0 ] && [ "$SWITCHED" = 0 ]; then
    [ "$REL_CREATED" = 1 ] && [ -d "$REL" ] && rm -rf "$REL"
    restore_env_prev
    if [ "$PM2_STOPPED" = 1 ]; then
      echo "!! [fresh] 中途失败，重新拉起已停止的服务（数据库可能已被清空或只建了一半，请查看上方输出）"
      reload_pm2
    fi
    if [ "$REL_CREATED" = 1 ]; then
      echo "!! 发布中止：线上代码未切换（$(basename "$REL") 已清理）"
      record FAILED
    fi
  fi
  rm -f "$TAR" ${SB_CLEANUP:-}
  [ -n "${SB_RC_FILE:-}" ] && echo "$code" > "$SB_RC_FILE"
}
trap on_exit EXIT

# ============================================================
# 三、准备：互斥锁、版本号检查
# ============================================================
mkdir -p "$APP_DIR/releases" "$SHARED/logs" "$SHARED/pm2" "$SHARED/uploads"

# 发布互斥：同一 DEPLOY_DIR 同时只允许一个发布 / 回滚（flock 随进程退出自动释放）
exec 9>"$APP_DIR/.deploy.lock"
flock -n 9 || { echo "!! 已有另一个发布或回滚正在服务器上执行，请等它结束后再试"; exit 1; }

# 版本号不能等于正在运行的版本：否则下面的 rm -rf 会删掉线上目录（本机时钟回拨时可能出现）
#   按目录名比较：PREV 是 readlink -f 解析后的真实路径，DEPLOY_DIR 经过软链时与 $REL 字面不同
if [ -n "$PREV" ] && [ "$(basename "$PREV")" = "$STAMP" ]; then
  echo "!! 版本号 $STAMP 与当前线上版本相同（本机时钟是否回拨？），拒绝覆盖正在运行的版本"; exit 1
fi
# 版本号早于线上版本：rollback 与清理按目录名排序，顺序会错乱，提醒检查本机时间
if [ -n "$PREV" ] && [[ "$STAMP" < "$(basename "$PREV")" ]]; then
  warn "版本号 $STAMP 早于线上版本 $(basename "$PREV")，请检查本机时间（会影响回滚目标与旧版本清理顺序）"
fi

# ============================================================
# 四、解压发布包
# ============================================================
step "解压发布包 → releases/$STAMP"
rm -rf "$REL" && mkdir -p "$REL"
REL_CREATED=1
tar -xzf "$TAR" -C "$REL"
# 发布包保留了开发机的属主（如 uid 501）和打包暂存目录的 700 权限：统一为 root 属主、
# 目录可进入、文件可读，否则 nginx worker（非 root）读不到静态资源（Permission denied → 500）
chown -R root:root "$REL"
chmod -R u+rwX,go+rX "$REL"
# 去掉脚本里的 CRLF（Windows 打包时可能带入）
find "$REL/deploy" -name "*.sh" -exec sh -c 'for f; do tr -d "\r" < "$f" > "$f.lf" && mv "$f.lf" "$f"; done' _ {} +
# 关键产物必须齐全：缺任何一个都说明打包不完整，立即中止（不切换，线上不变）
for f in apps/server/dist/main.js apps/server/dist/database/seed.js apps/web/dist/index.html apps/server/prisma/schema.prisma RELEASE; do
  [ -e "$REL/$f" ] || { echo "!! 发布包不完整：缺少 $f（请在本机重新发布）"; exit 1; }
done

# ============================================================
# 五、配置：用发布包里的配置覆盖 shared/.env（旧配置留底，失败 / 回滚时还原）
# ============================================================
if [ -f "$REL/.env.production" ]; then
  if [ -f "$SHARED/.env" ]; then cp -p "$SHARED/.env" "$SHARED/.env.prev"; HAD_PREV_ENV=1; fi
  # 先写临时文件再 mv：任何时刻 shared/.env 都是完整文件；umask 077 保证新文件权限 600
  ( umask 077; tr -d '\r' < "$REL/.env.production" > "$SHARED/.env.new" )
  mv -f "$SHARED/.env.new" "$SHARED/.env"
  ENV_REPLACED=1
  rm -f "$REL/.env.production"   # 版本目录内不保留密钥明文（快照见下方，权限 600）
fi
[ -f "$SHARED/.env" ] || { echo "!! 缺少 $SHARED/.env（请先执行 ./sb.sh <环境> init）"; exit 1; }
chmod 600 "$SHARED/.env"
node "$REL/deploy/server/env-tool.cjs" check "$SHARED/.env" >/dev/null
# 本版本的配置快照：rollback 到本版本时恢复为 shared/.env
cp -p "$SHARED/.env" "$REL/.env.snapshot" && chmod 600 "$REL/.env.snapshot"
# 应用通过软链读取共享配置与日志目录
ln -sfn "$SHARED/.env" "$REL/apps/server/.env"
rm -rf "$REL/apps/server/logs" && ln -sfn "$SHARED/logs" "$REL/apps/server/logs"
PORT="$(env_get "$SHARED/.env" PORT 3000)"

# ============================================================
# 六、上传文件：版本目录的 apps/server/uploads 一律软链到 shared/uploads
# ============================================================
# 不软链的后果：每次发布后旧文件在新版本「消失」；清理旧版本时文件被一起删除；回滚后新上传的文件不可见。
# 兼容历史版本：版本目录里残留的真实 uploads 目录先合并进 shared（不覆盖同名），再改为软链
link_uploads() {  # $1 = 版本目录
  local d="$1/apps/server/uploads"
  [ -d "$1/apps/server" ] || return 0
  if [ -d "$d" ] && [ ! -L "$d" ]; then
    cp -an "$d/." "$SHARED/uploads/" 2>/dev/null || true
    rm -rf "$d"
  fi
  ln -sfn "$SHARED/uploads" "$d"
}
for r in "$APP_DIR"/releases/*/; do link_uploads "${r%/}"; done
link_uploads "$REL"

# ============================================================
# 七、数据库预检：装依赖前先确认数据库可达、账号可用，避免装完依赖才在迁移时失败
# ============================================================
DB_INFO="$(node "$REL/deploy/server/env-tool.cjs" db "$SHARED/.env")"
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"
DB_PORT="$(sed -n 2p <<< "$DB_INFO")"
ENV_TAG="$(sed -n 's/^env=//p' "$REL/RELEASE" 2>/dev/null || true)"

# 7.1 TCP 可达：本机 MySQL 没在监听时尝试自动启动
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

# 7.2 账号可用：TCP 可达 ≠ 账号密码正确（Prisma P1000）。装有 mysql 客户端时实际登录一次
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

# ============================================================
# 八、依赖：按 lockfile 安装后端生产依赖，生成 Prisma Client
# ============================================================
ensure_global_bin pnpm "$PNPM_VERSION"
ensure_global_bin pm2 ""

step "安装后端生产依赖（pnpm，锁定版本）"
cd "$REL"
if ! pnpm install --prod --frozen-lockfile --filter "@sb/server..." --registry="$NPM_REGISTRY" --reporter=append-only; then
  echo "!! 依赖安装失败（线上不受影响）。若为网络/镜像问题，可在 env 部署段更换 NPM_REGISTRY 后重试"
  exit 1
fi
cd "$REL/apps/server"
PRISMA=./node_modules/.bin/prisma
step "生成 Prisma Client"
$PRISMA generate >/dev/null

# ============================================================
# 九、数据库：迁移状态检查 → 自动备份 → 迁移（或 fresh 重置）→ seed
# ============================================================
if [ "$MODE" = "fresh" ]; then
  # 9F.1 先备份再停服务：备份失败时还没停服务，直接中止即可，线上不受影响
  step "[fresh] 清库前自动备份当前库（auto-before-fresh）"
  rc=0; backup_db auto-before-fresh || rc=$?
  if [ "$rc" != 0 ]; then
    if [ "${FORCE_FRESH:-0}" = 1 ]; then
      warn "备份失败（或服务器未安装 mysqldump），FORCE_FRESH=1：继续清库"
    else
      echo "!! 清库前备份失败（或服务器未安装 mysqldump），已中止重置，线上不受影响"
      echo "   确认不需要备份时可用 FORCE_FRESH=1 重试"
      exit 1
    fi
  fi
  # 9F.2 停服务，避免清库期间写入；之后任何一步失败都会在 on_exit 里重新拉起
  step "[fresh] 停止服务"
  pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true
  PM2_STOPPED=1
  # 9F.3 删除全部表 → 重新执行全部迁移
  step "[fresh] 重置数据库（删除全部表 → 重新执行全部迁移）"
  $PRISMA migrate reset --force --skip-seed --skip-generate
else
  # 9.1 查询迁移状态：有没有失败残留、有哪些待执行
  step "检查数据库迁移状态"
  STATUS_OUT="$($PRISMA migrate status 2>&1 || true)"
  # 上次迁移执行到一半失败（_prisma_migrations 有 finished_at 为空的记录）：migrate deploy 会报 P3009 拒绝执行
  if grep -q "have failed" <<< "$STATUS_OUT"; then
    echo "$STATUS_OUT" | sed 's/^/    /'
    echo "!! 数据库中有执行失败的迁移（Prisma P3009），必须先人工处理，已中止发布（线上不变）："
    echo "   1. 查看详情:   ./sb.sh ${ENV_TAG:-<环境>} migrate-status"
    echo "   2. 用失败前的备份恢复（shared/backup/*auto-before-migrate*），或手工把该迁移补齐 / 撤销"
    echo "   3. 标记结果:   ./sb.sh ${ENV_TAG:-<环境>} migrate-resolve applied|rolled-back <迁移名>"
    exit 1
  fi
  # 待执行的迁移名（Prisma 输出 "Following migrations have not yet been applied:" 之后的若干行）
  PENDING="$(awk '/not yet been applied/{f=1;next} f&&NF==0{if(n)exit;next} f{print $1;n++}' <<< "$STATUS_OUT" | grep -E '^[0-9]{14}_' || true)"
  if grep -q "Database schema is up to date" <<< "$STATUS_OUT"; then
    echo "    没有待执行的迁移"
    NEED_BACKUP=0
  else
    NEED_BACKUP=1
    if [ -n "$PENDING" ]; then echo "    待执行的迁移："; echo "$PENDING" | sed 's/^/      /'; fi
  fi

  # 9.2 破坏性语句提醒：删表/删列/改名/改类型会让回滚后的旧代码报错，且无法自动回退
  for m in $PENDING; do
    f="prisma/migrations/$m/migration.sql"
    [ -f "$f" ] || continue
    hits="$(grep -inE 'DROP[[:space:]]+(TABLE|COLUMN)|RENAME[[:space:]]|MODIFY[[:space:]]|CHANGE[[:space:]]+COLUMN|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM' "$f" || true)"
    if [ -n "$hits" ]; then
      warn "迁移 $m 含破坏性语句（执行后不可自动回退；回滚代码后旧版本可能报错）："
      echo "$hits" | sed 's/^/         /'
    fi
  done

  # 9.3 迁移前自动备份：有待执行迁移时才备份；备份失败中止发布（外部数据库无 mysqldump 时只提醒）
  if [ "$NEED_BACKUP" = 1 ]; then
    if [ "${SKIP_DB_BACKUP:-0}" = 1 ]; then
      warn "SKIP_DB_BACKUP=1：跳过迁移前备份"
    else
      step "迁移前自动备份（auto-before-migrate）"
      rc=0; backup_db auto-before-migrate || rc=$?
      case "$rc" in
        0) ;;
        2) warn "服务器未安装 mysqldump（外部数据库），跳过迁移前备份，请确认云数据库已开启自动备份" ;;
        *) echo "!! 迁移前备份失败，已中止发布（线上不变）。确认不需要备份时可用 SKIP_DB_BACKUP=1 重试"; exit 1 ;;
      esac
    fi
  fi

  # 9.4 执行随代码提交的迁移 SQL：只跑未应用过的，不删数据
  step "数据库迁移（prisma migrate deploy，只执行未应用的迁移）"
  if ! $PRISMA migrate deploy; then
    echo "!! 迁移失败：线上代码未切换，但 MySQL 的 DDL 不支持事务，数据库可能已执行了一半"
    echo "   1. 查看状态:   ./sb.sh ${ENV_TAG:-<环境>} migrate-status"
    echo "   2. 用迁移前备份恢复（./sb.sh ${ENV_TAG:-<环境>} db-backup 列表在服务器 shared/backup/），或手工补齐"
    echo "   3. 标记结果:   ./sb.sh ${ENV_TAG:-<环境>} migrate-resolve applied|rolled-back <迁移名>"
    exit 1
  fi
fi

# 9.5 种子数据：幂等补齐（超管 / 菜单 / 权限点 / 默认任务 / 内置字典与参数），可重复执行
#   超管初始密码取 shared/.env 的 ADMIN_INITIAL_PASSWORD（默认 admin123），只在超管不存在时生效
step "初始化/补齐种子数据（幂等：只补缺失的菜单、权限点、超管与默认任务）"
node dist/database/seed.js

# SELinux（CentOS 系默认开启）：给前端静态资源打 nginx 可读的标签
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  chcon -R -t httpd_sys_content_t "$REL/apps/web/dist" 2>/dev/null || true
fi

# ============================================================
# 十、切换版本 → PM2 重启 → 健康检查（失败自动回滚）
# ============================================================
# 健康接口返回的 release 应等于本包 RELEASE 里的版本号，确认跑起来的是新进程
WANT_RELEASE="$(sed -n 's/^release=//p' "$REL/RELEASE" 2>/dev/null || true)"
[ -n "$WANT_RELEASE" ] || WANT_RELEASE="$STAMP"

step "切换版本并重启（PM2: $PM2_NAME）"
switch_to "$REL"
SWITCHED=1
reload_pm2
PM2_STOPPED=0

step "健康检查 http://127.0.0.1:$PORT/api/health（最长 ${HEALTH_TIMEOUT}s，校验版本号 $WANT_RELEASE）"
if ! health_ok "$WANT_RELEASE"; then
  show_recent_errors
  rollback_to_prev "新版本健康检查失败（${HEALTH_TIMEOUT}s 内 /api/health 未返回 200 且版本号为 $WANT_RELEASE）"
fi
echo "    健康检查通过"

# ============================================================
# 十一、Nginx：按本次配置刷新站点（SITE_PORT / SITE_DOMAIN / SITE_PATH 变更在此生效）
# ============================================================
if [ "$(id -u)" = "0" ] && command -v nginx >/dev/null 2>&1; then
  step "刷新 Nginx 站点配置"
  if ! refresh_nginx "$REL"; then
    # 站点参数改了而路由没更新：新前端按新路径构建，旧路由下会白屏，必须回滚
    if site_changed; then
      rollback_to_prev "Nginx 配置刷新失败，且本次修改了 SITE_PORT/SITE_DOMAIN/SITE_PATH（新前端在旧路由下无法访问）"
    fi
    warn "Nginx 配置刷新失败，沿用现有配置（站点参数未变，不影响访问；可登录服务器执行 nginx -t 排查）"
  fi
  site_enable
  probe_frontend
fi

# ============================================================
# 十二、收尾：记录、定时备份、清理旧版本与旧日志
# ============================================================
record OK
install_backup_cron

step "清理旧版本（保留最近 $KEEP 个）"
CUR="$(basename "$(readlink -f "$APP_DIR/current")")"
# 目录名即时间戳，按名称倒序，超出 KEEP 的删除（永远不删当前版本；按目录名比较，不受软链路径影响）
ls -1d "$APP_DIR"/releases/*/ 2>/dev/null | sed 's#/$##' | grep -E '/[0-9]{14}$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r d; do
  [ "$(basename "$d")" = "$CUR" ] || rm -rf "$d"
done || true
# 失败版本（.failed）只保留最近 1 个；没有时 ls 返回 2，pipefail 下需容错
ls -1d "$APP_DIR"/releases/*.failed 2>/dev/null | sort -r | tail -n +2 | xargs -r rm -rf || true
# 发布日志只保留最近 20 次
ls -1t "$SHARED"/deploy-logs/*.log 2>/dev/null | tail -n +21 | while read -r f; do rm -f "$f" "$f.rc" "$f.pid"; done || true

echo ""
echo "✓ 发布完成: $STAMP（$(date '+%F %T')）"
