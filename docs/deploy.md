# 部署指南

| 方式 | 适用 | 入口 |
|---|---|---|
| 本地一键启动 | 开发 | `./sb.sh local` / `sb.ps1 local` |
| **服务器一键部署（推荐）** | 单台云服务器，PM2 + Nginx，秒级回滚 | `./sb.sh remote-pre ...` / `./sb.sh remote-release ...` |
| Docker Compose | 已有 Docker 环境 | `make up` |

> 统一入口 `sb.sh`（Mac/Linux）/ `sb.ps1`（Windows）按环境分发：`local` 走本地启动，`remote-pre` / `remote-release` 走远程部署。
> 环境配置全部在 `deploy/envs/*.env`（模板 `*.env.example` 已提交，实际文件 gitignore）。
> 脚本若提示无执行权限，先执行一次 `chmod +x sb.sh`，或用 `bash sb.sh ...` 调用。

## 环境配置（deploy/envs/）

| 环境 | 文件 | 说明 |
|---|---|---|
| 本地开发 | `deploy/envs/local.env` | `PORT` 后端端口、`WEB_PORT` 前端端口、`DATABASE_URL` 本机库等；启动时自动同步为 `apps/server/.env`（Nest 读取），只编辑前者 |
| 预发布 | `deploy/envs/remote-pre.env` | 分两段：部署段（`SSH_HOST`/`SSH_PORT`/`SSH_USER`/`SSH_PASSWORD`/`DEPLOY_DIR`/`APP_NAME` 等，不上传）+ 应用段（发布时上传为服务器 `.env`） |
| 正式 | `deploy/envs/remote-release.env` | 同上，指向正式服务器 |

- `SSH_PASSWORD` 留空 = 走 SSH 免密（推荐 `ssh-copy-id`）；填写则用 sshpass（需本机安装：macOS `brew install sshpass` / Ubuntu `apt install sshpass`；**Windows 仅支持免密**）
- 同一台服务器部署预发 + 正式两个环境时，`DEPLOY_DIR` 与 `APP_NAME` 必须都不同（如 `/opt/systembase-pre` + `systembase-pre`）

## 方式一：本地一键启动

前置：Node ≥ 20.10、本机 MySQL 8 已启动、`corepack enable`（按 `packageManager` 自动使用 pnpm 9）。

```bash
cp deploy/envs/local.env.example deploy/envs/local.env    # 首次：确认 DATABASE_URL 账号密码（库不存在会自动创建）
./sb.sh local start                                       # Windows: powershell -ExecutionPolicy Bypass -File sb.ps1 local start
```

| 命令 | 作用 |
|---|---|
| `./sb.sh local start`（默认） | 装依赖（lockfile 变化时）→ 构建 shared → 迁移 → 补齐种子数据 → 后台启动前后端 → 等待就绪 |
| `./sb.sh local fresh` | 清空本地库（`prisma migrate reset`）→ 全部迁移 → 种子数据 → 启动（需输入 yes） |
| `./sb.sh local stop` / `status` / `logs` | 停止 / 状态（端口、MySQL、健康检查）/ 跟踪进程输出 |

- 只允许操作本机数据库（`DATABASE_URL` 主机为 localhost / 127.0.0.1），防止误清远程库
- 进程输出在 `.run/server.log`、`.run/web.log`；应用日志仍在 `apps/server/logs/app.YYYY-MM-DD.log`
- 手动方式仍可用：`make db-deploy && make db-seed && make dev`
- 前端端口被占用时临时换端口：`SB_WEB_PORT=5174 ./sb.sh local start`（长期改 `local.env` 的 `WEB_PORT`）

## 方式二：服务器一键部署（PM2 + Nginx，推荐）

本机构建、打包上传，服务器按 lockfile 安装生产依赖 → 迁移 → 切换版本 → 重启 → 健康检查，**失败自动回滚**。
支持 Ubuntu / Debian / CentOS / OpenCloudOS / TencentOS；Mac/Linux 用 `sb.sh`，Windows 用 `sb.ps1`（命令一致）。
下面以预发布环境 `remote-pre` 为例（正式环境把 `remote-pre` 换成 `remote-release` 即可）。

### 首次部署

```bash
# 1. 环境配置（已被 gitignore；含 SSH 与应用配置，一个文件搞定）
cp deploy/envs/remote-pre.env.example deploy/envs/remote-pre.env   # 填 SSH_HOST、DATABASE_URL 密码、JWT_SECRET、CORS_ORIGINS
# 2. SSH 免密（推荐；Windows 可用: type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP "cat >> ~/.ssh/authorized_keys"）
ssh-keygen -t ed25519            # 已有密钥可跳过
ssh-copy-id root@服务器IP
# 3. 初始化服务器 + 首次发布
./sb.sh remote-pre init
```

