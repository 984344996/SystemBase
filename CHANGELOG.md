# Changelog

## 0.2.0

### 一键脚本

- **三环境统一入口**：`sb.sh` / `sb.ps1` 一套命令操作 `local`（本地开发）/ `remote-pre`（远程预发布）/ `remote-release`（远程正式），按环境分发到本地启动与远程部署
- **环境配置全部集中在 `deploy/envs/`**：`local.env`（端口 `PORT`/`WEB_PORT`、本机 `DATABASE_URL`）、`remote-pre.env` / `remote-release.env`（SSH 地址/端口/用户/密码、`DEPLOY_DIR`、`APP_NAME` + 应用全套运行配置，一个文件搞定）；example 模板已提交，实际文件 gitignore
- `start-local.sh` / `start-local.ps1`：配置源切换为 `deploy/envs/local.env`（启动时自动同步为 `apps/server/.env`，Nest 读取不变；老项目自动迁移），`WEB_PORT` 可在 env 中配置
- `deploy.sh` / `deploy.ps1`：第一个参数为环境名（如 `./deploy.sh remote-pre deploy`）；支持 `SSH_PASSWORD`（Mac/Linux 走 sshpass，密码经 `SSHPASS` 环境变量传入；Windows 仅支持免密）；同一台服务器部署多环境时 `DEPLOY_DIR` 与 `APP_NAME` 区分
- 删除 `deploy.config.json`（配置并入 env 文件）；`Makefile` 新增 `make pre` / `make release`
- `start-local.sh` / `start-local.ps1`：本地 restart / fresh / stop / status / logs；只允许操作本机库；走 migrate（与生产一致），库不存在自动创建
- `deploy.sh` / `deploy.ps1`：服务器 init / deploy / fresh / status / logs / releases / rollback / restart / start / stop / ssl / db-remote-on|off / ssh
  - 本机构建打包（约 0.5MB），服务器 `pnpm install --frozen-lockfile` 安装生产依赖，Prisma 引擎走国内镜像
  - 多版本目录 + `current` 软链：秒级回滚；健康检查失败自动回滚；切换前失败线上不受影响
  - 配置（`shared/.env`）与日志（`shared/logs`）跨版本共享；发布前本地校验生产配置
  - 兼容 Ubuntu / Debian / CentOS / OpenCloudOS / TencentOS，处理 SELinux、firewalld/ufw、Nginx default_server 冲突
- `scripts/db-baseline.js`：自动识别 0.1.x（db push）旧库并标记迁移基线，三种部署方式均已接入
- seed 独立运行时自行加载 `.env`（pnpm 下 Prisma Client 不会自动读取 apps/server/.env）
- `.gitattributes` 强制 `*.sh` 为 LF；`.gitignore` 忽略 `.env.*`、`deploy.config.json`、发布包、`.run/`

### 破坏性变更：日志只落文件，不落库

- 删除 `LoginLog` / `OperateLog` / `JobLog` 三张表及 `User`、`Job` 上的关联字段（升级步骤见 `docs/deploy.md`）
- 日志文件由「app / error / access / job 四类」合并为**每天一个** `app.YYYY-MM-DD.log`，`level` 为可读字符串（INFO/WARN/ERROR…），`category` 区分 app/access/audit/job
- `time` 改为服务器本地时间 `YYYY-MM-DD HH:mm:ss.SSS`（原为 UTC ISO）
- 移除日志清理接口与 `system:loginlog:delete`、`system:operatelog:delete` 权限点；保留期统一由 `LOG_KEEP_DAYS` 控制
- `AppLogger` 保留原有方法签名；`access()` 新增第三参数 `level`

### 新增

- 「系统日志」页：按日期/级别/分类/traceId/关键字检索，点击 traceId 查看整条链路，可下载当日原文件（`system:log:list` / `system:log:download`）
- `LogReaderService`（core）：按天流式扫描 + 倒序分页，供 monitor 与定时任务复用
- 环境变量 `LOG_LEVEL`（debug/info/warn/error）
- 审计增强：登录失败记录具体原因（账号不存在/已禁用/密码错误）、操作失败也记录（WARN）、refreshToken 重放告警、修改密码审计
- 日志核心单元测试（落盘格式、脱敏、级别过滤、清理、查询分页、路径穿越）

