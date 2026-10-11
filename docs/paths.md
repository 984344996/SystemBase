# 存储路径速查（本地 / 远程）

一份文档说清「日志、数据库、网站产物、服务器文件」分别在哪。路径分两类：

- **本地**：开发机（macOS，仓库根目录 `SystemBase/`）
- **远程**：服务器 `162.14.99.8`，两个环境同机部署（`remote-pre` 已上线，`remote-release` 尚未部署）

环境变量决定大部分路径：`LOG_DIR`（日志）、`UPLOAD_DIR`（上传文件）、`DATABASE_URL`（库名）、`DEPLOY_DIR` / `APP_NAME`（部署位置）。

---

## 一、总览对照表

| 类别 | 本地（local） | 远程 remote-pre（已上线） | 远程 remote-release（未部署） |
| --- | --- | --- | --- |
| 代码/仓库 | `SystemBase/` | `/opt/systembase-pre/current`（软链） | `/opt/systembase/current` |
| 版本目录 | — | `/opt/systembase-pre/releases/<时间戳>` | `/opt/systembase/releases/<时间戳>` |
| 配置文件 | `deploy/envs/local.env` → `apps/server/.env`（软链） | `/opt/systembase-pre/shared/.env` | `/opt/systembase/shared/.env` |
| 后端日志 | `apps/server/logs/app.YYYY-MM-DD.log` | `/opt/systembase-pre/shared/logs/app.YYYY-MM-DD.log` | `/opt/systembase/shared/logs/…` |
| 前端日志 | 同上目录 `web.YYYY-MM-DD.log` | 同左 | 同左 |
| 进程输出 | `.run/server.log`、`.run/web.log` | `/opt/systembase-pre/shared/pm2/{out,error}.log` | `/opt/systembase/shared/pm2/…` |
| 数据库 | 本机 MySQL 库 `system_base` | 服务器 MySQL 库 `system_base_pre` | `system_base` |
| 数据库备份 | `backup/local/*.sql.gz` | 服务器 `shared/backup/*.sql.gz` + 拉回本地 `backup/remote-pre/` | `backup/remote-release/` |
| 上传文件 | `apps/server/uploads/` | `current/apps/server/uploads/`（⚠ 见注意事项） | 同左 |
| 网站静态产物 | 不构建（`vite dev` 5174） | `current/apps/web/dist/` | `current/apps/web/dist/` |
| Nginx 配置 | — | `/etc/nginx/conf.d/systembase-pre.conf` + `/etc/nginx/snippets/systembase-pre-locations.conf` | `/etc/nginx/conf.d/systembase.conf` |
| 访问入口 | `http://localhost:5174` | `https://beautywash.top/systembase-pre`（子路径）、`http://162.14.99.8:8080/systembase-pre` | 待定（`SITE_PORT=80`） |

---

## 二、本地（开发环境）

根目录 = 仓库 `SystemBase/`。

| 用途 | 路径 | 说明 |
| --- | --- | --- |
| 环境配置（唯一来源） | `deploy/envs/local.env` | 启动时同步为 `apps/server/.env`（Mac/Linux 软链，Windows 复制） |
| 后端运行日志 | `apps/server/logs/app.YYYY-MM-DD.log` | 每天一个，`LOG_KEEP_DAYS=30` 天自动清理 |
| 前端（浏览器）日志 | `apps/server/logs/web.YYYY-MM-DD.log` | 浏览器上报，靠 `traceId` 与后端日志串联 |
| 后端进程输出 | `.run/server.log` | `nest start --watch` 的 stdout；`./sb.sh local logs` 跟踪 |
| 前端进程输出 | `.run/web.log` | Vite dev server 输出 |
| 构建期临时配置 | `.run/env.production` | 由 env 剔除部署键生成，权限 600，已 gitignore |
| 数据库 | 本机 MySQL `system_base` | `DATABASE_URL=mysql://root@127.0.0.1:3306/system_base`（`root` 免密） |
| 数据库备份 | `backup/local/<时间>_<备注>.sql.gz` | 已 gitignore |
| 上传文件 | `apps/server/uploads/` | `UPLOAD_DIR` 默认相对路径 `uploads`，相对后端运行目录 |
| 端口 | 后端 `3001`、前端 `5174` | 避开本机 3000/5173（另一个项目占用） |

