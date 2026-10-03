# SystemBase 架构说明

## 总览

pnpm monorepo，前后端分离：

```
apps/server   NestJS 10 + Prisma 5 + MySQL     框架核心(core) + 系统模块(modules) + 示例(example)
apps/web      Vue 3 + TS + Element Plus 按需    登录 / 布局 / 动态菜单 / 系统管理页面
packages/shared  前后端共享工具                  时间区间算法、分页常量、通用枚举
deploy        Dockerfile / nginx / compose     一键部署
```

## 分层铁律

```
core/      框架层：config、logger、security、lock、pagination、prisma、interceptor、filter
           —— 不允许 import modules/ 下任何东西
modules/   系统模块：auth / user / role / menu / job / monitor
example/   示例业务模块 —— 新项目直接整目录删除
```

依赖方向：`modules → core`，`core → 无业务`。这保证业务可删、框架可复用。

## 请求生命周期

```
请求
 → helmet                 安全响应头(CSP/nosniff/frame-deny/HSTS[生产])，去掉 X-Powered-By
 → bodyParser             json/urlencoded 上限 BODY_LIMIT(默认 1mb)，超限/非法 JSON → 统一结构 4xx + WARN 日志
 → TraceMiddleware        生成/透传 traceId，记 access 日志(5xx→ERROR / 4xx→WARN / 其余 INFO)
 → ThrottlerGuard         全局限流(默认 100 次/分钟)；登录接口单独 5 次/分钟
 → JwtAuthGuard           非公开接口校验 JWT，加载角色/权限（进程内缓存 PERMISSION_CACHE_TTL 秒）
 → PermissionsGuard       校验 @RequirePermissions('xxx:yyy')
 → ValidationPipe         DTO class-validator 强校验，多余字段直接 400
 → OperateLogInterceptor  @OperateLog 装饰的写操作 → 审计写日志文件(成功 INFO / 失败 WARN，参数脱敏)
 → Controller/Service
 → TransformInterceptor   成功统一包裹 { code:0, data, message, traceId }
 → AllExceptionsFilter    异常统一 { code, data:null, message, traceId }；5xx 记 ERROR、4xx 记 WARN
```

前端 axios 拦截器只处理这一种结构；401 时用 refreshToken 单飞静默续期后重放请求。

前端错误提示分级（`utils/request.ts`）：

| 情况 | 提示 | 说明 |
|---|---|---|
| 断网 / 超时 | error，带追踪码 | 前端为每个请求生成 `X-Trace-Id`，后端透传，拿不到响应也能查日志 |
| 5xx | error：「服务器繁忙…（追踪码 xxx）」 | 不展示内部错误，用追踪码去日志查 |
| 403 | warning：「无权限：…」 | |
| 429 | warning：「操作过于频繁」 | |
| 其余 4xx / 业务错误 | warning：后端 message | |

同一提示 1.5s 内去重；单个请求可传 `{ silent: true }` 自行处理错误。

## 认证设计

- accessToken 2h（无状态，不做黑名单，靠短过期兜底）
- refreshToken 7d，**一次性轮换**：每次刷新作废旧 token 签发新对；DB 只存 sha256 哈希
- 修改密码/重置密码/禁用用户 → 吊销该用户全部 refreshToken，全端下线
- 登录成败（含失败原因、IP、UA）、refreshToken 重放、修改密码均写审计日志（category=audit）

## RBAC 设计

```
User ──< UserRole >── Role ──< RoleMenu >── Menu(DIRECTORY | MENU | BUTTON)
```

- BUTTON 节点的 `permission` 字段即权限码（如 `system:user:create`），与后端 `@RequirePermissions` 对应
- `SUPER_ADMIN` 角色全放行（硬编码，不可删除/禁用）
- 前端：菜单接口返回可见菜单 → 动态注册路由；按钮用 `v-permission="'xxx'"`（或 `auth.hasPerm('xxx')` + `v-if`）控制
- 路由级权限：页面 `meta.permission`（动态路由取菜单 permission），不满足跳 `/403`；未授权的菜单路由不注册，访问得 404
- 权限缓存：JWT 只携带身份，角色/权限由 `PermissionCacheService` 缓存（默认 30s）
  - 本实例：用户（状态/角色/资料/删除）、角色（授权/状态/删除）、菜单（改/删）变更时主动失效，**立即生效**
  - 多实例：其他实例最多延迟 `PERMISSION_CACHE_TTL` 秒；要求强一致设为 `0` 关闭缓存
  - 查库期间若发生失效，查询结果不会写回缓存（版本号校验，避免把旧权限缓存 30s）

## 日志体系（只落文件，不落库）

**原则：排障只看日志文件。** 登录日志、操作日志、任务执行记录都不写数据库，统一写入 `LOG_DIR`（默认 `logs/`）：

```
logs/
├── app.2026-09-29.log
└── app.2026-09-30.log     每天一个文件，按服务器本地时区零点切换
```

每行一条 JSON，固定字段在前：

