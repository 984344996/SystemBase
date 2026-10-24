# Changelog

## Unreleased

### 设计审查修复（docs/review-2026-10-24.md）

**⚠️ 行为变更（升级必读）**
- 权限守卫改为**默认拒绝**：接口必须声明 `@RequirePermissions` / `@LoginOnly` / `@Public` 之一，否则 403。自定义业务模块里「登录即可」的接口需补 `@LoginOnly()`
- `TRUST_PROXY` 默认值 `1` → `false`：经 Nginx 部署须在 env 显式配置 `TRUST_PROXY=1`（`remote.env.example` 已写好，现有 remote-pre/release 不受影响）
- `JWT_SECRET` 仅在 `NODE_ENV=development|test` 时允许缺省；未设置 `NODE_ENV` 也要求配置密钥
- `GET /api/roles/all` 需要 `system:user:create|update` 或 `system:role:list` 权限（原来所有登录用户可见）
- 新建用户的初始密码同样执行密码策略（原来只校验长度 ≥ 6）

**高危**
- 修复：文件下载不可用——前端 `?token=` 传参而后端只认 Authorization 头；改为 axios 带头请求 Blob 下载（token 不再进访问日志），移除无法工作的「复制链接」
- 修复：越权提权——新增 `PrivilegeGuardService`：只有超管能授予/摘除超管角色、管理/重置超管账号；非超管分配的角色、授权的菜单不能超出自身权限；不能修改自己所属角色的授权
- 修复：编辑角色时残留上一个角色的勾选（多授权）、「有页面无按钮」的菜单编辑一次即丢失——菜单树改为 `check-strictly` + 显式父子联动 + `setCheckedKeys` 整体替换
- 修复：refreshToken 轮换竞态——条件更新（`revokedAt: null`）+ 与签发新 token 同一事务；30s 宽限期内的重复使用视为并发刷新而非重放，不再误吊销全部登录态；前端用 Web Locks 跨标签页串行刷新，刷新前比对 token，多标签页不再互相踢下线
- 修复：下载文件流读失败无错误处理会打挂进程——改用 `pipeline` 并捕获；Content-Length 以磁盘实际大小为准；ETag 实现 304 协商
- 修复：上传无大小限制整文件先进内存——multer `limits.fileSize`；同步写盘改异步；入库失败清理孤儿文件
- 修复：系统参数行内编辑永远不保存（v-model 改值后比较恒相等）；编辑弹窗提交整行被白名单拒绝
- 修复：漏配 `NODE_ENV` 时使用源码公开的默认 JWT 密钥

**中危**
- 修复：改密/重置密码后旧 accessToken 仍有效——JWT 校验比较 `iat` 与 `pwdUpdatedAt`
- 修复：强制改密只在前端拦截——服务端 `mustChangePassword` 时只放行 `@AllowPendingPassword` 接口（业务码 40301）
- 修复：后端重启/断网时在线用户被批量踢回登录页——刷新请求加 10s 超时，只有 401/403 才清登录态；路由守卫非 401 错误弹「重试」而非登出
- 修复：登出先触发一次 token 轮换再用旧 token 登出——登出跳过 401 刷新、先清本地再通知后端
- 新增：跨标签页登录态同步（其他标签页登出/换账号时本页刷新）
- 修复：`sort` 参数可按任意字段排序（含 password）、未知字段触发 500——分页增加排序字段白名单
- 修复：`TRUST_PROXY` 默认信任代理头，服务直连时 `X-Forwarded-For` 可伪造
- 修复：前端日志上报接口可刷满磁盘——单日字节预算（`CLIENT_LOG_DAILY_MAX_BYTES`，默认 50MB）+ 10s 去重；Public 接口可选解析 token 记录 userId
- 修复：审计日志脱敏不完整——键名改不区分大小写的正则（覆盖 confirmPassword/captchaCode/secret/apiKey 等），超深度截断；系统参数的 value 不再明文入审计日志（`@OperateLog({ omitParams })`）
- 修复：`/auth/menus` 不过滤已禁用角色（菜单显示但点进去 403）
- 修复：上传类型只信客户端 mime——扩展名白名单 + 文件头魔数校验，服务端判定 mime；拒绝 html/svg 等可执行脚本类型
- 修复：软删除文件永不清理——`system.cleanup` 每小时调用 `FileService.purge()` 回收 7 天前删除的实体
- 修复：多实例下暂停/改 cron 的任务在其他实例照跑——`run()` 以库为准检查状态；每 60s 从库对账调度（`JOB_RECONCILE_SECONDS`）
- 修复：启动时同步补跑阻塞端口监听；库里一条非法 cron 导致应用启动失败；cron 写库前用调度库同时校验
- 修复：写操作重复提交（用户/角色/菜单/任务/个人资料/修改密码），任务「立即执行」连点重复执行
- 修复：用户/任务/字典/公告编辑提交整行数据被白名单校验拒绝（400）；公告有效期清空后无法保存
- 修复：弹框取消与接口错误被当成前端异常上报，前端日志全是噪音

