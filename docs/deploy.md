# 部署指南

| 方式 | 适用 | 入口 |
|---|---|---|
| 本地一键启动 | 开发 | `./sb.sh local` / `sb.ps1 local` |
| **服务器一键部署（推荐）** | 单台云服务器，PM2 + Nginx，秒级回滚 | `./sb.sh remote-pre ...` / `./sb.sh remote-release ...` |

> 统一入口 `sb.sh`（Mac/Linux）/ `sb.ps1`（Windows）按环境分发：`local` 走本地启动，`remote-<名字>` 走远程部署。
> 想看「发了哪条命令 → 调用哪个脚本 → 服务器做了什么」的完整调用链与流程图，见 [flow.md](./flow.md)。
> 环境配置全部在 `deploy/envs/*.env`（模板 `remote.env.example`、`local.env.example` 已提交，实际文件 gitignore）。
> 脚本若提示无执行权限，先执行一次 `chmod +x sb.sh`，或用 `bash sb.sh ...` 调用。

## 环境配置（deploy/envs/）

| 环境 | 文件 | 说明 |
|---|---|---|
| 本地开发 | `deploy/envs/local.env` | `PORT` 后端端口、`WEB_PORT` 前端端口、`DATABASE_URL` 本机库等；启动时自动同步为 `apps/server/.env`（Nest 读取），只编辑前者 |
| 预发布 | `deploy/envs/remote-pre.env` | 分两段：部署段（`SSH_HOST`/`SSH_PORT`/`SSH_USER`/`SSH_PASSWORD`/`DEPLOY_DIR`/`APP_NAME` 等，不上传）+ 应用段（发布时上传为服务器 `.env`） |
| 正式 | `deploy/envs/remote-release.env` | 同上，指向正式服务器 |

