#!/usr/bin/env bash
# ============================================================
# 数据库远程访问开关（排查问题 / 本地客户端直连用，用完请关闭）
#   bash db-remote.sh APP_DIR on [允许IP，默认 % 任意]   监听 0.0.0.0 + 建 '<用户>'@'<IP>' 账号
#   bash db-remote.sh APP_DIR off [IP]                   删除远程账号（默认全部）+ 恢复仅本机监听
# 由 ./sb.sh <环境> db-remote-on / db-remote-off 调用（交互式，可能要求输入 MySQL root 密码）
# - 账号与密码同 shared/.env 的 DATABASE_URL，只授权本库
# - 拒绝开放 root 账号；外部数据库请到云控制台配置白名单
# - 密码一律经 MYSQL_PWD / stdin 传给 mysql，不出现在进程参数里
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu

APP_DIR="${1:?用法: db-remote.sh APP_DIR on|off [IP]}"
MODE="${2:?用法: db-remote.sh APP_DIR on|off [IP]}"
ALLOW_IP="${3:-%}"
ENV_FILE="$APP_DIR/shared/.env"
ENV_TOOL="$APP_DIR/current/deploy/server/env-tool.cjs"
[ -f "$ENV_FILE" ] || { echo "!! 未找到 $ENV_FILE"; exit 1; }
# 来源 IP 会拼进 SQL，只允许 IP / 主机名 / % 通配字符
[[ "$ALLOW_IP" =~ ^[0-9A-Za-z.%:_-]+$ ]] || { echo "!! 来源 IP 格式不正确: $ALLOW_IP"; exit 1; }

# ---------- 读取数据库信息 ----------
DB_INFO="$(node "$ENV_TOOL" db "$ENV_FILE")"
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"; DB_USER="$(sed -n 3p <<< "$DB_INFO")"
DB_PASS="$(sed -n 4p <<< "$DB_INFO")"; DB_NAME="$(sed -n 5p <<< "$DB_INFO")"
if [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "localhost" ]; then
  echo "!! 数据库在外部主机 $DB_HOST，请在对应云数据库控制台配置访问白名单"; exit 1
fi
[ "$DB_USER" != "root" ] || { echo "!! DATABASE_URL 使用 root 账号，拒绝开放 root 远程访问；请改用独立账号"; exit 1; }
# SQL 字符串字面量转义：反斜杠与单引号
SQL_PASS="${DB_PASS//\\/\\\\}"; SQL_PASS="${SQL_PASS//\'/\'\'}"

# MySQL 服务名（CentOS 系 mysqld / Ubuntu mysql）与配置文件位置
SVC=mysqld; systemctl cat mysql >/dev/null 2>&1 && ! systemctl cat mysqld >/dev/null 2>&1 && SVC=mysql
MYCNF=/etc/my.cnf
[ -f /etc/mysql/mysql.conf.d/mysqld.cnf ] && MYCNF=/etc/mysql/mysql.conf.d/mysqld.cnf

# ---------- root 权限：socket 免密 → 之前 init 保存的密码 → 交互输入 ----------
ROOT_PW=""
# 以 root 执行 SQL（参数原样透传给 mysql；有密码时经 MYSQL_PWD 传入）
mysql_root() {
  if [ -n "$ROOT_PW" ]; then MYSQL_PWD="$ROOT_PW" mysql -uroot "$@"; else mysql -uroot "$@"; fi
}
if ! mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
  ROOT_PW="$(cat /root/.mysql-root-pass 2>/dev/null || true)"
  if [ -z "$ROOT_PW" ] || ! mysql_root -e "SELECT 1" >/dev/null 2>&1; then
    read -r -s -p "MySQL root 密码: " ROOT_PW && echo ""
    mysql_root -e "SELECT 1" >/dev/null 2>&1 || { echo "!! root 密码验证失败"; exit 1; }
  fi
fi

