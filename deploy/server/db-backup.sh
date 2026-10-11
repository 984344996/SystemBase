#!/usr/bin/env bash
# ============================================================
# 服务器端数据库备份 / 恢复（由 deploy.sh 通过 ssh 调用，也可登录服务器直接执行）
#   bash db-backup.sh APP_DIR APP_NAME backup [备注]
#   bash db-backup.sh APP_DIR APP_NAME restore <sql.gz 文件绝对路径>
#
# - 数据库信息取自 shared/.env 的 DATABASE_URL（不额外配置）
# - 密码用 MYSQL_PWD 传递，不出现在 ps 参数里
# - 恢复前会自动备份当前库（auto-before-restore），危险操作由 deploy.sh 在本机先做二次确认
# - 备份目录 shared/backup，默认保留 KEEP_BACKUP_DAYS（默认 7）天
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

APP_DIR="${1:?用法: db-backup.sh APP_DIR APP_NAME backup|restore [参数]}"
APP_NAME="${2:?缺少 APP_NAME}"
CMD="${3:-backup}"
ARG="${4:-}"

SHARED="$APP_DIR/shared"
ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"
BACKUP_DIR="$SHARED/backup"
KEEP_DAYS="${KEEP_BACKUP_DAYS:-7}"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
die() { echo -e "${R}✗ $*${N}" >&2; exit 1; }

[ -f "$SHARED/.env" ] || die "缺少 $SHARED/.env（请先执行 init 发布，数据库连接信息取自该文件）"
DB_INFO="$(node "$ENV_TOOL" db "$SHARED/.env")" || exit 1
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"
DB_PORT="$(sed -n 2p <<< "$DB_INFO")"
DB_USER="$(sed -n 3p <<< "$DB_INFO")"
DB_PASS="$(sed -n 4p <<< "$DB_INFO")"
DB_NAME="$(sed -n 5p <<< "$DB_INFO")"
export MYSQL_PWD="$DB_PASS"

command -v mysqldump >/dev/null 2>&1 || die "服务器未安装 mysqldump（外部数据库请在本地备份）"
command -v mysql >/dev/null 2>&1 || die "服务器未安装 mysql 客户端"

mysql_args() { echo "-h $DB_HOST -P $DB_PORT -u $DB_USER --default-character-set=utf8mb4"; }

# ★ MySQL 8 默认开启 GTID：默认导出的 dump 含 SET @@GLOBAL.GTID_PURGED，恢复时报 ERROR 3546
#   （gtid set 与 GTID_EXECUTED 重叠）。开启 GTID 时必须 --set-gtid-purged=OFF
gtid_dump_opt() {
  mysql $(mysql_args) -N -e "SELECT @@gtid_mode" 2>/dev/null \
    | grep -qiE '^(ON|ON_PERMISSIVE)$' && echo "--set-gtid-purged=OFF" || true
}

# 兼容历史备份：旧 dump 里的 GTID 语句恢复时会失败，导入前剔除（不影响数据）
strip_gtid() { sed -E '/^SET @@(GLOBAL\.GTID_PURGED|SESSION\.SQL_LOG_BIN|SESSION\.GTID_NEXT)/d'; }

do_backup() {
  local note="$1" stamp name
  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y%m%d%H%M%S)"
  name="${DB_NAME}_${stamp}"
  # 备注清洗：保留字母数字、_-、中文（tr 会把中文逐字节替换成下划线，故用 node）
  [ -n "$note" ] && name="${name}_$(node -e 'process.stdout.write(String(process.argv[1]).replace(/[^A-Za-z0-9_一-龥-]+/g,"_"))' "$note")"
  # --single-transaction：InnoDB 一致性快照，不锁表
  # --no-tablespaces：MySQL 8 的 mysqldump 默认要读 tablespace 信息，需要 PROCESS 权限，
  #   应用账号（只授权了本库）没有该权限会直接失败；本备份不含表空间信息，加此选项即可
  if mysqldump $(mysql_args) $(gtid_dump_opt) --no-tablespaces --single-transaction --quick --routines --triggers "$DB_NAME" \
    | gzip > "$BACKUP_DIR/$name.sql.gz"; then
    echo -e "${G}✓ 备份完成: $BACKUP_DIR/$name.sql.gz（$(du -h "$BACKUP_DIR/$name.sql.gz" | cut -f1)）${N}"
    echo "$BACKUP_DIR/$name.sql.gz"
  else
    rm -f "$BACKUP_DIR/$name.sql.gz"
    die "备份失败：请检查数据库账号是否有 SELECT / SHOW VIEW / TRIGGER 权限"
  fi
  # 清理过期备份（按修改时间）
  find "$BACKUP_DIR" -name "*.sql.gz" -type f -mtime +"$KEEP_DAYS" -print -delete 2>/dev/null | sed 's/^/  已清理过期备份: /' || true
}

do_restore() {
  local file="$1"
  [ -n "$file" ] || die "restore 需要指定备份文件路径"
  [ -f "$file" ] || die "备份文件不存在: $file"
  case "$file" in *.sql.gz|*.sql) ;; *) die "备份文件需为 .sql 或 .sql.gz" ;; esac

  echo -e "${Y}恢复前先备份当前库...${N}"
  do_backup "auto-before-restore" >/dev/null

  echo -e "${Y}正在恢复 $file → ${DB_NAME}（会覆盖现有数据）${N}"
  if [ "${file%.gz}" != "$file" ]; then
    gunzip < "$file" | strip_gtid | mysql $(mysql_args) "$DB_NAME"
  else
    strip_gtid < "$file" | mysql $(mysql_args) "$DB_NAME"
  fi
  echo -e "${G}✓ 恢复完成${N}"
}

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
