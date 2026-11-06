#!/usr/bin/env bash
# ============================================================
# 服务器端数据库备份 / 恢复（由 deploy.sh、remote-deploy.sh、每日定时任务调用，也可登录服务器直接执行）
#   bash db-backup.sh APP_DIR APP_NAME backup [备注]        备份到 shared/backup/
#   bash db-backup.sh APP_DIR APP_NAME restore <文件绝对路径>  用 .sql / .sql.gz 恢复
#   bash db-backup.sh APP_DIR APP_NAME list                 列出服务器上的备份
#
# - 数据库连接信息取自 shared/.env 的 DATABASE_URL（不额外配置）
# - 密码用 MYSQL_PWD 环境变量传递，不出现在 ps 进程参数里
# - backup 成功后最后一行固定输出 "BACKUP_FILE=<路径>"，调用方据此取得文件路径（不要改格式）
# - restore 流程：先备份当前库 → 停应用 → 清空库内全部表 → 导入 → 迁移到当前代码版本 → 启动应用
#   （危险操作的二次确认由本机 deploy.sh 负责）
# - 备份保留 KEEP_BACKUP_DAYS 天（默认 7），按文件修改时间清理
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

APP_DIR="${1:?用法: db-backup.sh APP_DIR APP_NAME backup|restore|list [参数]}"
APP_NAME="${2:?缺少 APP_NAME}"
CMD="${3:-backup}"
ARG="${4:-}"

SHARED="$APP_DIR/shared"
BACKUP_DIR="$SHARED/backup"
KEEP_DAYS="${KEEP_BACKUP_DAYS:-7}"
PM2_NAME="$APP_NAME-server"
# env 解析器：优先用同目录（发布包内）的，单独上传到 /tmp 执行时用线上版本的
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_TOOL="$HERE/env-tool.cjs"
[ -f "$ENV_TOOL" ] || ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }   # 打印错误到 stderr 并退出

# ---------- 读取数据库连接信息 ----------
[ -f "$SHARED/.env" ] || die "缺少 $SHARED/.env（请先执行 init 发布，数据库连接信息取自该文件）"
DB_INFO="$(node "$ENV_TOOL" db "$SHARED/.env")" || exit 1
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"
DB_PORT="$(sed -n 2p <<< "$DB_INFO")"
DB_USER="$(sed -n 3p <<< "$DB_INFO")"
DB_PASS="$(sed -n 4p <<< "$DB_INFO")"
DB_NAME="$(sed -n 5p <<< "$DB_INFO")"
export MYSQL_PWD="$DB_PASS"

command -v mysqldump >/dev/null 2>&1 || die "服务器未安装 mysqldump（外部数据库请在云控制台备份）"
command -v mysql >/dev/null 2>&1 || die "服务器未安装 mysql 客户端"

# mysql / mysqldump 通用连接参数
mysql_args() { echo "-h $DB_HOST -P $DB_PORT -u $DB_USER --default-character-set=utf8mb4"; }

# MySQL 8 默认开启 GTID：默认导出的 dump 含 SET @@GLOBAL.GTID_PURGED，恢复时报 ERROR 3546
# （gtid set 与 GTID_EXECUTED 重叠）。开启 GTID 时导出必须加 --set-gtid-purged=OFF
gtid_dump_opt() {
  mysql $(mysql_args) -N -e "SELECT @@gtid_mode" 2>/dev/null \
    | grep -qiE '^(ON|ON_PERMISSIVE)$' && echo "--set-gtid-purged=OFF" || true
}

# 兼容历史备份：旧 dump 里的 GTID 语句恢复时会失败，导入前剔除（不影响数据）
strip_gtid() { sed -E '/^SET @@(GLOBAL\.GTID_PURGED|SESSION\.SQL_LOG_BIN|SESSION\.GTID_NEXT)/d'; }

# ---------- 备份 ----------
# $1 = 备注（可空）。成功时最后一行输出 BACKUP_FILE=<路径>
do_backup() {
  local note="$1" stamp name file
  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y%m%d%H%M%S)"
  name="${DB_NAME}_${stamp}"
  # 备注清洗：只保留字母数字、_-、中文（tr 会把中文逐字节替换成下划线，故用 node）
  [ -n "$note" ] && name="${name}_$(node -e 'process.stdout.write(String(process.argv[1]).replace(/[^A-Za-z0-9_一-龥-]+/g,"_"))' "$note")"
  file="$BACKUP_DIR/$name.sql.gz"
  # --single-transaction：InnoDB 一致性快照，不锁表，备份期间应用可正常读写
  # --no-tablespaces：MySQL 8 默认要读表空间信息（需要 PROCESS 权限），只授权了本库的应用账号会失败
  if mysqldump $(mysql_args) $(gtid_dump_opt) --no-tablespaces --single-transaction --quick --routines --triggers "$DB_NAME" \
    | gzip > "$file"; then
    echo -e "${G}✓ 备份完成: $file（$(du -h "$file" | cut -f1)）${N}"
  else
    rm -f "$file"
    die "备份失败：请检查数据库账号是否有 SELECT / SHOW VIEW / TRIGGER 权限"
  fi
  # 清理过期备份（按修改时间）；先清理再输出路径，保证路径是最后一行
  find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null \
    | sed 's/^/  已清理过期备份: /' || true
  echo "BACKUP_FILE=$file"
}

# ---------- 恢复用到的辅助函数 ----------
APP_STOPPED=0   # 恢复期间是否停过应用（失败时据此重新启动）

# 让非交互 SSH 也能找到 npm 全局安装的 pm2
ensure_pm2_path() {
  command -v pm2 >/dev/null 2>&1 && return 0
  local dir; dir="$(npm prefix -g 2>/dev/null || true)"
  [ -n "$dir" ] && [ -x "$dir/bin/pm2" ] && export PATH="$dir/bin:$PATH"
  return 0
}