**低危**
- 修复：多处 `logger.warn(fields, msg)` 参数顺序错误导致日志 msg 为空
- 修复：「最后一个超管」保护检查在事务外（两人同时互相禁用都能成功）——事务内 `FOR UPDATE`
- 修复：角色用户数统计含已删除用户导致角色删不掉；删除用户名可复用提示
- 新增：`RefreshToken(expiresAt/revokedAt)`、`notice(status, top, createdAt)` 索引（迁移 `20261024050344_add_token_notice_indexes`）
- 修复：访问日志记录完整 query；公告日期字段改 ISO 8601 校验
- 修复：`bcrypt.compareSync` 阻塞事件循环；前端各处密码规则不一致（6 位/8 位）——规则移入 `@sb/shared` 前后端共用
- 修复：验证码 SVG 改用 `<img>` 渲染（不执行脚本）；公告未读数 60s 轮询（页面隐藏时暂停）；chunk 加载失败刷新标记不清除；字典保存后选中项跳回第一个、快速切换显示错乱；`saveBlob` 立即 revoke 导致部分浏览器下载被取消
- 测试：单测 132 → 162（新增权限守卫默认拒绝、提权、脱敏、刷新并发、文件魔数、任务对账等）；E2E 9 → 16（`test/security.e2e-spec.ts` 对真实库回归提权/改密失效/强制改密/refresh 并发/默认拒绝/上传下载/排序白名单）；覆盖率 40% → 45%

### 文档现代化与自动化

- 新增：**文档自动生成** `pnpm docs:gen`（`scripts/gen-docs.mjs`）：从源码提取事实生成 `docs/generated/module-map.md`（全部模块的路由/权限码/服务方法，86 行路由表）与 `permissions.md`（seed 定义 × 前端使用的权限码对照，孤儿码/未定义码检测——当前 28 个权限码零漂移）；生成内容稳定幂等（无时间戳、内容不变不写入），CI 用 `git diff` 检测漂移（改了源码忘重新生成会红灯）
- 新增：**文档地图** `docs/README.md`：按「快速上手/开发约定/部署运维/参考（自动生成）/规划」组织全部 13 篇文档，标注每篇维护方式
- 修复：`docs/conventions.md` 虚构的分支模型（写着 main←dev←feat，实际单主干 master）、缺失的 BusinessException 与 docs:gen 约定
- 修复：`docs/module-guide.md` 未优先推荐 gen-crud 生成器、函数式权限判断的使用时机描述
- 可选后续：VitePress 文档站点、Typedoc 生成 core 层 API 参考（未做，等站点需求明确再上，避免过度工程）

### 质量保障（P0）

- 新增：**E2E 主链路冒烟测试**（`test/app.e2e-spec.ts`，9 个用例：健康检查/登录/认证/权限拒绝/CRUD/白名单校验/错误码结构），独立数据库 `system_base_e2e`（global-setup 自动建库+迁移+种子），`pnpm --filter @sb/server test:e2e` 运行——改 core 层（guard/filter/interceptor）后的回归底线
- 新增：**CI 工作流** `.github/workflows/ci.yml`（lint → 单测含覆盖率门 → 全量构建 → E2E with MySQL service），推送后自动验证，与本地 pre-commit 卡口互补
- 新增：**覆盖率防倒退门**（jest collectCoverage + coverageThreshold，当前基线约 40%，阈值设在 35/35/30/35，随覆盖提升逐步上调）
- 修复：**gen-crud 生成器模板对齐三件套**（`usePagedList`/`TablePager`/`StatusTag`/`v-permission`），并修复 api 模板两个 bug（request 导入路径错误、分页字段可选导致类型不满足 usePagedList 约束）——新业务代码不再产出旧范式

### 架构（P1）

- 新增：**业务错误码体系**（`BusinessException` + `BizCode` 枚举，`core/filter/business.exception.ts`）：响应 `code` 与 HTTP 状态解耦、`data` 透传；唯一约束冲突升级为 `40901`（HTTP 409）、`needCaptcha` 不再靠 message hack；存量 `BadRequestException` 保持兼容，渐进迁移
- 重构：**Redis 连接统一**为全局 `RedisModule`（`core/redis/redis.module.ts`），LockService 与 PermissionCacheService 不再各自 `new Redis`；主连接统一降级判断，pub/sub 走 `createConnection()`

### 文档与生态（F）

- 补齐：**Swagger 注解全量覆盖**（user/role/menu/auth/job/monitor 六个 controller 共 42 处，`/api/docs` 从半成品变完整）
- 新增：**`CONTRIBUTING.md`**（开发约定：三件套/权限指令/格式化/事务写法/错误码/测试要求）
- 新增：**`docs/upgrade-path.md`**（升级路径：框架文件与业务文件的边界清单、合并冲突的三个集中点、升级步骤与反模式）——复用型框架能否被长期使用的核心
- 新增：**多实例前置条件说明**（`docs/deploy.md` 新章节）：明确限流/登录锁定是单机内存态、文件/日志依赖共享存储、锁与任务多实例安全
- README 文档索引同步补充
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
