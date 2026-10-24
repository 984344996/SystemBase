#!/usr/bin/env bash
# ============================================================
# 服务器首次初始化（Ubuntu / Debian / CentOS / OpenCloudOS / TencentOS，root 执行，可重复执行）
# 由 deploy.sh init / deploy.ps1 init 上传到 /tmp/sb-setup/ 后调用：
#   bash setup-server.sh APP_DIR [APP_NAME]
# 前置：APP_DIR/shared/.env 已上传；同目录下有 env-tool.cjs、nginx-site.conf
# 可选环境变量：DB_ROOT_PASS（MySQL root 密码，免密登录不可用时需要）
# ============================================================
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

APP_DIR="${1:?用法: setup-server.sh APP_DIR [APP_NAME]}"
APP_NAME="${2:-systembase}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$APP_DIR/shared/.env"
NODE_MIN_MAJOR=20
PNPM_VERSION="${PNPM_VERSION:-9.15.0}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

[ "$(id -u)" = "0" ] || { echo "!! 请使用 root 执行（deploy/envs/<环境>.env 的 SSH_USER 设为 root）"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "!! 缺少 $ENV_FILE"; exit 1; }
tr -d '\r' < "$ENV_FILE" > "$ENV_FILE.lf" && mv "$ENV_FILE.lf" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ---------- 包管理器 ----------
if command -v apt-get >/dev/null 2>&1; then
  PKG=apt; INSTALL=(apt-get install -y); apt-get update -qq
elif command -v dnf >/dev/null 2>&1; then
  PKG=dnf; INSTALL=(dnf install -y)
elif command -v yum >/dev/null 2>&1; then
  PKG=yum; INSTALL=(yum install -y)
else
  echo "!! 不支持的系统（未找到 apt/dnf/yum）"; exit 1
fi