常用命令：

```bash
./sb.sh local start                 # 启动后端 + 前端
./sb.sh local logs                  # 跟踪 .run/server.log
./sb.sh local db-backup 备注         # → backup/local/
./sb.sh local db-list               # 列出本地备份
./sb.sh local db-restore backup/local/xxx.sql.gz
tail -f apps/server/logs/app.$(date +%F).log
```

---

## 三、远程：remote-pre（162.14.99.8，已上线）

### 3.1 部署目录结构

```
/opt/systembase-pre/
├── current -> releases/20261011145911      # 软链，指向当前版本（Nginx/PM2 都用它）
├── releases/
│   ├── 20261011145911/                     # 每个版本一份完整代码
│   │   ├── apps/server/{dist,prisma,.env -> shared/.env,logs -> shared/logs}
│   │   ├── apps/web/dist/                  # 前端产物（Nginx 直接指向这里）
│   │   └── deploy/server/                  # 服务器端脚本
│   └── …（保留 KEEP_RELEASES=5 个，回滚用）
├── releases.log                            # 发布/回滚记录
└── shared/                                 # 跨版本共享，切换版本不丢
    ├── .env                                # 应用配置（600），发布时随包刷新
    ├── logs/                               # app.*.log / web.*.log
    ├── pm2/                                # pm2 out.log / error.log
    ├── backup/                             # mysqldump 备份（尚不存在，首次备份后生成）
    └── uploads/                            # 建议（当前未使用，见注意事项）
```

### 3.2 日志

| 类型 | 路径 |
| --- | --- |
| 后端应用日志 | `/opt/systembase-pre/shared/logs/app.YYYY-MM-DD.log` |
| 前端日志 | `/opt/systembase-pre/shared/logs/web.YYYY-MM-DD.log` |
| PM2 输出 | `/opt/systembase-pre/shared/pm2/out.log`、`error.log` |
| 发布记录 | `/opt/systembase-pre/releases.log` |
| Nginx 访问/错误 | `/var/log/nginx/access.log`、`error.log` |

```bash
./sb.sh remote-pre logs              # 今日日志
./sb.sh remote-pre logs ERROR        # 只看 ERROR
./sb.sh remote-pre logs WARN 2026-10-11
./sb.sh remote-pre logs follow       # 实时跟踪
./sb.sh remote-pre logs pm2          # PM2 输出（启动失败/异常退出看这里）
```

### 3.3 数据库

| 项 | 值 |
| --- | --- |
| 库名 | `system_base_pre` |
| 账号 | `systembase_pre`（`localhost` + `127.0.0.1` 两个） |
| 连接串 | `shared/.env` 的 `DATABASE_URL`（`mysql://systembase_pre:***@127.0.0.1:3306/system_base_pre`） |
| MySQL 数据目录 | `/var/lib/mysql/system_base_pre/` |
| MySQL 版本/策略 | MySQL 8.0.46，`validate_password` 策略 MEDIUM |

```bash
./sb.sh remote-pre db-backup 发版前   # 服务器 mysqldump → 拉回 backup/remote-pre/
./sb.sh remote-pre db-list
./sb.sh remote-pre db-restore backup/remote-pre/xxx.sql.gz
```

备份双份留存：服务器 `shared/backup/` 保留 `KEEP_BACKUP_DAYS`（默认 7）天，本地 `backup/remote-pre/` 长期保留（已 gitignore）。

### 3.4 网站（前端产物）与 Nginx

| 用途 | 路径 |
| --- | --- |
| 前端产物 | `/opt/systembase-pre/current/apps/web/dist/`（含 `index.html`、`assets/`） |
| 后端服务 | PM2 `systembase-pre-server`，监听 `127.0.0.1:3001` |
| 本环境站点配置 | `/etc/nginx/conf.d/systembase-pre.conf`（`listen 8080; server_name beautywash.top`） |
| 路由片段 | `/etc/nginx/snippets/systembase-pre-locations.conf`（前缀 `/systembase-pre`，API 剥前缀反代 3001） |
| 共享域名站点（注入点） | `/etc/nginx/conf.d/washsystem.conf`（第 42 行 `include` 片段，443 块） |
| 线上访问地址 | `https://beautywash.top/systembase-pre/` |

