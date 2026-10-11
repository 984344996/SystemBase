# Changelog

## Unreleased

- 重构（框架层）：新增 `core/prisma/prisma-error.util.ts`（`withUniqueViolation`），「预检 + P2002 竞态兜底」统一覆盖 user/role/dict/config/job 五个模块（原先 user 抽了私有方法、role 内联复制、其余三个没有兜底，行为不一致）
- 重构（框架层）：`buildTree` 泛型工具收敛到 `@sb/shared`（原先 auth/menu 两处逐字重复且用 any）；吊销用户全部 refreshToken 提炼为 `revokeAllRefreshTokens`（原先 6 处逐字重复）
- 修复：`ConfigService` 的进程内缓存从未生效（`get()` 直查库，缓存字段与 `invalidate` 全部是死代码）；现在真正走 60s TTL 缓存，写操作即时失效
- 新增：文件下载接口输出 `ETag`（原本 `FileService.etagOf` 是死代码），支持客户端缓存协商
- 重构（前端框架层）：新增 `usePagedList` composable + `TablePager` / `StatusTag` 组件，列表页「分页 + 查询 + 状态列」统一接入（用户/角色/文件/公告/三类日志/任务抽屉）；顺带修复「第 N 页改关键字点查询拿到空页」的隐性分页 bug（查询统一先回第 1 页）
- 一致性（前端）：按钮权限统一用 `v-permission` 指令（原 store 式与指令式混用）；时间格式化统一 `formatTime`（原内联 replace/slice 散落 5 处）；`formatSize` 双份实现收敛到 `utils/datetime`；`.muted`/`.mini`/`.pager` 样式上移全局；`api/system.ts` 的 create/update 参数从 `Record<string, unknown>` 收严为具体类型并新增 `DeleteResult`
- 清理：删除 `ConfigEntry` 死类型、auth store 冗余 `reset` action、permission 指令多余默认导出；controller 注入名统一为 `service`
- 调整：远程环境模板合并为一份 `deploy/envs/remote.env.example`（删除 `remote-pre.env.example` / `remote-release.env.example`）；新增环境只需 `cp deploy/envs/remote.env.example deploy/envs/remote-<名字>.env` 后填写，脚本按文件名自动识别，无需改脚本（sb.sh / sb.ps1 / deploy.sh / deploy.ps1 的提示与文档同步）
- 一致性：`deploy/envs/remote-release.env` 的字段与 `remote-pre.env` 对齐（补齐 `SITE_PORT` / `SITE_DOMAIN` / `SITE_PATH` 子路径部署配置）
- 部署：移除 Docker Compose 部署方式（删除 `deploy/docker-compose.yml`、`deploy/docker/`、`deploy/nginx/` 与 `make up/up-redis/down/logs`），部署统一走 `sb.sh` 三环境脚本或手动部署（PM2 + Nginx）
- 修复：`stop` 之后再发布，站点不会自动恢复上线的问题（发布成功后自动挂回本环境 Nginx 站点配置）
- 修复：`SSH_PASSWORD` 模式下首次连接新服务器时 scp 因主机指纹确认卡住的问题（scp 与 ssh 的选项对齐）
- 修复：部分服务器上非交互 SSH 的精简 PATH 找不到 `pnpm`/`pm2`（装在 npm 全局 bin 或未安装）导致发布失败；发布脚本现场定位 npm 全局 bin，缺失则按 `packageManager` 版本安装，`setup-server.sh` 安装后同步 PATH
- 修复：数据库不可达时发布在 `migrate deploy` 才失败且报错晦涩；发布前增加数据库预检（复用 `env-tool wait-tcp`），本机 MySQL 未启动自动拉起，未安装/外部数据库不可达时给出明确处理指引
- 新增：`DB_ROOT_PASS` 可写在 env 文件部署段（init 建库用，不会上传服务器），环境变量优先；`deploy.ps1` 同步支持
- 修复：MySQL 8 默认密码策略（MEDIUM）会拒绝 env 中的应用密码导致 init/db-remote-on 建账号失败；建账号期间临时放宽为 LOW，完成后恢复原策略
- 安全：`fresh` 清库前自动备份当前库到服务器 `shared/backup`（`auto-before-fresh`，与 db-restore 策略一致）
- 安全：服务器端发布加 `flock` 互斥锁，防止同秒/并发发布命中同一版本目录互相覆盖
- 一致性：发布前本机始终 `pnpm install --frozen-lockfile` 同步依赖（避免 lockfile 变化后用旧依赖构建）
- 一致性：`init` 时服务器安装的 pnpm 版本改为读取仓库 `packageManager` 锁定值
- 修复：新增角色提交失败——前端表单把 `status` 一并提交，被 `CreateRoleDto` 白名单校验拒绝（`property status should not exist`）；创建时改为只提交 `code/name/remark/menuIds`（状态单选本就只在编辑时显示，编辑接口 `UpdateRoleDto` 含 `status` 不受影响）
- 修复：MySQL 8 开启 GTID 时 `db-restore` 失败（`ERROR 3546 @@GLOBAL.GTID_PURGED`）——备份改为 `--set-gtid-purged=OFF`，恢复时自动剔除历史备份里的 GTID 语句（旧备份也能恢复）
- 修复：非 root / 应用账号执行 `mysqldump` 因缺少 PROCESS 权限失败（MySQL 8 默认读 tablespace 信息）；备份统一加 `--no-tablespaces`
- 其他：`.run/env.production` 权限收紧为 600；`logs`/`rollback` 参数白名单校验；`setup-server.sh` 过期的 deploy.config.json 提示修正
- 一致性：Windows 版 `sb.ps1` / `deploy.ps1` 补齐与 `sb.sh` / `deploy.sh` 的差异——子路径部署时前端构建注入 `SB_BASE_PATH`、pnpm 版本按 `packageManager` 传给服务器、ssh/scp 首次连接自动接受主机指纹、依赖始终按 lockfile 同步、`logs`/`rollback` 参数白名单校验、访问地址提示带 `SITE_PATH`、`gen-crud` 不再传空参数