> 所有远程环境共用一份模板 `deploy/envs/remote.env.example`：**新增环境**复制同一份为 `deploy/envs/remote-<名字>.env` 后填写即可
> （环境名只能小写字母、数字、连字符；脚本按文件名识别环境，`./sb.sh remote-<名字> deploy` 直接用，无需改脚本）。

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
cp deploy/envs/remote.env.example deploy/envs/remote-pre.env   # 填 SSH_HOST、DATABASE_URL 密码、JWT_SECRET、CORS_ORIGINS
# 2. SSH 免密（推荐；Windows 可用: type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@IP "cat >> ~/.ssh/authorized_keys"）
ssh-keygen -t ed25519            # 已有密钥可跳过
ssh-copy-id root@服务器IP
# 3. 初始化服务器 + 首次发布
./sb.sh remote-pre init
```

`init` 会：安装 Node 20 / pnpm 9 / PM2 / Nginx /（库在本机时）MySQL 8 → 按 `DATABASE_URL` 建库建账号 → 生成 Nginx 站点 → 放行防火墙 80/443 → PM2 开机自启 → 执行一次发布。可重复执行。
MySQL root 免密不可用时：在 env 部署段填 `DB_ROOT_PASS`（或临时 `DB_ROOT_PASS='root密码' ./sb.sh remote-pre init`）。

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
| `./sb.sh remote-pre db-backup [备注]` | 备份服务器数据库：服务器端 mysqldump → 拉回本地 `backup/remote-pre/`（服务器保留 7 天，可用 `KEEP_BACKUP_DAYS` 调整） |
| `./sb.sh remote-pre db-restore <文件>` | 用本地备份文件恢复服务器数据库（**需输入库名确认**，服务器恢复前会自动先备份当前库） |
| `./sb.sh remote-pre doctor` | 环境体检：版本/构建信息、PM2/Nginx/MySQL、健康检查、磁盘、今日 ERROR/WARN、最近备份，并比对**本地 env 与服务器 `shared/.env` 的配置差异** |
| `./sb.sh remote-pre fresh` | **清空远程数据库**后重新发布（需输入库名确认；清库前自动备份到服务器 `shared/backup`） |
| `./sb.sh remote-pre ssh` | 登录服务器 |

### 数据库备份与恢复

```bash
./sb.sh remote-release db-backup 发版前      # 备份 → backup/remote-release/xxx.sql.gz
ls backup/remote-release                      # 或在本地用 ./sb.sh local db-list 看本地备份
./sb.sh remote-release db-restore backup/remote-release/system_base_20261003120000.sql.gz
```

- 备份在**服务器**执行（`mysqldump --single-transaction`，不锁表），完成后 `scp` 回本地；服务器 `shared/backup` 同时保留一份并按 7 天滚动清理
- 恢复是危险操作：必须输入**数据库名**确认；服务器脚本在恢复前会自动对当前库做一次备份（文件名带 `auto-before-restore`）
- 本地开发库同样可备份：`./sb.sh local db-backup [备注]` / `./sb.sh local db-restore <文件>` / `./sb.sh local db-list`
- `backup/` 目录已被 gitignore（含业务数据，勿提交）

### 环境体检（doctor）

`./sb.sh <环境> doctor` 除常规巡检外，会把**本地 `deploy/envs/<环境>.env` 的应用段**与服务器 `shared/.env` 逐键比对（不打印值），提示：

- `值不同`：本地改过但没发布 → 重新 `deploy`
- `仅本地有（未发布）`：新增的配置项 → 重新 `deploy`
- `仅服务器有`：服务器上手工加过 → 确认是否需要写回本地 env

### 提交前卡口（可选）

```bash
./sb.sh setup-hooks     # 一次性：把 .githooks 设为 git hooks 目录
```

之后每次 `git commit` 会自动跑 `pnpm lint`（类型检查 + `prisma validate`）与 `pnpm test`，失败则提交终止。临时跳过：`SKIP_HOOKS=1 git commit ...`。不引入 husky 等依赖。

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

## 方式三：手动部署（不用脚本时）

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
| 生产 | 服务器部署脚本自动执行 `prisma migrate deploy`；手动部署执行 `pnpm prisma:deploy` |
| 原型阶段随便改（不留迁移） | `make db-push`，**禁止用于共享库/生产库** |

约定：

- 迁移生成后检查 SQL（尤其是 `DROP` / 改列类型），与代码一起提交
- 已发布的迁移文件**不要修改**，需要调整就再加一个迁移
- 提交前可自查「迁移文件」与 `schema.prisma` 是否一致（忘记生成迁移会导致服务器 `migrate deploy` 后表结构与代码不符）：`cd apps/server && pnpm exec prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url mysql://root:root@127.0.0.1:3306/shadow --exit-code`

## 备份与恢复

推荐用脚本（详见上文「数据库备份与恢复」）：`./sb.sh <环境> db-backup [备注]` / `db-restore <文件>` / `db-list`，本地库同样支持（`./sb.sh local db-backup`）。

手动方式（可直接配成框架里的定时任务）：

```bash
# 备份
mysqldump -uroot -p --single-transaction system_base > backup-$(date +%F).sql
# 恢复
mysql -uroot -p system_base < backup-2026-09-30.sql
```

## 日志位置与排障

日志只落文件（每天一个 `app.YYYY-MM-DD.log`），跨版本切换不丢：服务器部署在 `shared/logs/`。

```bash
./deploy.sh logs ERROR                    # 今天的错误
./deploy.sh logs WARN 2026-09-29          # 指定日期的警告
./deploy.sh ssh  →  grep 3f2a8b1c /opt/systembase/shared/logs/app.2026-09-30.log   # 按 traceId 串全链路
```