```json
{"level":"WARN","time":"2026-09-30 14:03:22.123","category":"audit","traceId":"3f2a8b1c…","event":"login","username":"admin","success":false,"reason":"密码错误","ip":"10.0.0.8","msg":"登录失败: admin（密码错误）"}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `level` | `DEBUG` / `INFO` / `WARN` / `ERROR` / `FATAL` | 可读字符串，`grep '"level":"ERROR"'` 直接定位错误 |
| `time` | `YYYY-MM-DD HH:mm:ss.SSS` | 服务器本地时间，与墙上时钟一致 |
| `category` | `app` / `access` / `audit` / `job` | 应用与框架 / HTTP 访问 / 登录与操作审计 / 定时任务 |
| `traceId` | 32 位十六进制 | 与响应头 `X-Trace-Id` 同值，一次请求的所有日志共享 |
| `msg` | 文本 | 人类可读摘要 |

级别约定：

| 级别 | 写入场景 |
|---|---|
| INFO | 正常请求（2xx/3xx）、登录成功、操作成功、任务成功、框架启动信息 |
| WARN | 4xx 请求、登录失败、操作失败、token 重放、任务因锁跳过 |
| ERROR | 5xx 请求与未捕获异常（含堆栈）、任务失败/超时 |
| DEBUG | 仅 `LOG_LEVEL=debug` 时输出（开发环境默认） |

- 保留期：`LOG_KEEP_DAYS`（默认 30，含当天），每天切换文件时自动删除过期文件；**不提供删除接口**，避免人为抹除审计痕迹
- 最低级别：`LOG_LEVEL`（生产默认 `info`）
- 脱敏：password / oldPassword / newPassword / token / refreshToken / accessToken 统一输出 `[REDACTED]`
- 噪音控制：`/api/health` 探活不记访问日志
- 写入：主线程异步写（SonicBoom），不阻塞请求；进程退出时同步刷盘

### 常用排障命令

```bash
grep '"level":"ERROR"' logs/app.2026-09-30.log            # 当天所有错误
grep '3f2a8b1c' logs/app.2026-09-30.log                    # 按 traceId 看一次请求的完整链路
grep '"event":"login"' logs/app.2026-09-30.log | grep '"success":false'   # 登录失败
grep '"category":"job"' logs/app.2026-09-30.log | grep '"level":"ERROR"'  # 任务失败
```

### 管理端查看（modules/monitor，只读）

| 页面 | 接口 | 数据来源 |
|---|---|---|
| 系统日志 | `GET /api/monitor/logs`（日期+级别+分类+traceId+关键字）、`GET /api/monitor/logs/download` | 全部日志 |
| 登录日志 | `GET /api/monitor/login-logs` | `category=audit, event=login` |
| 操作日志 | `GET /api/monitor/operate-logs` | `category=audit, event=operate` |
| 任务执行日志 | `GET /api/jobs/logs` | `category=job, event=run` |

读取实现：`core/logger/log-reader.service.ts` 按天文件流式逐行扫描、倒序分页，单次查询最多保留最新 5000 条命中。
适用于中小规模（单日百 MB 级）；体量更大或多实例部署时，建议用 Promtail/Filebeat 采集到 Loki/ELK（日志已是 JSON，无需改代码）。

## 分布式锁

`LOCK_DRIVER=redis|db`（默认 db，**无 Redis 也能跑**）：

- redis：`SET key owner PX ttl NX` + Lua 原子释放，多实例安全
- db：`SysLock` 表 + 过期抢占，单机/轻量场景零依赖

主要用途：定时任务多实例防重、业务防并发（如排课）。

## 错误码约定

统一响应 `code` 字段：0 成功；HTTP 状态码语义（401 未登录 / 403 无权限 / 400 参数或业务错误 / 500 服务器错误）。
业务扩展错误码建议分段：1xxx 系统、2xxx 认证、3xxx+ 业务自定。

## 关键目录索引

| 路径 | 说明 |
|---|---|
| `apps/server/src/core/config/env.validation.ts` | 环境变量启动校验（生产缺 JWT_SECRET/CORS 直接失败）|
| `apps/server/src/core/logger/` | 日志写入（每日单文件）、读取、traceId 上下文 |
| `apps/server/src/core/security/` | JWT/RBAC 守卫与装饰器、权限缓存 |
| `apps/server/prisma/migrations/` | 数据库迁移（随代码提交，生产 `migrate deploy`）|
| `apps/server/src/database/seed.ts` | 种子数据（幂等，随构建编译）|
| `apps/server/src/core/lock/` | 分布式锁抽象 |
| `apps/server/src/modules/job/` | 动态定时任务（见 job-guide.md）|
| `apps/server/src/modules/monitor/` | 日志查询/下载（只读，数据源为日志文件） |
| `apps/web/src/stores/permission.ts` | 菜单→动态路由 |
| `apps/web/src/directives/permission.ts` | `v-permission` 按钮级权限指令 |
| `apps/web/src/utils/request.ts` | 统一响应处理 + 静默刷新 |
