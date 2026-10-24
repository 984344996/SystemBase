# SystemBase 长期记忆

## 项目约定（2026-10-24 更新）
- 后端权限守卫默认拒绝：每个接口必须声明 `@RequirePermissions` / `@LoginOnly` / `@Public`；必须改密状态下可用的再加 `@AllowPendingPassword`
- 分配角色/授权菜单/管理他人账号必须经过 `PrivilegeGuardService`；超管编码统一用 `SUPER_ROLE`
- 前端编辑表单只提交 DTO 白名单字段（后端 `forbidNonWhitelisted`，整行提交会 400）；写操作按钮必须 `saving` + `:loading`
- 列表页用 `usePagedList` + `TablePager` + `StatusTag`；按钮权限用 `v-permission`；时间格式化用 `formatTime`
- 密码规则在 `@sb/shared/password.ts` 前后端共用
- 改了路由/权限码/模块后跑 `pnpm docs:gen`（CI 检测漂移）
- 改 core 层后必须跑 `pnpm --filter @sb/server test:e2e`（独立库 system_base_e2e）

## 环境事实
- 本机 3001 端口常被 CodeBuddy Helper 进程占用（不能杀），冒烟测试用临时端口（PORT=300x node dist/main.js）
- git remote 用 SSH（`git@github.com:984344996/SystemBase.git`），HTTPS 直连 github 不通
- MySQL 表名：有 @@map 的是 snake_case（sys_config/dict/file/notice），其余是 PascalCase（User/UserRole/Role/Menu...），原生 SQL 加反引号
- 改了 packages/shared 后要重启 `./sb.sh local start`（nest watch 不感知 dist 变化）；IDE 报 Prisma 字段不存在但 tsc 通过时重启 TS Server