### 数据库迁移与部署

- 改用 Prisma Migrate：新增基线迁移 `20260901000000_init`（0.1 结构）与 `20260930000000_drop_log_tables`；容器启动执行 `migrate deploy`，不再 `db push`
- seed 移至 `src/database/seed.ts` 随构建编译，生产执行 `node dist/database/seed.js`，镜像不再依赖 ts-node
- `prisma` CLI 移入生产依赖（容器内执行迁移需要）
- 修复后端镜像无法启动：运行阶段 `pnpm deploy` 目录错误、Prisma Client 未重新生成、构建产物实际位于 `dist/apps/server/src/main.js`（新增 `tsconfig.build.json`，产物回到 `dist/main.js`）
- 镜像：锁定 lockfile（`--frozen-lockfile`）、非 root 运行、补 openssl/tzdata；根 `package.json` 用 `packageManager` 锁定 pnpm 9
- CI：新增迁移与 schema 一致性校验、`prisma validate`

### 安全

- helmet 安全响应头（CSP 收紧、nosniff、禁止嵌入、生产 HSTS），去掉 `X-Powered-By`
- 请求体上限 `BODY_LIMIT`（默认 1mb），超限/非法 JSON 返回统一结构并记 WARN 日志
- nginx：前端页面安全头、`index.html` 不缓存、`client_max_body_size` 调整为 10m

### 性能

- `PermissionCacheService`：登录用户角色/权限进程内缓存（`PERMISSION_CACHE_TTL`，默认 30s），用户/角色/菜单变更主动失效，版本号防并发写回旧数据

### 前端

- 403 页 + 路由级权限（`meta.permission`）
- 请求错误分级提示：断网/超时/5xx 为 error 并附追踪码，403/429/4xx 为 warning；1.5s 去重；支持 `silent`
- 每个请求携带前端生成的 `X-Trace-Id`，拿不到响应也能按追踪码查日志
- 路由切换顶部进度条；发版后旧 chunk 加载失败自动刷新
- 修复登录页用户名/密码错误时无任何提示

### 测试

- 新增 AuthService（登录成败原因审计、token 轮换、重放检测、各类拒绝）、JobService（成功/失败/超时不释放锁/抢锁失败/日志查询）、PermissionCacheService 服务级测试；共 31 个用例

### 优化

- 日志改为主线程 SonicBoom 异步写 + 单 logger 多 child，替代原 3 个 pino worker 线程
- 移除不再使用的 `pino-roll` / `pino-http` / `pino-pretty`
- 访问日志按状态码分级（5xx→ERROR / 4xx→WARN），并跳过 `/api/health` 探活噪音
- 日志写入异常（磁盘满/目录被删）不再导致进程崩溃，自动重建文件
- 修复 jest 缺少 `reflect-metadata` 导致装饰器用例必挂

## 0.1.0

初始框架版本：pnpm monorepo（NestJS + Prisma + MySQL ｜ Vue3 + TS + Element Plus）。

### 框架能力

- 认证：JWT accessToken(2h) + refreshToken(7d) 一次性轮换，前端 401 单飞静默续期
- RBAC：用户-角色-菜单/按钮权限码，接口级 `@RequirePermissions`，前端 `v-permission` 指令
- 动态定时任务：cron 存库 + 代码注册 handler，管理页增删改即时生效，分布式锁防重
- 日志：pino 按天滚动（app/error/access/job），traceId 全链路，敏感字段脱敏
- 审计：操作日志（`@OperateLog` 采集，参数脱敏）+ 登录日志，可按条件查询并按保留天数清理
- 统一规范：统一响应、全局异常、DTO 强校验、分页基座
- 个人中心：自助修改姓名/手机/邮箱，修改密码后全端下线
- 部署：Docker Compose（mysql + 可选 redis + server + web），数据库锁/Redis 锁可切换

### 目录约定

- `apps/server/src/core/` 框架层，禁止依赖 `modules/`
- `apps/server/src/modules/` 系统模块（auth / user / role / menu / job / monitor），均可按业务需要裁剪
- `apps/server/src/modules/example/` 示例模块，新项目整目录删除