同机还有另一个应用（wash）：站点 `/etc/nginx/conf.d/washsystem.conf`（80/443，`server_name beautywash.top`，根目录 `/opt/washsystem/frontend/dist`，反代 3000）。两者靠 **端口（8080 vs 80/443）+ 路径前缀** 区分，互不干扰。

---

## 四、远程：remote-release（正式，尚未部署）

配置已在 `deploy/envs/remote-release.env`（字段已与 remote-pre 对齐），尚未执行过 init/deploy：

| 项 | 值 |
| --- | --- |
| 服务器 | 同机 `162.14.99.8` |
| `DEPLOY_DIR` | `/opt/systembase` |
| `APP_NAME` | `systembase` |
| 后端端口 | `PORT=3000` ⚠ 与 wash 后端（3000）冲突，上线前必须改（如 3002） |
| `SITE_PORT` | 80（模板值） |
| 库名 | `system_base` |

上线前需要修改的项：`DATABASE_URL` 的密码与库、账号、`PORT`、`SITE_PORT` / `SITE_DOMAIN` / `SITE_PATH`、`JWT_SECRET`、`CORS_ORIGINS`。

---

## 五、上传文件目录（⚠ 需要修）

`UPLOAD_DIR` 默认 `uploads`，是**相对路径**（相对后端进程运行目录）：

- 本地 → `apps/server/uploads/`（稳定）
- 远程 → `/opt/systembase-pre/current/apps/server/uploads/`（**随 `current` 软链切换而变**，回滚后新上传的文件会“丢”在旧 release 目录里）

建议在 `deploy/envs/remote-pre.env` 显式改为绝对路径并重新发布：

```bash
UPLOAD_DIR=/opt/systembase-pre/shared/uploads
```

（目录可在服务器上 `mkdir -p` 建好；已有文件需从旧 release 目录迁移过去。）

---

## 六、注意事项

1. **不要提交**：`deploy/envs/*.env`（含密码）、`backup/`（含业务数据）、`.run/`、`apps/server/logs/` 均已 gitignore，只提交模板（`deploy/envs/remote.env.example`、`local.env.example`）。
2. **日志只落文件不落库**：登录日志、操作日志、任务执行记录全在 `LOG_DIR`，排障按 `traceId` 串联前后端；管理端「系统日志」页可直接查看/下载（区分后端 `app.*` 与前端 `web.*`）。
3. **跨版本保留的只有 `shared/`**：`releases/<版本>` 里的任何文件都会随版本切换失效，需要持久化的（配置、日志、上传、备份）都必须放 `shared/`。
4. **8080 未放行**：云安全组未开放 TCP 8080，外网访问请走 `https://beautywash.top/systembase-pre/`（443）。
5. **子路径部署改 `SITE_PATH` 必须重新 deploy**：前端 `base`、路由、API 前缀在构建期固定，只改服务器 Nginx 不生效。
6. `remote-release` 的 `PORT=3000` 与 wash 冲突，上线前务必调整。

---

## 七、配置文件位置（服务器 162.14.99.8）

### 7.1 Nginx

| 文件 | 说明 |
| --- | --- |
| `/etc/nginx/nginx.conf` | 主配置（`user nginx`；`access_log /var/log/nginx/access.log`；`error_log /var/log/nginx/error.log`；`include /etc/nginx/conf.d/*.conf`） |
| `/etc/nginx/conf.d/systembase-pre.conf` | 本环境站点：`listen 8080; server_name beautywash.top` |
| `/etc/nginx/conf.d/washsystem.conf` | 同机 wash 应用站点（80/443），第 42 行有注入的 `include /etc/nginx/snippets/systembase-pre-locations.conf;` |
| `/etc/nginx/snippets/systembase-pre-locations.conf` | 路由片段（API 反代 / 静态 / SPA fallback），由 `nginx-setup.sh` 按 env 生成 |
| `/var/log/nginx/{access,error}.log` | 访问日志与错误日志 |
| `/etc/logrotate.d/nginx` | 日志轮转 |

> 本机 **没有** `sites-available` / `sites-enabled`，只用 `conf.d`（脚本两者都兼容）。

修改方式（重要）：