# 修改 MySQL 监听地址：已有 bind-address 则替换，否则加到 [mysqld] 段（没有该段则追加）
set_bind() {
  if grep -qiE '^[#[:space:]]*bind-address' "$MYCNF" 2>/dev/null; then
    sed -i "s/^[#[:space:]]*bind-address[[:space:]]*=.*/bind-address = $1/I" "$MYCNF"
  elif grep -q '^\[mysqld\]' "$MYCNF" 2>/dev/null; then
    sed -i "/^\[mysqld\]/a bind-address = $1" "$MYCNF"
  else
    printf '\n[mysqld]\nbind-address = %s\n' "$1" >> "$MYCNF"
  fi
}

# 重启 MySQL 让监听地址生效（后端连接池会自动重连）
restart_mysql() {
  systemctl restart "$SVC"; sleep 2
  systemctl is-active --quiet "$SVC" && echo "    MySQL 已恢复运行（后端连接池会自动重连）" || { echo "!! MySQL 重启异常: journalctl -u $SVC -n 20"; exit 1; }
}

# 当前密码策略级别（MySQL 8 validate_password 组件；未安装时为空）
pw_policy() { mysql_root -N -e "SHOW VARIABLES LIKE 'validate_password%'" 2>/dev/null | awk '$1 ~ /policy$/ {print $NF}' | head -n 1; }

# 设置密码策略级别（兼容 8.0 组件写法与 5.7 插件写法）
set_pw_policy() {
  mysql_root -e "SET GLOBAL validate_password.policy=$1" 2>/dev/null \
    || mysql_root -e "SET GLOBAL validate_password_policy=$1" 2>/dev/null || true
}

case "$MODE" in
  on)
    echo "==> [1/3] 监听 0.0.0.0（$MYCNF）"
    set_bind 0.0.0.0
    echo "==> [2/3] 创建远程账号 '$DB_USER'@'$ALLOW_IP'（仅 $DB_NAME.* 权限）"
    # MySQL 8 密码策略可能拒绝 env 中的应用密码：建账号期间临时放宽为 LOW，完成后恢复
    PW_POLICY="$(pw_policy || true)"
    [ -z "$PW_POLICY" ] || [ "$PW_POLICY" = "LOW" ] || set_pw_policy LOW
    mysql_root <<SQL
CREATE USER IF NOT EXISTS '$DB_USER'@'$ALLOW_IP' IDENTIFIED BY '$SQL_PASS';
ALTER USER '$DB_USER'@'$ALLOW_IP' IDENTIFIED BY '$SQL_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'$ALLOW_IP';
FLUSH PRIVILEGES;
SQL
    [ -z "$PW_POLICY" ] || [ "$PW_POLICY" = "LOW" ] || set_pw_policy "$PW_POLICY"
    echo "==> [3/3] 重启 MySQL（$SVC）"
    restart_mysql
    IP="$(curl -s --max-time 3 ifconfig.me || hostname -I | awk '{print $1}')"
    echo ""
    echo "✓ 已开放远程访问: mysql://$DB_USER@$IP:3306/$DB_NAME（密码同生产配置）"
    [ "$ALLOW_IP" = "%" ] && echo "  ⚠ 当前允许任意来源，强烈建议改为白名单: ./sb.sh <环境> db-remote-on <你的公网IP>"
    echo "  ⚠ 还需在云厂商安全组放行 3306（同样限定来源 IP）；用完执行 ./sb.sh <环境> db-remote-off"
    ;;
  off)
    echo "==> [1/3] 删除远程账号（保留 localhost / 127.0.0.1）"
    if [ -n "${3:-}" ]; then
      mysql_root -e "DROP USER IF EXISTS '$DB_USER'@'$ALLOW_IP';"
    else
      for h in $(mysql_root -N -e "SELECT host FROM mysql.user WHERE user='$DB_USER' AND host NOT IN ('localhost','127.0.0.1');"); do
        echo "    删除 '$DB_USER'@'$h'"
        mysql_root -e "DROP USER IF EXISTS '$DB_USER'@'$h';"
      done
    fi
    echo "==> [2/3] 恢复仅本机监听 127.0.0.1"
    set_bind 127.0.0.1
    echo "==> [3/3] 重启 MySQL（$SVC）"
    restart_mysql
    echo ""
    echo "✓ 已关闭远程访问（仅本机可连），请同时在安全组收回 3306"
    ;;
  *) echo "未知模式: $MODE（on / off）"; exit 1 ;;
esac