## 0.2.0

### 脚本与开发体验

- **三环境统一入口**：`sb.sh` / `sb.ps1` 一套命令操作 `local`（本地开发）/ `remote-pre`（远程预发布）/ `remote-release`（远程正式），按环境分发到本地启动与远程部署
- **环境配置集中在 `deploy/envs/`**：`local.env`、`remote-pre.env`、`remote-release.env`（example 已提交，实际文件 gitignore）；`apps/server/.env` 为指向 `local.env` 的软链接（Mac/Linux），Windows 每次启动同步
- **数据库备份/恢复**：`./sb.sh <env> db-backup [备注]` / `db-restore <文件>` / `db-list`；服务器端 mysqldump 后拉回本地 `backup/<env>/`，恢复需输入库名确认且恢复前自动先备份
- **环境体检**：`./sb.sh <env> doctor` 巡检版本/服务/健康检查/磁盘/错误日志/备份，并比对本地 env 与服务器 `shared/.env` 差异（防配置忘记发布）
- **CRUD 代码生成器**：`./sb.sh gen-crud <模块> [--title 中文名]` 生成后端骨架 + DTO + 前端页面 + 单测骨架，并打印 Prisma 模型/菜单权限点片段
- **Swagger API 文档**：`/api/docs`（`SWAGGER_ENABLED`，生产默认关闭；依赖缺失时自动降级）
- **pre-commit 卡口**：`./sb.sh setup-hooks` 启用 `.githooks`（提交前跑 `pnpm lint && pnpm test`，`SKIP_HOOKS=1` 可跳过），不引入 husky
- 删除 `deploy.config.json`（配置并入 env 文件）、`.github/` CI（改由本地卡口承担）；`Makefile` 新增 `make pre` / `make release`

### 安全加固（默认宽松，避免管理员被锁死）

- 密码策略：最小长度/复杂度/弱密码字典/不得包含用户名/不得与旧密码相同（管理员重置与自助改密共用）
- 强制改密：管理员重置后 `mustChangePassword=true`，登录返回标志，前端跳 `/change-password`，路由守卫拦截
- 登录失败锁定（按用户名+IP 计数，`LOGIN_FAIL_*` 配置）、密码过期（`PASSWORD_EXPIRE_DAYS`）、登录验证码（`LOGIN_CAPTCHA=off|auto|on`，需 `svg-captcha`）
- IP 白/黑名单中间件（`IP_WHITELIST` / `IP_BLACKLIST`，支持 `192.168.*`）

### 可观测性与运维

- 健康检查细分：`/api/health`（综合）、`/api/health/live`（存活）、`/api/health/ready`（就绪：DB + Redis（仅 redis 锁时）+ 日志目录可写）
- Prometheus 指标 `/api/metrics`（`METRICS_ENABLED`，零依赖文本格式：HTTP 请求数/耗时、任务执行、进程内存 CPU）
- 日志告警任务 `system.logAlert`（ERROR 超阈值写 WARN 并可推 webhook）
- 多实例权限缓存一致性：`LOCK_DRIVER=redis` 时 pub/sub 广播失效

### 通用能力模块

- **系统参数 `SysConfig`**：运行时可改（不必改 env 重启），类型化读取（STRING/NUMBER/BOOL/JSON，非法值回退默认并告警），内置项保护
- **数据字典 `Dict` + `DictItem`**：下拉选项统一来源，缓存 60s，写入即失效；`/api/dicts/options/:code` 供前端复用
- **文件管理 `File`**：类型/大小白名单 + 可执行扩展名拦截，实体落 `UPLOAD_DIR`，下载走接口鉴权（不暴露静态目录），软删除 + 清理任务
- **通知公告 `Notice` + `NoticeRead`**：草稿/发布、置顶、有效期、已读记录；顶栏铃铛显示未读红点

### 测试

- 后端单测从 6 套件 31 例扩充到 **17 套件 123 例**：补齐 `user` / `role` / `menu` / `monitor` / `config` / `dict` / `file` / `notice` / `password-policy` / `login-guard` / `metrics`，覆盖 RBAC 与权限缓存失效链路

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