# 停止本环境应用：恢复期间不能有写入，否则导入的数据与新写入交错
stop_app() {
  ensure_pm2_path
  command -v pm2 >/dev/null 2>&1 && pm2 describe "$PM2_NAME" >/dev/null 2>&1 || return 0
  echo -e "${Y}停止应用 $PM2_NAME（恢复期间暂停服务）${N}"
  pm2 stop "$PM2_NAME" >/dev/null
  APP_STOPPED=1
}

# 启动本环境应用（只在 stop_app 停过时执行）
start_app() {
  [ "$APP_STOPPED" = 1 ] || return 0
  if pm2 start "$PM2_NAME" >/dev/null; then
    APP_STOPPED=0
    echo "  应用已重新启动"
  else
    echo -e "${R}  !! 应用启动失败，请执行 ./sb.sh <环境> start 或登录服务器 pm2 logs 排查${N}"
  fi
}

# 清空库内全部表与视图：mysqldump 只会 DROP 备份里有的表，备份之后新建的表会残留，
# 与恢复出来的旧 _prisma_migrations 记录冲突，导致下次迁移报「表已存在」
drop_all_tables() {
  local tables views
  tables="$(mysql $(mysql_args) -N -e "SELECT CONCAT('\`', table_name, '\`') FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='BASE TABLE'" | paste -sd, -)"
  views="$(mysql $(mysql_args) -N -e "SELECT CONCAT('\`', table_name, '\`') FROM information_schema.tables WHERE table_schema='$DB_NAME' AND table_type='VIEW'" | paste -sd, -)"
  [ -z "$views" ] || mysql $(mysql_args) "$DB_NAME" -e "DROP VIEW IF EXISTS $views;"
  [ -z "$tables" ] || mysql $(mysql_args) "$DB_NAME" -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS $tables; SET FOREIGN_KEY_CHECKS=1;"
}

# 把恢复后的库结构对齐到当前线上代码：只补跑备份之后新增的迁移（备份比代码旧时生效）
migrate_to_code() {
  local srv="$APP_DIR/current/apps/server" latest_db latest_code
  [ -x "$srv/node_modules/.bin/prisma" ] || { echo -e "${Y}  未找到线上版本的 prisma，跳过结构对齐${N}"; return 0; }
  echo -e "${Y}对齐数据库结构到当前代码版本（prisma migrate deploy）${N}"
  if ! (cd "$srv" && ./node_modules/.bin/prisma migrate deploy); then
    echo -e "${R}  !! 迁移失败：数据已恢复，但结构与当前代码不一致；请回滚/发布到与备份对应的代码版本后重试${N}"
    return 1
  fi
  # 备份比代码新（来自更高版本）：库里有代码不认识的迁移，旧代码可能无法正常运行
  latest_db="$(mysql $(mysql_args) "$DB_NAME" -N -e "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1" 2>/dev/null || true)"
  latest_code="$(ls -1 "$srv/prisma/migrations" 2>/dev/null | grep -E '^[0-9]{14}_' | sort | tail -n 1 || true)"
  if [ -n "$latest_db" ] && [ -n "$latest_code" ] && [[ "$latest_db" > "$latest_code" ]]; then
    echo -e "${Y}  ⚠ 备份来自更新的代码版本（库: $latest_db，代码: $latest_code），请发布对应版本的代码${N}"
  fi
}

# 恢复失败时兜底：重新启动被停掉的应用，提示用自动备份回退
on_restore_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$APP_STOPPED" = 1 ]; then
    echo -e "${R}!! 恢复失败，重新启动应用；数据库可能不完整，可用 auto-before-restore 备份再次恢复${N}"
    pm2 start "$PM2_NAME" >/dev/null 2>&1 || true
  fi
}

# ---------- 恢复 ----------
# $1 = .sql 或 .sql.gz 文件绝对路径
do_restore() {
  local file="$1" rc=0
  [ -n "$file" ] || die "restore 需要指定备份文件路径"
  [ -f "$file" ] || die "备份文件不存在: $file"
  case "$file" in *.sql.gz|*.sql) ;; *) die "备份文件需为 .sql 或 .sql.gz" ;; esac

  echo -e "${Y}恢复前先备份当前库（auto-before-restore）...${N}"
  do_backup "auto-before-restore" | sed '/^BACKUP_FILE=/d'

  trap on_restore_exit EXIT
  stop_app
  echo -e "${Y}清空库 ${DB_NAME} 内全部表${N}"
  drop_all_tables
  echo -e "${Y}正在导入 $file → ${DB_NAME}${N}"
  if [ "${file%.gz}" != "$file" ]; then
    gunzip < "$file" | strip_gtid | mysql $(mysql_args) "$DB_NAME"
  else
    strip_gtid < "$file" | mysql $(mysql_args) "$DB_NAME"
  fi
  migrate_to_code || rc=1
  start_app
  [ "$rc" = 0 ] || exit 1
  echo -e "${G}✓ 恢复完成${N}"
}

# ---------- 命令分发 ----------
case "$CMD" in
  backup)  do_backup "$ARG" ;;
  restore) do_restore "$ARG" ;;
  list)
    [ -d "$BACKUP_DIR" ] || { echo "还没有备份"; exit 0; }
    echo "备份列表（$BACKUP_DIR，保留 ${KEEP_DAYS} 天）："
    ls -lhtr "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk '{print "  "$5"\t"$9}' | sed "s|$BACKUP_DIR/||" || echo "  （空）"
    ;;
  *) die "未知命令: $CMD（backup / restore / list）" ;;
esac
