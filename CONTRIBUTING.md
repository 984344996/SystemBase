# 贡献与开发约定

提交前跑 `pnpm lint && pnpm test`（或 `./sb.sh setup-hooks` 启用 pre-commit 自动卡口）。CI 会在推送后兜底复查（lint / 单测含覆盖率门 / 构建 / E2E）。

## 目录分层

```
apps/server/src/
├── core/      # 框架层：filter/interceptor/guard/pagination/logger/security/lock/redis/metrics...
└── modules/   # 业务模块：<name>/{controller,service,dto,module}，开新项目可整体删除复用
```

**改动 core 层（guard/filter/interceptor/pipes）必须跑 E2E**：`pnpm --filter @sb/server test:e2e`，它覆盖登录/权限/CRUD/错误码主链路。

## 后端约定

- **接口权限（默认拒绝）**：每个接口必须声明 `@RequirePermissions('xxx')`、`@LoginOnly()`（登录即可）或 `@Public()` 之一，否则权限守卫返回 403。「必须先改密」状态下仍需可用的接口再加 `@AllowPendingPassword()`
- **授权边界**：分配角色、授权菜单、管理他人账号前调用 `PrivilegeGuardService`（防止「有用户管理权限」的人把自己提成超管）；超管角色编码统一引用 `SUPER_ROLE` 常量
- **分页排序**：`paginate()` 传 `sortable` 白名单（默认只允许 id/createdAt/updatedAt），不要让前端按任意字段排序
- **审计**：`@OperateLog` 自动脱敏常见敏感键；请求体里有其他敏感值时用 `omitParams` 排除
- **错误**：业务可预期错误抛 `BadRequestException`（HTTP 语义够用时）；需要前端精确区分的升级为 `BusinessException`（错误码在 `@sb/shared` 的 `BizCode` 集中登记，前后端共用）
- **重复类错误**：一律 `throw duplicate('xxx 已存在')`（409 + 40901），不要再抛 400
- **唯一约束**：create/update 一律「预检 + `withUniqueViolation()` 兜底」（`core/prisma/prisma-error.util.ts`）；其余 Prisma 约束错误（记录不存在、外键、超长）由全局过滤器统一映射，无需各处 try/catch
- **树形结构**：用 `@sb/shared` 的 `buildTree()`（支持 prune 回调），不要再手写 Map 建树
- **吊销登录态**：统一走 `revokeAllRefreshTokens()`
- **事务**：多表业务一致性用回调式 `$transaction(async (tx) => ...)`；互不依赖的并行写用数组式 `$transaction([...])`
- **Redis / 多实例共享状态**：不要自行 `new Redis`。需要跨实例共享的短期状态（计数、一次性令牌）用 `SharedStoreService`；缓存失效通知用 `EventBusService.publish/subscribe`；锁用 `LockService`。三者在未启用 Redis 时自动退化为单机实现，业务代码不用区分
- **环境变量**：新增变量必须在 `core/config/env.validation.ts` 声明并校验格式，同时写进 `deploy/envs/*.env.example`
- **单测**：service 层必须有 spec（mock Prisma）；改 core 层补 E2E；覆盖率门在 `apps/server/package.json` jest 段（当前 50%，防倒退，逐步上调）；Redis 相关逻辑用 `ioredis-mock` 测（见 `core/redis/redis-shared.spec.ts`）

## 前端约定

