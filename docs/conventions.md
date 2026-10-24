# 项目约定

## 目录与命名

| 项 | 约定 |
|---|---|
| 后端业务模块 | `modules/<biz>/`，文件名 `xxx.module.ts / controller.ts / service.ts`，DTO 放 `dto/` |
| 处理器类 | `xxx.jobs.ts`（`@JobHandler` 类统一后缀 Job）|
| 前端页面 | `views/<biz>/XxxList.vue`，与菜单 component 字段一一对应 |
| 权限码 | `<domain>:<action>` 三段式，如 `system:user:create`、`booking:list` |
| 数据库表 | 模型 PascalCase 单数（`User`、`RefreshToken`），系统表加 `Sys` 前缀（`SysLock`）；**日志/审计/执行记录一律写日志文件，不建表** |
| API 路径 | 复数资源 `/api/users`、`/api/jobs`；动作类 `/api/jobs/:id/run` |

## 接口规范

- 成功：`{ code: 0, data, message: 'ok', traceId }`（TransformInterceptor 自动包裹，业务只 return 数据）
- 失败：抛 HttpException，过滤器统一 `{ code, data, message, traceId }`；需要前端精确区分的错误用 `BusinessException`（业务错误码，见 `core/filter/business.exception.ts` 的 `BizCode`）
- 列表：必须继承 `PaginationDto` 并用 `paginate()`，响应 `{ list, total, page, pageSize }`
- 写操作：DTO class + `@RequirePermissions` + `@OperateLog` 三件套
- 路由 / 权限码 / 模块清单文档自动生成：改完跑 `pnpm docs:gen`（CI 会检测漂移）

## Git 约定

```
feat: 新功能        fix: 修复          refactor: 重构
docs: 文档          chore: 构建/工具    perf: 性能
```

分支：单主干 `master`（预发验证后再正式发布：`./sb.sh remote-pre deploy` → `./sb.sh remote-release deploy`）。
提交前：`pnpm lint && pnpm test` 必须通过（或 `./sb.sh setup-hooks` 启用 pre-commit 卡口）。改了 `schema.prisma` 必须同时提交迁移（`make db-migrate name=xxx`），否则 `migrate deploy` 后表结构与代码不符。

## 代码风格

- 后端 TypeScript strict；前端 TypeScript strict
- 禁止在 controller 写业务逻辑（只做参数接收/权限声明）
- 禁止在 core/ 引用 modules/（分层铁律，见 architecture.md）
- 日志输出一律结构化字段在前、消息在后：`logger.info({ userId }, '用户登录')`
- 敏感信息（密码/token/密钥）禁止写日志（redact 已兜底，业务代码也不要手动打印）
- 时间一律 ISO 8601 / Date；时区统一服务器本地（服务器 TZ=Asia/Shanghai）

## 版本

- 框架版本记录在根 `package.json` + [CHANGELOG.md](../CHANGELOG.md)；发版时同步更新两者
- 升级框架：对比 `core/` 目录 diff 后合并，业务模块不受影响
