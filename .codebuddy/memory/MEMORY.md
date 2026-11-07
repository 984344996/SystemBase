# SystemBase 长期记忆

## 项目约定（2026-10-24 更新）
- 后端权限守卫默认拒绝：每个接口必须声明 `@RequirePermissions` / `@LoginOnly` / `@Public`；必须改密状态下可用的再加 `@AllowPendingPassword`
- 分配角色/授权菜单/管理他人账号必须经过 `PrivilegeGuardService`；超管编码统一用 `SUPER_ROLE`
- 前端编辑表单只提交 DTO 白名单字段（后端 `forbidNonWhitelisted`，整行提交会 400）；写操作按钮必须 `saving` + `:loading`
- 列表页用 `usePagedList` + `TablePager` + `StatusTag`；按钮权限用 `v-permission`；时间格式化用 `formatTime`
- 密码规则在 `@sb/shared/password.ts` 前后端共用
- 改了路由/权限码/模块后跑 `pnpm docs:gen`（CI 检测漂移）
- 改 core 层后必须跑 `pnpm --filter @sb/server test:e2e`（独立库 system_base_e2e）
- 用户偏好：脚本里每个函数/小步骤都要有中文注释（用户看不懂无注释的脚本）

## 框架约定（2026-11-07 新增）
- 图标一律 `<MenuIcon name="X" />`，禁止 `import { X } from "@element-plus/icons-vue"`（会把全部图标拉回首屏主包）
- 弹窗表单用 `useCrudForm`；字典用 `DictSelect`/`DictTag`；导出用 `utils/export.ts`；业务码用 `@sb/shared` 的 `BizCode` + `bizCodeOf(e)`
- 「已存在」统一 `throw duplicate(...)`（409/40901）；跨实例共享状态用 `SharedStoreService` / `EventBusService` / `LockService`，不要自建 Redis 客户端
- 前端颜色一律用 `var(--el-*)` 变量（支持深色模式），项目自定义色在 `styles/index.css` 的 `:root` 与 `html.dark` 成对定义
- 新增环境变量必须写进 `core/config/env.validation.ts` 和 env 模板
- 质量门：`pnpm lint`（tsc + prisma validate + ESLint）、`pnpm test`（后端 jest 覆盖率门 50% + 前端 vitest）
- 依赖漏洞用根 package.json 的 `pnpm.overrides` 在同大版本内修复；新项目用 `./sb.sh init-project`，发版用 `scripts/bump-version.mjs`

## 部署约定（2026-11-06 更新）
- 远程发布在服务器后台执行（setsid nohup），日志 `shared/deploy-logs/<版本号>.log`(.rc/.pid)，`./sb.sh <env> deploy-log` 查看
- 新增部署段变量时必须同时加进 `deploy.sh` 的 `DEPLOY_KEYS` 与 `deploy.ps1` 的 `$deployKeys`（当前含 PROTECTED）
- `db-backup.sh backup` 最后一行固定输出 `BACKUP_FILE=<路径>`，调用方按标记提取，不要改格式
- `/api/health` 返回 `release`（读版本目录 RELEASE），发布健康检查要求等于本次版本号
- deploy.ps1 发往 ssh 的远程命令不能含双引号（PS 5.1 会拆坏参数），只用单引号/无引号
- 脚本中比较版本目录一律按目录名（basename），不要拿 readlink -f 结果和字面路径比（DEPLOY_DIR 可能经过软链）
- R5（非 root 运行/关闭 root 密码登录）、R12（关闭 8080/8081 明文端口）、异地备份需用户手动处理

## 环境事实
- 本机 3001 端口常被 CodeBuddy Helper 进程占用（不能杀），冒烟测试用临时端口（PORT=300x node dist/main.js）
- git remote 用 SSH（`git@github.com:984344996/SystemBase.git`），HTTPS 直连 github 不通
- MySQL 表名：有 @@map 的是 snake_case（sys_config/dict/file/notice），其余是 PascalCase（User/UserRole/Role/Menu...），原生 SQL 加反引号
- 改了 packages/shared 后要重启 `./sb.sh local start`（nest watch 不感知 dist 变化）；IDE 报 Prisma 字段不存在但 tsc 通过时重启 TS Server
