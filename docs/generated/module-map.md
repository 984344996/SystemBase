<!-- ⚠️ 本文件由 scripts/gen-docs.mjs 自动生成，请勿手改；更新方式：pnpm docs:gen -->

# 模块地图（自动生成）

后端业务模块清单（`apps/server/src/modules/`），路由与权限码直接提取自 controller 源码。

## auth

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| POST | /api/auth/login | 登录即可 | 登录（返回 accessToken / refreshToken） |
| GET | /api/auth/captcha | 登录即可 | 获取登录验证码（未启用时返回 null；一次性，5 分钟有效） |
| POST | /api/auth/refresh | 登录即可 | 刷新令牌（轮换：旧 refreshToken 用后即废） |
| POST | /api/auth/logout | 登录即可 | 登出（吊销当前 refreshToken） |
| GET | /api/auth/profile | 登录即可 | 当前用户信息 |
| GET | /api/auth/menus | 登录即可 | 当前用户可见菜单树（动态路由数据源） |
| PUT | /api/auth/profile | 登录即可 | 修改自己的基本资料 |
| PUT | /api/auth/password | 登录即可 | 修改自己的密码（改完全端下线） |

Service 方法：`login()`、`captcha()`、`refresh()`、`handleRevokedReuse()`、`logout()`、`profile()`、`updateProfile()`、`myMenus()`、`changePassword()`、`issueTokens()`、`auditLogin()`、`ua()`、`buildTree()`

## config

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/configs | `system:config:list` | 系统参数列表（可按分组/关键字过滤） |
| GET | /api/configs/all | `system:config:list` | 全部系统参数 |
| POST | /api/configs | `system:config:create` | 新增系统参数 |
| PUT | /api/configs/:key | `system:config:update` | 修改系统参数（即时生效，无需重启） |
| DELETE | /api/configs/:key | `system:config:delete` | 删除系统参数（内置项不允许删除） |

Service 方法：`list()`、`all()`、`create()`、`update()`、`remove()`、`get()`、`getBool()`、`getNumber()`、`invalidate()`、`toBool()`

## dict

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/dicts | `system:dict:list` | 字典类型列表 |
| POST | /api/dicts | `system:dict:create` | 新增字典类型 |
| PUT | /api/dicts/:id | `system:dict:update` | update |
| DELETE | /api/dicts/:id | `system:dict:delete` | 删除字典（字典项级联删除） |
| GET | /api/dicts/:id/items | `system:dict:list` | 某字典下的全部选项 |
| POST | /api/dicts/:id/items | `system:dict:update` | addItem |
| PUT | /api/dicts/items/:itemId | `system:dict:update` | updateItem |
| DELETE | /api/dicts/items/:itemId | `system:dict:delete` | removeItem |
| GET | /api/dicts/options/:code | 登录即可 | 按字典编码取启用中的选项（前端下拉用） |

Service 方法：`list()`、`create()`、`update()`、`remove()`、`items()`、`addItem()`、`updateItem()`、`removeItem()`、`options()`、`labelOf()`、`invalidate()`

## example

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/example/ping | 登录即可 | ping |

## file

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/files | `system:file:list` | 文件列表（分页） |
| POST | /api/files/upload | `system:file:upload` | 上传文件（大小上限 UPLOAD_MAX_SIZE，默认 10MB） |
| GET | /api/files/:id/download | `system:file:download` | 下载文件（需登录与权限） |
| DELETE | /api/files/:id | `system:file:delete` | 删除文件（软删除，实体由清理任务回收） |

Service 方法：`list()`、`upload()`、`open()`、`remove()`、`purge()`

## job

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/jobs | `system:job:list` | 任务列表（全量） |
| GET | /api/jobs/handlers | `system:job:list` | 已注册的处理器列表 |
| GET | /api/jobs/logs | `system:job:list` | 任务执行日志（按天，来自日志文件） |
| POST | /api/jobs | `system:job:create` | 创建任务（增删改即时生效） |
| PUT | /api/jobs/:id | `system:job:update` | 更新任务 |
| PUT | /api/jobs/:id/toggle | `system:job:update` | 启用/停用任务 |
| DELETE | /api/jobs/:id | `system:job:delete` | 删除任务 |
| POST | /api/jobs/:id/run | `system:job:run` | 立即执行一次（手动触发） |