echo "==> [1/7] 安装 Node.js ${NODE_MIN_MAJOR} / pnpm / PM2 / Nginx（包管理: $PKG）"
"${INSTALL[@]}" curl tar >/dev/null 2>&1 || true
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]; then
  if [ "$PKG" = apt ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | bash -
  else
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | bash -
  fi
  "${INSTALL[@]}" nodejs
fi
echo "    Node: $(node -v)"

npm config set registry "$NPM_REGISTRY" >/dev/null
# npm 全局 bin 可能不在非交互 SSH 的精简 PATH 里（node 与 npm 前缀不一致时），统一挂上，
# 否则下面安装的 pnpm/pm2 在本脚本及后续 remote-deploy 中都找不到
NPM_BIN="$(npm prefix -g 2>/dev/null || true)/bin"
if [ -d "$NPM_BIN" ] && [[ ":$PATH:" != *":$NPM_BIN:"* ]]; then
  export PATH="$NPM_BIN:$PATH"
fi
if [ "$(pnpm -v 2>/dev/null || true)" != "$PNPM_VERSION" ]; then
  npm install -g "pnpm@$PNPM_VERSION" --no-audit --no-fund
fi
echo "    pnpm: $(pnpm -v)"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 --no-audit --no-fund
echo "    PM2: $(pm2 -v)"

if ! command -v nginx >/dev/null 2>&1; then
  # 腾讯云 OpenCloudOS 镜像在 dnf.conf 中 exclude 了 nginx，需 --disableexcludes 绕过
  "${INSTALL[@]}" nginx >/dev/null 2>&1 || dnf install -y --disableexcludes=main nginx
fi
echo "    Nginx: $(nginx -v 2>&1 | sed 's/.*\///')"

# ---------- 数据库 ----------
DB_INFO="$(node "$HERE/env-tool.cjs" db "$ENV_FILE")"
DB_HOST="$(sed -n 1p <<< "$DB_INFO")"; DB_USER="$(sed -n 3p <<< "$DB_INFO")"
DB_PASS="$(sed -n 4p <<< "$DB_INFO")"; DB_NAME="$(sed -n 5p <<< "$DB_INFO")"

if [ "$DB_HOST" != "127.0.0.1" ] && [ "$DB_HOST" != "localhost" ]; then
  echo "==> [2/7] 数据库在外部主机 $DB_HOST（如云数据库），跳过本机 MySQL 安装与建库"
  echo "==> [3/7] 请确认已在 $DB_HOST 上创建库 $DB_NAME 与账号 $DB_USER"
else
  echo "==> [2/7] 安装并启动 MySQL"
  MYSQL_SVC=""
  # 服务名：CentOS 系为 mysqld，Ubuntu 为 mysql
  for s in mysqld mysql; do systemctl cat "$s" >/dev/null 2>&1 && { MYSQL_SVC=$s; break; }; done
  if [ -z "$MYSQL_SVC" ]; then
    if [ "$PKG" = apt ]; then DEBIAN_FRONTEND=noninteractive "${INSTALL[@]}" mysql-server; MYSQL_SVC=mysql
    else "${INSTALL[@]}" mysql-server; MYSQL_SVC=mysqld; fi
  fi
  systemctl enable --now "$MYSQL_SVC" >/dev/null 2>&1 || true
  echo "    MySQL: $(mysql --version 2>/dev/null | sed 's/^mysql *//')（服务: $MYSQL_SVC）"

  # root 权限：免密(socket) → DB_ROOT_PASS → 初始临时密码
  MYSQL_AUTH=()
  if mysql -uroot -e "SELECT 1" >/dev/null 2>&1; then
    MYSQL_AUTH=(-uroot)
  elif [ -n "${DB_ROOT_PASS:-}" ] && mysql -uroot -p"$DB_ROOT_PASS" -e "SELECT 1" >/dev/null 2>&1; then
    MYSQL_AUTH=(-uroot -p"$DB_ROOT_PASS")
  else
    TP="$(grep -h 'temporary password' /var/log/mysqld.log 2>/dev/null | tail -1 | sed 's/.*root@localhost: //' || true)"
    if [ -n "$TP" ] && mysql -uroot -p"$TP" --connect-expired-password -e "SELECT 1" >/dev/null 2>&1; then
      ROOTPW="Sb$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')!x9"
      mysql -uroot -p"$TP" --connect-expired-password -e "ALTER USER 'root'@'localhost' IDENTIFIED BY '$ROOTPW';"
      MYSQL_AUTH=(-uroot -p"$ROOTPW")
      echo "    已用初始临时密码重置 MySQL root 密码，请妥善记录: $ROOTPW"
    else
      echo "!! 无法获取 MySQL root 权限。请重置 root 密码后执行: DB_ROOT_PASS='密码' ./deploy.sh init"
      exit 1
    fi
  fi

  echo "==> [3/7] 创建数据库 $DB_NAME 与账号 $DB_USER"
  # ★ 建库：库名/账号/密码取自 shared/.env 的 DATABASE_URL；仅当主机是 127.0.0.1/localhost 时执行，
  #   使用云数据库时跳过（需在云控制台自行建库建账号）
  mysql "${MYSQL_AUTH[@]}" -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  if [ "$DB_USER" = "root" ]; then
    echo "    DATABASE_URL 使用 root 账号：不修改 root 密码（生产建议使用独立账号）"
  else
    # SQL 字符串字面量转义：反斜杠与单引号
    SQL_PASS="${DB_PASS//\\/\\\\}"; SQL_PASS="${SQL_PASS//\'/\'\'}"
    # MySQL 8 的 validate_password 组件（默认 MEDIUM）会拒绝弱密码（ERROR 1819），
    # 导致建账号一步中止、库建好但账号缺失（后续 Prisma P1000）：
    # 建账号期间临时放宽为 LOW，完成后恢复（与 db-remote.sh 的处理一致）
    PW_POLICY="$(mysql "${MYSQL_AUTH[@]}" -N -e "SHOW VARIABLES LIKE 'validate_password%'" 2>/dev/null | awk '$1 ~ /policy$/ {print $NF}' | head -n 1)"
    if [ -n "$PW_POLICY" ] && [ "$PW_POLICY" != "LOW" ]; then
      mysql "${MYSQL_AUTH[@]}" -e "SET GLOBAL validate_password.policy=LOW" 2>/dev/null \
        || mysql "${MYSQL_AUTH[@]}" -e "SET GLOBAL validate_password_policy=LOW" 2>/dev/null || true
      echo "    （已临时放宽 MySQL 密码策略以创建应用账号，完成后恢复为 $PW_POLICY；建议 env 中使用强密码）"
    fi
    # ★ 建应用账号并授权（localhost 与 127.0.0.1 两个来源都建，避免 socket/TCP 认证差异）
    mysql "${MYSQL_AUTH[@]}" -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$SQL_PASS';"
    mysql "${MYSQL_AUTH[@]}" -e "ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$SQL_PASS';"
    mysql "${MYSQL_AUTH[@]}" -e "GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost'; FLUSH PRIVILEGES;"
    # 127.0.0.1 走 TCP，MySQL 按 localhost 账号匹配；同时建 127.0.0.1 账号兼容 skip-name-resolve
    mysql "${MYSQL_AUTH[@]}" -e "CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$SQL_PASS'; ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$SQL_PASS'; GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1'; FLUSH PRIVILEGES;"
    if [ -n "$PW_POLICY" ] && [ "$PW_POLICY" != "LOW" ]; then
      mysql "${MYSQL_AUTH[@]}" -e "SET GLOBAL validate_password.policy=$PW_POLICY" 2>/dev/null \
        || mysql "${MYSQL_AUTH[@]}" -e "SET GLOBAL validate_password_policy=$PW_POLICY" 2>/dev/null || true
    fi
  fi
  echo "    完成"
fi

# ---------- 目录 ----------
echo "==> [4/7] 创建目录 $APP_DIR/{releases,shared/logs,shared/pm2,shared/uploads}"
# shared/uploads：上传文件跨版本共享（每次发布由 remote-deploy.sh 软链到版本目录）
mkdir -p "$APP_DIR/releases" "$APP_DIR/shared/logs" "$APP_DIR/shared/pm2" "$APP_DIR/shared/uploads"

# ---------- Nginx 站点 ----------
echo "==> [5/7] 配置 Nginx 站点"
# 站点 server 块、路由片段（支持 SITE_PATH 子路径部署）、共享域名注入统一由 nginx-setup.sh 生成；
# remote-deploy.sh 每次发布也会调用它刷新，域名/子路径等配置变更无需重新 init
bash "$HERE/nginx-setup.sh" "$APP_DIR" "$APP_NAME" "$ENV_FILE"
# CentOS 系默认 nginx.conf 自带 default_server 监听 80，与站点冲突时去掉其 default_server 标记
sed -i 's/listen\(\s\+\)80 default_server;/listen\180;/; s/listen\(\s\+\)\[::\]:80 default_server;/listen\1[::]:80;/' /etc/nginx/nginx.conf 2>/dev/null || true
nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx

# SELinux（CentOS 系默认开启）：允许 nginx 反代到本机端口、读取部署目录
if command -v getenforce >/dev/null 2>&1 && [ "$(getenforce)" = "Enforcing" ]; then
  setsebool -P httpd_can_network_connect 1 || true
  echo "    SELinux: 已开启 httpd_can_network_connect"
fi

# ---------- 防火墙 ----------
echo "==> [6/7] 防火墙"
if systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-service=http --add-service=https >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "    firewalld 已放行 80/443"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "Nginx Full" >/dev/null 2>&1 || true
  echo "    ufw 已放行 Nginx"
else
  echo "    （本机防火墙未启用，依赖云厂商安全组）"
fi

# ---------- PM2 开机自启 ----------
echo "==> [7/7] PM2 开机自启"
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true

echo ""
echo "✓ 服务器初始化完成"
echo "  提醒: 云厂商安全组需放行 80(HTTP)/443(HTTPS)；22(SSH) 建议只对信任 IP 开放；3306 不要对外开放"