- **列表页**：分页/查询/加载用 `usePagedList`（自带请求竞态保护；fetcher 第二个参数 `{ signal }` 传给请求可取消旧请求），分页条用 `<TablePager>`，状态列用 `<StatusTag>`，表格绑 `v-loading`
- **弹窗表单**：新增/编辑用 `useCrudForm`（`empty` / `fromRow` / `toPayload` / `create` / `update`），不要每页手写 visible/editingId/saving 一套
- **字典**：下拉用 `<DictSelect code="xxx">`、显示用 `<DictTag code="xxx" :value>`（带缓存），不要在页面里硬编码选项
- **图标**：一律 `<MenuIcon name="Setting" />`；不要 `import { Xxx } from "@element-plus/icons-vue"`（单文件包，任何静态引用都会把全部图标拉回首屏主包）
- **导出**：用 `utils/export.ts` 的 `exportPaged`（CSV，带 BOM 与公式注入防护）
- **业务码**：用 `@sb/shared` 的 `BizCode` + `bizCodeOf(e)` 判断，不要写死数字
- **查询按钮绑 `search()` 而非 `load()`**：search 会先回到第 1 页（修「第 N 页改条件查询拿到空页」的隐性 bug）
- **按钮权限**：一律 `v-permission="'system:xxx:action'"` 指令；需要 `:disabled` 等函数判断时才用 `auth.hasPerm()`
- **时间/大小格式化**：统一 `utils/datetime` 的 `formatTime` / `formatSize`，不要在模板里内联 `replace('T',' ').slice(...)`
- **样式**：`.toolbar` / `.muted` / `.mini` / `.pager` 已在全局 `styles/index.css`，不要再写 scoped 副本
- **颜色**：一律用 Element Plus 变量（`var(--el-bg-color)`、`var(--el-text-color-secondary)`、`var(--el-color-primary)`、`var(--el-border-color)` 等），不要写死 `#fff` / `#909399`，否则深色模式下会露出亮块；项目自己的颜色在 `styles/index.css` 的 `:root` 与 `html.dark` 里成对定义
- **API 层**：create/update 参数用 `Partial<XxxRow>` 等具体类型，删除返回用 `DeleteResult`，不用 `Record<string, unknown>`
- **编辑表单只提交 DTO 白名单字段**：不要 `Object.assign(form, row)` 后把整行提交（id/createdAt 等会被后端 `forbidNonWhitelisted` 拒绝）
- **提交按钮**：写操作一律 `saving` + `:loading` 防重复提交
- **下载**：带 Authorization 头请求 Blob（`responseType: "blob"` + `saveBlob`），不要把 token 拼进 URL
- **密码规则**：用 `utils/password.ts`（与后端同一套 `@sb/shared` 校验函数），不要自己写长度判断
- **类型检查与测试**：`pnpm --filter @sb/web lint`（vue-tsc）、`pnpm --filter @sb/web test`（vitest，测试文件与被测文件放一起：`xxx.spec.ts`）

## 代码检查

- `pnpm lint`：全部包的类型检查 + `prisma validate` + ESLint（`eslint.config.mjs`，只开能发现 bug 的规则；`any` 先警告）
- `pnpm lint:fix`：自动修复 ESLint 可修复项
- `pnpm format`：Prettier 格式化（后端单引号、前端双引号，见各 `.prettierrc.json`）。存量代码未统一格式化，不在 CI 中强制；新文件建议保存时自动格式化

## 新建业务模块

优先用生成器（产物已对齐上述三件套约定）：

```bash
./sb.sh gen-crud <模块名> --title 中文名 --dry-run   # 先看会生成哪些文件
./sb.sh gen-crud <模块名> --title 中文名             # 生成；按终端提示：粘贴 Prisma 模型并迁移 → 注册模块 → 加菜单
./sb.sh gen-crud <模块名> --remove                    # 撤销生成的文件
```

页面默认放在业务目录 `views/biz/<模块名>/`，菜单挂在「业务管理」下（不要放进框架目录 `views/system/`）。

## 版本与发布

- 遵循语义化版本：破坏性改动 major、新功能 minor、修复 patch
- 每次用户可感知的改动记入 `CHANGELOG.md` 的 Unreleased 段
- 发版：`node scripts/bump-version.mjs 0.3.0`（同步全部 `package.json` 版本号 + CHANGELOG 的 Unreleased 改为该版本）；加 `--tag` 同时提交并打 `v0.3.0` tag