Service 方法：`onModuleInit()`、`setImmediate()`、`onModuleDestroy()`、`clearInterval()`、`reconcile()`、`logs()`、`create()`、`update()`、`toggle()`、`remove()`、`runOnce()`、`cronJobName()`、`schedule()`、`runWithTraceId()`、`deschedule()`、`reschedule()`、`run()`、`reject()`、`clearTimeout()`、`resolveHandler()`、`nextRunAt()`、`handleMisfire()`、`assertCron()`

## menu

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/menus | `system:menu:list` | 菜单树（全量，管理页数据源） |
| POST | /api/menus | `system:menu:create` | 创建菜单 |
| PUT | /api/menus/:id | `system:menu:update` | 更新菜单 |
| DELETE | /api/menus/:id | `system:menu:delete` | 删除菜单（连带清理角色关联） |

Service 方法：`tree()`、`create()`、`update()`、`remove()`、`assertNoCycle()`、`assertMenuShape()`

## monitor

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/monitor/logs/dates | `system:log:list` | 可用日志日期列表 |
| GET | /api/monitor/logs | `system:log:list` | 日志检索（分页，后端/前端日志） |
| GET | /api/monitor/logs/download | `system:log:download` | 下载当日日志文件 |
| GET | /api/monitor/login-logs | `system:loginlog:list` | 登录日志（当日审计） |
| GET | /api/monitor/operate-logs | `system:operatelog:list` | 操作日志（当日审计） |

Service 方法：`dates()`、`logs()`、`downloadPath()`、`loginLogs()`、`operateLogs()`

## notice

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/notices/mine | 登录即可 | 我可见的公告/消息（含已读标记，置顶优先） |
| GET | /api/notices/unread-count | 登录即可 | 未读数量（顶栏红点） |
| POST | /api/notices/:id/read | 登录即可 | 标记已读（幂等） |
| GET | /api/notices | `system:notice:list` | 公告管理列表（分页） |
| POST | /api/notices | `system:notice:create` | create |
| PUT | /api/notices/:id | `system:notice:update` | update |
| POST | /api/notices/:id/publish | `system:notice:publish` | 发布（草稿 → 已发布） |
| DELETE | /api/notices/:id | `system:notice:delete` | remove |

Service 方法：`list()`、`mine()`、`unreadCount()`、`detail()`、`create()`、`update()`、`publish()`、`remove()`、`read()`、`assertRange()`

## role

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/roles | `system:role:list` | 角色列表（分页） |
| GET | /api/roles/all | 登录即可 | 全量角色（下拉选择用） |
| GET | /api/roles/menu-tree | `system:role:list` | 全量菜单树（分配角色菜单用） |
| GET | /api/roles/:id | `system:role:list` | 角色详情（含已授权菜单） |
| POST | /api/roles | `system:role:create` | 创建角色 |
| PUT | /api/roles/:id | `system:role:update` | 更新角色（含菜单授权） |
| DELETE | /api/roles/:id | `system:role:delete` | 删除角色 |

Service 方法：`list()`、`all()`、`detail()`、`create()`、`update()`、`remove()`、`assertMenusExist()`

## user

| HTTP | 路径 | 权限码 | 说明 |
|---|---|---|---|
| GET | /api/users | `system:user:list` | 用户列表（分页） |
| POST | /api/users | `system:user:create` | 创建用户 |
| PUT | /api/users/:id | `system:user:update` | 更新用户 |
| DELETE | /api/users/:id | `system:user:delete` | 删除用户（软删除，吊销登录态） |
| PUT | /api/users/:id/password | `system:user:resetPwd` | 重置密码（登录后强制改密） |

Service 方法：`list()`、`create()`、`update()`、`remove()`、`resetPassword()`、`revokeAllRefreshTokens()`、`assertRolesExist()`、`assertNotLastSuperAdmin()`

