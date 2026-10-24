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
- **错误**：业务可预期错误抛 `BadRequestException`（HTTP 语义够用时）；需要前端精确区分的升级为 `BusinessException`（`core/filter/business.exception.ts`，错误码在 `BizCode` 集中登记）
- **唯一约束**：create 一律「预检 + `withUniqueViolation()` 兜底」（`core/prisma/prisma-error.util.ts`）
- **树形结构**：用 `@sb/shared` 的 `buildTree()`（支持 prune 回调），不要再手写 Map 建树
- **吊销登录态**：统一走 `revokeAllRefreshTokens()`
- **事务**：多表业务一致性用回调式 `$transaction(async (tx) => ...)`；互不依赖的并行写用数组式 `$transaction([...])`
- **Redis**：一律注入 `RedisClientService`（`core/redis/redis.module.ts`），不要自行 `new Redis`；Redis 不可用时消费方自行降级并保持幂等
- **单测**：service 层必须有 spec（mock Prisma）；改 core 层补 E2E；覆盖率门在 `apps/server/package.json` jest 段（防倒退，逐步上调）

## 前端约定

- **列表页**：分页/查询/加载用 `usePagedList` composable，分页条用 `<TablePager>`，状态列用 `<StatusTag>`（三者已解决 9 个列表页的样板重复）
- **查询按钮绑 `search()` 而非 `load()`**：search 会先回到第 1 页（修「第 N 页改条件查询拿到空页」的隐性 bug）
- **按钮权限**：一律 `v-permission="'system:xxx:action'"` 指令；需要 `:disabled` 等函数判断时才用 `auth.hasPerm()`
- **时间/大小格式化**：统一 `utils/datetime` 的 `formatTime` / `formatSize`，不要在模板里内联 `replace('T',' ').slice(...)`
- **样式**：`.toolbar` / `.muted` / `.mini` / `.pager` 已在全局 `styles/index.css`，不要再写 scoped 副本
- **API 层**：create/update 参数用 `Partial<XxxRow>` 等具体类型，删除返回用 `DeleteResult`，不用 `Record<string, unknown>`
- **编辑表单只提交 DTO 白名单字段**：不要 `Object.assign(form, row)` 后把整行提交（id/createdAt 等会被后端 `forbidNonWhitelisted` 拒绝）
- **提交按钮**：写操作一律 `saving` + `:loading` 防重复提交
- **下载**：带 Authorization 头请求 Blob（`responseType: "blob"` + `saveBlob`），不要把 token 拼进 URL
- **密码规则**：用 `utils/password.ts`（与后端同一套 `@sb/shared` 校验函数），不要自己写长度判断
- **类型检查**：`pnpm --filter @sb/web lint`（vue-tsc）

## 新建业务模块

优先用生成器（产物已对齐上述三件套约定）：

```bash
./sb.sh gen-crud <模块名> --title 中文名    # 前提：先建 Prisma 模型并迁移
```

## 版本与发布

- 遵循语义化版本：破坏性改动 major、新功能 minor、修复 patch
- 每次用户可感知的改动记入 `CHANGELOG.md` 的 Unreleased 段
- 版本号在发版时通过各 `package.json` 同步更新