`init` 会：安装 Node 20 / pnpm 9 / PM2 / Nginx /（库在本机时）MySQL 8 → 按 `DATABASE_URL` 建库建账号 → 生成 Nginx 站点 → 放行防火墙 80/443 → PM2 开机自启 → 执行一次发布。可重复执行。
MySQL root 免密不可用时：`DB_ROOT_PASS='root密码' ./sb.sh remote-pre init`。

### 日常命令

| 命令 | 作用 |
|---|---|
| `./sb.sh remote-pre deploy` | 发布：单测 → 构建 → 打包（约 0.5MB）→ 上传 → 服务器安装依赖/迁移/seed/切换/重启/健康检查 |
| `./sb.sh remote-pre status` | 当前版本、PM2 状态、Nginx/MySQL、健康检查、今日 ERROR/WARN 数、磁盘 |
| `./sb.sh remote-pre logs` | 今日应用日志最近 100 行；`logs ERROR`、`logs WARN 2026-09-29`、`logs follow`、`logs pm2`（启动失败/崩溃输出） |
| `./sb.sh remote-pre releases` / `rollback [版本号]` | 版本列表 / 回滚到上一版本（或指定版本），秒级完成，数据库不回退 |
| `./sb.sh remote-pre restart` / `start` / `stop` | 重启后端 / 启动（含 Nginx）/ 停止（含 Nginx，页面下线） |
| `./sb.sh remote-pre ssl 域名` | Let's Encrypt 证书 + 301 跳转 + 自动续期；完成后把 `CORS_ORIGINS` 改为 `https://域名` 再发布 |
| `./sb.sh remote-pre db-remote-on [IP]` / `db-remote-off` | 临时开放 / 关闭数据库远程访问（排查用，用完关闭；拒绝对 root 开放） |
| `./sb.sh remote-pre fresh` | **清空远程数据库**后重新发布（需输入库名确认） |
| `./sb.sh remote-pre ssh` | 登录服务器 |

可选：`SKIP_TESTS=1 ./sb.sh remote-pre deploy` 跳过单测（Windows：`.\sb.ps1 -SkipTests remote-pre deploy`）。

### 服务器目录结构

```
/opt/systembase/                   env 文件里的 DEPLOY_DIR
├── current -> releases/20260930120000     Nginx 与 PM2 都指向这里，切换版本 = 改软链
├── releases/
│   ├── 20260930120000/            每次发布一个目录（含 RELEASE：环境/构建时间/机器/commit）
│   └── 20260929180000/            保留最近 KEEP_RELEASES 个（默认 5），用于回滚
├── releases.log                   发布 / 回滚记录
└── shared/                        跨版本共享
    ├── .env                       生产配置（每次发布用 env 文件的应用段覆盖，权限 600）
    ├── logs/app.YYYY-MM-DD.log    应用日志（各版本 apps/server/logs 软链到这里）
    └── pm2/out.log, error.log     PM2 捕获的进程输出（启动失败、崩溃）
```

### 发布流程与失败处理

| 阶段 | 失败时 |
|---|---|
| 本地校验配置 / 单测 / 构建 | 不上传，线上无影响 |
| 服务器解压、安装依赖、迁移、seed | 删除半成品目录，**线上版本不变** |
| 切换软链 + PM2 重启 → 60s 内 `/api/health` 未通过 | **自动切回上一版本**并重启；失败版本改名 `.failed` 保留现场 |

注意：迁移在切换前执行，自动回滚**不会回退数据库**。改表时遵循「先加后删」（新版本先兼容旧结构，下个版本再删旧列），保证回滚后旧代码仍可运行。

### 与参考实现的差异

- 迁移走 `prisma migrate deploy`（不是 `db push`），常规发布不会静默删列
- 多版本目录 + 软链：回滚不需要重新构建上传
- seed 为编译产物（`dist/database/seed.js`），服务器不装 ts-node；每次发布都执行（幂等，自动补齐新增的菜单与权限点）
- 服务器依赖用 `pnpm install --frozen-lockfile`，版本与本地完全一致；Prisma 引擎走国内镜像

## 方式三：Docker Compose

```bash
cd deploy
cat > .env <<'EOF'
JWT_SECRET=请替换为至少16位随机串
MYSQL_ROOT_PASSWORD=请替换数据库密码
CORS_ORIGINS=http://你的域名:8080
WEB_PORT=8080
LOCK_DRIVER=db           # 需要多实例/Redis 锁时改为 redis 并用 make up-redis
EOF
docker compose up -d --build     # server 启动时自动执行 prisma migrate deploy

# 初始化种子数据（首次；幂等，可重复执行）
docker compose exec server node dist/database/seed.js
```

访问 `http://服务器IP:8080`（admin / admin123，**上线后立即改密码**）。

服务组成：