前端的错误提示里带「追踪码」（traceId 前 12 位），直接拿去 grep 即可；断网/超时的请求也有追踪码（前端生成随请求发出）。
也可在管理端「系统管理 → 系统日志」按日期/级别/分类/traceId 检索或下载原文件。字段与级别约定见 [architecture.md](./architecture.md#日志体系只落文件不落库)。

## 通用模块配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `UPLOAD_DIR` | uploads | 文件实体目录（服务器部署建议放 `shared/uploads`，跨版本保留） |
| `UPLOAD_MAX_SIZE` | 10485760（10MB） | 单个文件字节上限；同步调大 nginx `client_max_body_size` |
| `UPLOAD_ALLOWED_MIME` | 图片/pdf/文本/zip | 逗号分隔；`*` 表示不限制（仍拦截 `.sh/.exe/.bat/.php/.jsp/.js` 等可执行扩展名） |
| `LOG_ALERT_THRESHOLD` | 50 | 日志告警 ERROR 阈值（`system.logAlert` 任务用） |
| `LOG_ALERT_WEBHOOK` | 空 | 告警推送地址（企业微信/钉钉/自建钩子），留空只写日志 |
| `METRICS_ENABLED` | off | `/api/metrics` 开关 |
| `CLIENT_LOG_ENABLED` | on | 前端日志上报开关（off 时接口仍返回 204，但不落盘） |
| `SWAGGER_ENABLED` | 生产 off / 其他 on | `/api/docs` 开关 |

## 同一台机器部署多个环境（预发 + 正式）

可以，但**下面这些在每个环境的 env 里必须互不相同**，否则会互相打架：

| 配置项 | 预发示例 | 正式示例 | 冲突后果 |
|---|---|---|---|
| `PORT`（后端监听） | 3001 | 3000 | 端口被占用，第二个应用起不来 |
| `SITE_PORT`（Nginx 监听） | 8080 | 80 | 两个站点抢占同一端口 |
| `SITE_DOMAIN`（server_name） | `pre.example.com` | `www.example.com` | 都是 `_` 时 Nginx 报 `conflicting server name`，**后装的站点被忽略** |
| `DEPLOY_DIR` | `/opt/systembase-pre` | `/opt/systembase` | 版本目录混在一起 |
| `APP_NAME`（PM2 + 站点名） | `systembase-pre` | `systembase` | PM2 应用与 Nginx 站点配置互相覆盖 |
| `DATABASE_URL` 库名 | `system_base_pre` | `system_base` | 预发操作清到正式数据 |

其他已自动隔离：PM2 应用名、Nginx 站点文件（`/etc/nginx/conf.d/<APP_NAME>.conf`）、日志与备份目录（各自 `shared/`）。

**强烈建议用域名区分而不是只靠端口**：给预发配 `SITE_DOMAIN="pre.example.com"`，正式配 `SITE_DOMAIN="www.example.com"`，两者都用 80/443，Nginx 按 `server_name` 分流，访问地址更自然，也方便分别配 HTTPS。

补充两点：

- `UPLOAD_DIR` 默认是相对路径 `uploads`（相对运行目录），切换版本后文件会“丢”（旧 release 目录里）。多环境或长期运行请在 env 里显式设为绝对路径，如 `UPLOAD_DIR=/opt/systembase-pre/shared/uploads`
- `./sb.sh <env> stop` 现在只摘掉**本环境**的 Nginx 站点配置并停本环境 PM2 应用，**不会** `systemctl stop nginx`（否则会把同机其他环境一起停掉）

## 前端（浏览器）日志

前端异常也会落盘，但**与后端日志分成两个文件**：

| 文件 | 内容 | 视角 |
|---|---|---|
| `app.YYYY-MM-DD.log` | 后端日志（app / access / audit / job） | 服务器视角 |
| `web.YYYY-MM-DD.log` | 前端上报（category=client） | 客户端视角 |

**为什么分开**：前端错误会被每个浏览器各报一次（同一个 bug，100 个用户 = 100 条），混进后端日志会淹没真正的后端 ERROR，也会让日志告警统计失真。分开后靠 **traceId 串联**——前端报错时带上最近一次请求的 `X-Trace-Id`，两个文件 grep 同一个 ID 就能拼出完整链路。

采集范围（`apps/web/src/utils/clientLog.ts`）：

- `window.onerror`（含 img/script 资源加载失败）、`unhandledrejection`、Vue 组件渲染错误（`app.config.errorHandler`）
- 业务代码可主动上报：`reportClientLog({ msg, level, stack })`
- **只报 error / warn**，同类错误 60 秒内去重，每分钟最多 10 条，上报失败静默（不影响用户操作）
- 上报接口 `POST /api/logs/client`：公开（登录页也能报）+ 限流 30 条/分钟/IP；URL 只保留 origin+pathname（query 里的 token 不落盘），内容超长自动截断

查看：管理端「系统管理 → 系统日志」顶部可切换 **后端日志 / 前端日志**，前端日志展示页面 URL、UA、堆栈，同样支持按 traceId 检索与下载原文件（权限复用 `system:log:list` / `system:log:download`）。

## 可观测性

| 端点 | 用途 |
|---|---|
| `GET /api/health` | 综合健康（数据库），脚本与外部探活用；故障返回 **503** |
| `GET /api/health/live` | 存活探针：进程级，恒 200（判断是否该重启） |
| `GET /api/health/ready` | 就绪探针：数据库 + Redis（仅 `LOCK_DRIVER=redis` 时）+ 日志目录可写，不可服务时 503（判断是否该接流量） |
| `GET /api/metrics` | Prometheus 文本指标，`METRICS_ENABLED=on` 才启用（默认关闭） |

- 指标内容（零依赖，进程内累计）：`sb_http_requests_total`（方法/路由模板/状态码）、`sb_http_request_duration_ms_sum|max`、`sb_job_runs_total`（任务处理器/成功失败）、进程内存与 CPU、运行时间、构建信息
- 指标会暴露路由与流量信息，请只在内网暴露或由 nginx 加鉴权

**日志告警**：内置任务处理器 `system.logAlert`（默认不创建任务，需要时在「定时任务」页新增并启用）

- 扫描当日 ERROR 条数，超过阈值写 WARN 告警（可在系统日志检索到），并可选推送 webhook
- 参数：`{"threshold": 20}`；环境变量 `LOG_ALERT_THRESHOLD`（默认 50）、`LOG_ALERT_WEBHOOK`（企业微信/钉钉/自建钩子，留空不推送）

**多实例权限一致性**：`LOCK_DRIVER=redis` 时，用户/角色/菜单变更会通过 Redis pub/sub 广播失效事件，其他实例立即丢弃缓存（无需等 `PERMISSION_CACHE_TTL`）；Redis 不可用时自动退化为「仅本实例失效」。

## 安全配置（可选，默认宽松）

在 `deploy/envs/<环境>.env` 中配置，改动后**重新发布**才生效（远程环境配置改动可被 `doctor` 检出）。默认策略刻意宽松，避免升级后把管理员锁死。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PASSWORD_MIN_LENGTH` | 8 | 密码最小长度 |
| `PASSWORD_COMPLEXITY` | on | 是否要求大小写/数字组合（off 关闭） |
| `PASSWORD_EXPIRE_DAYS` | 0 | 密码有效期天数，0 = 不过期；过期后登录返回 `passwordExpired`，前端提示尽快修改（不阻断） |
| `LOGIN_FAIL_LOCK_COUNT` | 5 | 连续登录失败几次后锁定（0 = 不锁定），按「用户名 + IP」计数 |
| `LOGIN_FAIL_LOCK_MINUTES` | 10 | 锁定时长（分钟） |
| `LOGIN_FAIL_WINDOW_MIN` | 30 | 失败计数窗口（分钟，超时重新计数） |
| `LOGIN_CAPTCHA` | off | `off` / `auto`（失败多次后要求）/ `on`（总是要求）。`on|auto` 需服务端装有 `svg-captcha`（已加入 server 依赖）；未安装时自动降级并告警一次 |
| `IP_WHITELIST` / `IP_BLACKLIST` | 空 | 逗号分隔，支持 `192.168.*` 前缀通配；黑名单优先。配了白名单则仅名单内可访问（含 `/api/health`，监控机记得加） |

行为说明：

- **强制改密**：管理员重置某人密码后，该账号 `mustChangePassword=true` → 登录后返回该标志，前端跳 `/change-password` 全屏改密页，路由守卫拦截其他页面；改密成功后自动解除
- **密码策略共用**：管理员重置与用户自助改密走同一套校验（长度/复杂度/弱密码字典/不得包含用户名/不得与旧密码相同），失败信息直接展示给用户
- **多实例**：失败计数与验证码存进程内，多实例部署时各实例独立计数；需要严格一致请用 Redis（后续按 `LOCK_DRIVER` 扩展）
- 本地开发建议把 `THROTTLE_LOGIN_LIMIT` 放宽（模板默认 20），避免频繁登录调试被限流

## 上线检查清单

- [ ] JWT_SECRET 已替换为 16+ 位随机串（缺失启动直接失败）
- [ ] CORS_ORIGINS 已配置真实域名白名单（生产缺失启动失败）
- [ ] admin 默认密码已修改
- [ ] MySQL root 密码已替换
- [ ] HTTPS（`./sb.sh <环境> ssl 域名` 一键配置 Let's Encrypt；生产环境后端会发送 HSTS 头）
- [ ] `BODY_LIMIT` 与 nginx `client_max_body_size` 按业务需要调整（默认 1mb / 10m）
- [ ] 多实例部署：`LOCK_DRIVER=redis`；如要求权限变更秒级生效，调小 `PERMISSION_CACHE_TTL`
- [ ] 数据库定时备份任务已配置

## 多实例（横向扩展）前置条件

默认按单机设计；要多实例负载均衡前，先逐项确认以下状态的实际归属：

| 状态 | 默认实现 | 多实例下的行为 | 要求 |
|---|---|---|---|
| 分布式锁（任务防重跑） | `LOCK_DRIVER=db`（数据库） | 各实例共同竞争 DB 行锁，语义正确但性能一般 | 设 `LOCK_DRIVER=redis`（Redis 不可用自动降级 db） |
| 权限缓存失效广播 | 关闭 | 其他实例最多延迟 `PERMISSION_CACHE_TTL`（默认 30s）感知权限变更 | `LOCK_DRIVER=redis` 时自动启用 pub/sub 广播，秒级生效 |
| **全局限流** | **进程内存计数** | **每台实例各算各的，实际额度 = limit × 实例数** | 需要精确限流时上网关层（Nginx limit_req / 云 WAF）统一计数 |
| **登录失败锁定** | **进程内存计数** | 攻击者轮换实例可绕过锁定阈值 | 同上，或接受宽松阈值 |
| 文件存储 | 服务器本地磁盘（`UPLOAD_DIR`） | 各实例文件不互通，上传后另一实例 404 | 共享存储（NFS）或改造 `FileService` 接 OSS/S3 |
| 日志 | 本机按天文件 | 「登录服务器 tail 文件」失效，需逐台看 | 接集中式日志（Loki/云日志），或容忍多台查看 |
| 定时任务 | 数据库注册 + 分布式锁防重 | 多实例安全（同任务同一时刻只有一个实例执行）；任务增删改由各实例每 `JOB_RECONCILE_SECONDS`（默认 60）秒从库对账同步，执行前也以库里状态为准 | 无需改动 |
| 前端日志上报 | 单日字节预算 `CLIENT_LOG_DAILY_MAX_BYTES`（默认 50MB）| 每个实例各自计算预算 | 按实例数折算 |

简言之：**限流与登录锁定是明确的单机假设**，网关统一限流是唯一完整解；文件与日志取决于是否共享存储。

> `TRUST_PROXY` 默认 `false`（不信任代理头）。经 Nginx 反代时必须配置 `TRUST_PROXY=1`，否则 IP 白名单、限流、审计记录的都是 Nginx 的 IP。