- **不要手改** `systembase-pre.conf` 和 `snippet` —— 每次 `deploy` 都会按 env 重新生成并覆盖。要改端口/域名/路径前缀，改 `deploy/envs/<env>.env` 的 `SITE_PORT` / `SITE_DOMAIN` / `SITE_PATH` 后重新发布。
- 唯一例外：被 certbot 改写过（含 `ssl_certificate`）的站点文件，脚本检测到会保留不覆盖。

### 7.2 HTTPS 证书

| 文件 | 说明 |
| --- | --- |
| `/etc/letsencrypt/live/beautywash.top/` | 当前证书（`fullchain.pem` / `privkey.pem`） |
| `/etc/letsencrypt/renewal/beautywash.top.conf` | 续期配置（certbot timer 自动续期） |
| `/etc/logrotate.d/certbot` | 证书日志轮转 |

新增域名证书：`./sb.sh <env> ssl <域名>`（certbot + 301 跳转 + 自动续期）。

### 7.3 应用配置

| 文件 | 说明 |
| --- | --- |
| `/opt/systembase-pre/shared/.env` | **应用运行配置的唯一线上来源**（权限 600），由发布包内的 `.env.production` 刷新，各版本目录内 `.env` 只是指向它的软链 |
| `/opt/systembase-pre/current/deploy/server/` | 随版本上传的服务器端脚本（发布 / 运维 / Nginx / SSL / 数据库） |
| `/opt/systembase-pre/current/deploy/server/ecosystem.config.js` | PM2 进程定义 |

改配置 → 改本地 `deploy/envs/<env>.env` → `./sb.sh <env> deploy`。

### 7.4 PM2

| 文件 | 说明 |
| --- | --- |
| `/etc/systemd/system/pm2-root.service` | 开机自启（`ExecStart=... pm2 resurrect`，`PM2_HOME=/root/.pm2`） |
| `/root/.pm2/dump.pm2` | 进程清单快照（`pm2 save` 写入，重启后 `resurrect` 读取） |
| `/root/.pm2/pm2.log` | PM2 守护进程日志 |
| `/opt/systembase-pre/shared/pm2/{out,error}.log` | `systembase-pre-server` 的 stdout / stderr |

### 7.5 MySQL

| 文件 | 说明 |
| --- | --- |
| `/etc/my.cnf` | 主配置（MySQL 8.0.46；`validate_password` 策略 MEDIUM） |
| `/var/lib/mysql/system_base_pre/` | 预发库数据目录 |
| `/etc/logrotate.d/mysql` | 日志轮转 |

### 7.6 防火墙与端口

- 服务器 **firewalld 未启用**（`systemctl is-active firewalld` = inactive），端口不受本机防火墙限制。
- 因此 8080 外网不通，是**云厂商安全组**未放行 TCP 8080，需去云控制台添加；443/80 已放行。

---

## 八、配置文件位置（本地仓库）

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 环境配置（唯一来源） | `deploy/envs/local.env`、`remote-<名字>.env` | 提交的是模板 `local.env.example` / `remote.env.example`（远程环境共用一份模板），实际文件 gitignore |
| 部署脚本 | `deploy.sh` / `deploy.ps1`、`sb.sh` / `sb.ps1` | 三环境统一入口 |
| 服务器端脚本 | `deploy/server/*.sh` | 发布、运维、Nginx、SSL、数据库 |
| Nginx 模板 | `deploy/server/nginx-site.conf`、`nginx-locations.conf` | 占位符由 env 填充后上传 |
| PM2 模板 | `deploy/server/ecosystem.config.js` | 应用名、日志路径 |
| 数据库 schema | `apps/server/prisma/schema.prisma` | 改模型 → `make db-migrate name=xxx` |
| 配置项定义与默认值 | `apps/server/src/core/config/env.validation.ts` | 所有环境变量的校验与默认值都在这里 |
| 运行期软链 | `apps/server/.env` → `deploy/envs/local.env` | 本地启动自动同步 |
| 前端构建 | `apps/web/vite.config.ts` | 端口、`base`（子路径部署由 `SB_BASE_PATH` 注入） |
| 工程配置 | `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`Makefile` | pnpm 9 workspace |
| 提交卡口 | `.githooks/pre-commit` | `./sb.sh setup-hooks` 启用 |
| 部署文档 | `docs/deploy.md`、`docs/paths.md` | 流程与本路径清单 |