| 容器 | 说明 |
|---|---|
| sb-mysql | 数据卷持久化 `sb-mysql-data` |
| sb-redis | 分布式锁用（LOCK_DRIVER=db 时不启动）|
| sb-server | 多阶段构建、仅生产依赖、非 root 运行；启动前 `prisma migrate deploy`，迁移失败则不启动；healthcheck `/api/health` |
| sb-web | nginx:alpine 托管前端静态资源 + `/api` 反代 + history fallback + 安全响应头 |

### 升级

```bash
git pull
cd deploy && docker compose up -d --build    # 新迁移在 server 启动时自动执行
```

### 回滚

迁移只向前执行。回滚代码前确认目标版本的 schema 与当前库兼容；不兼容时先从备份恢复数据库：

```bash
git checkout <上一个发布tag>
docker compose up -d --build
```

### 手动部署（不用脚本时）

```bash
pnpm build                                     # 产物：apps/web/dist、apps/server/dist
cd apps/server
pnpm prisma:deploy && node dist/database/seed.js
NODE_ENV=production node dist/main.js          # 用 pm2/systemd 守护
# nginx 配置参考 deploy/server/nginx-site.conf（替换 __APP_DIR__ / __PORT__）
```

## 数据库迁移

**所有环境统一走 Prisma Migrate**：迁移文件在 `apps/server/prisma/migrations/`，随代码评审、可审计。

| 场景 | 命令 |
|---|---|
| 修改 `schema.prisma` 后生成迁移（开发） | `make db-migrate name=add_booking` |
| 拉取代码后同步本地库 | `make db-deploy` |
| 生产 | 容器启动自动执行 `prisma migrate deploy`；独立部署手动执行 `pnpm prisma:deploy` |
| 原型阶段随便改（不留迁移） | `make db-push`，**禁止用于共享库/生产库** |

约定：

- 迁移生成后检查 SQL（尤其是 `DROP` / 改列类型），与代码一起提交
- 已发布的迁移文件**不要修改**，需要调整就再加一个迁移
- 提交前可自查「迁移文件」与 `schema.prisma` 是否一致（忘记生成迁移会导致服务器 `migrate deploy` 后表结构与代码不符）：`cd apps/server && pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url mysql://root:root@127.0.0.1:3306/shadow --exit-code`

## 备份与恢复

```bash
# 备份（可直接配成框架里的定时任务）
docker exec sb-mysql mysqldump -uroot -p$MYSQL_ROOT_PASSWORD system_base > backup-$(date +%F).sql
# 恢复
docker exec -i sb-mysql mysql -uroot -p$MYSQL_ROOT_PASSWORD system_base < backup-2026-09-30.sql
```

## 日志位置与排障

日志只落文件（每天一个 `app.YYYY-MM-DD.log`），跨版本 / 容器重建都不丢：
服务器部署在 `shared/logs/`，Docker 部署在命名卷 `sb-logs:/app/logs`。

```bash
# 服务器部署：本机直接查
./deploy.sh logs ERROR                    # 今天的错误
./deploy.sh logs WARN 2026-09-29          # 指定日期的警告
./deploy.sh ssh  →  grep 3f2a8b1c /opt/systembase/shared/logs/app.2026-09-30.log   # 按 traceId 串全链路

# Docker 部署
docker exec sb-server ls -lh /app/logs
# app.2026-09-29.log  app.2026-09-30.log

docker exec sb-server grep '"level":"ERROR"' /app/logs/app.2026-09-30.log   # 当天错误
docker exec sb-server grep 3f2a8b1c /app/logs/app.2026-09-30.log            # 按报障 traceId 串起全链路
docker cp sb-server:/app/logs ./logs-backup                                  # 拷出分析
```

前端的错误提示里带「追踪码」（traceId 前 12 位），直接拿去 grep 即可；断网/超时的请求也有追踪码（前端生成随请求发出）。
也可在管理端「系统管理 → 系统日志」按日期/级别/分类/traceId 检索或下载原文件。字段与级别约定见 [architecture.md](./architecture.md#日志体系只落文件不落库)。

## 上线检查清单

- [ ] JWT_SECRET 已替换为 16+ 位随机串（缺失启动直接失败）
- [ ] CORS_ORIGINS 已配置真实域名白名单（生产缺失启动失败）
- [ ] admin 默认密码已修改
- [ ] MySQL root 密码已替换
- [ ] HTTPS（建议在 nginx/compose 前再挂一层带证书的反代；生产环境后端会发送 HSTS 头）
- [ ] `BODY_LIMIT` 与 nginx `client_max_body_size` 按业务需要调整（默认 1mb / 10m）
- [ ] 多实例部署：`LOCK_DRIVER=redis`；如要求权限变更秒级生效，调小 `PERMISSION_CACHE_TTL`
- [ ] 数据库定时备份任务已配置
