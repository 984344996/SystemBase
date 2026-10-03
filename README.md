# SystemBase

前后端分离基础框架：**pnpm monorepo = NestJS + Prisma + MySQL（后端）｜ Vue3 + TS + Element Plus（前端）**，内置动态定时任务、按天滚动日志、RBAC 权限、操作审计等基础能力，业务模块可整体删除复用。

## 目录结构

```
systembase/
├── apps/
│   ├── server/        # NestJS 后端(core 框架层 + modules 系统模块(auth/user/role/menu/job/monitor) + example 示例)
│   └── web/           # Vue3 + TS 管理端(登录/布局/系统管理页面)
├── packages/
│   └── shared/        # 前后端共享工具(时间区间算法、通用常量)
├── deploy/
│   ├── envs/          # 环境配置：local.env / remote-pre.env / remote-release.env（example 已提交）
│   ├── server/        # 服务器部署：初始化 / 发布 / 运维 / SSL 脚本，PM2 与 Nginx 模板
│   ├── docker/        # Dockerfile
│   └── nginx/         # Docker 版 nginx 配置
├── docs/              # 架构、模块开发、定时任务、部署文档
├── sb.sh / sb.ps1     # 统一入口：./sb.sh local start | remote-pre deploy | remote-release ...
├── start-local.sh / start-local.ps1   # 本地启动实现（由 sb 分发，也可直接执行）
├── deploy.sh / deploy.ps1             # 远程部署实现（由 sb 分发，也可直接执行）
├── Makefile           # 常用命令
└── pnpm-workspace.yaml
```

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20.10 | |
| pnpm | 9.x | 已在根 `package.json` 用 `packageManager` 锁定，执行 `corepack enable` 后自动使用正确版本 |
| MySQL | 8.x | 本地开发直连；Docker 部署则无需本机安装 |

## 5 分钟跑起来

```bash
corepack enable                                        # 自动使用锁定的 pnpm 9
cp deploy/envs/local.env.example deploy/envs/local.env # 确认 DATABASE_URL 指向本机 MySQL（库不存在会自动创建）
./sb.sh local start                                    # Windows: powershell -ExecutionPolicy Bypass -File sb.ps1 local start
```

一条命令完成：安装依赖 → 数据库迁移 → 种子数据（超管 admin/admin123）→ 后台启动前后端 → 等待就绪。
登录 `http://localhost:5173` ｜ admin / admin123。`./sb.sh local stop | status | fresh | logs` 见 [部署指南](docs/deploy.md)。

> 手动方式：`pnpm install && make db-deploy && make db-seed && make dev`。

## 三环境发布（统一入口 sb.sh / sb.ps1）

全部环境配置集中在 `deploy/envs/`（example 已提交，实际文件已被 gitignore，含密码勿提交）：

| 环境 | 配置文件 | 内容 |
|---|---|---|
| `local` | `deploy/envs/local.env` | 后端端口 `PORT`、前端端口 `WEB_PORT`、本机 `DATABASE_URL` 等 |
| `remote-pre` | `deploy/envs/remote-pre.env` | SSH 地址/端口/用户/密码、部署目录、PM2 应用名 + 应用全套运行配置 |
| `remote-release` | `deploy/envs/remote-release.env` | 同上（指向正式服务器） |

```bash
cp deploy/envs/remote-pre.env.example deploy/envs/remote-pre.env         # 填 SSH_HOST 与应用配置
cp deploy/envs/remote-release.env.example deploy/envs/remote-release.env
ssh-copy-id root@服务器IP              # SSH 免密（推荐）；或在 env 里填 SSH_PASSWORD（Mac/Linux 需 sshpass）
./sb.sh remote-pre init                # 首次：初始化预发布服务器并发布
./sb.sh remote-pre deploy              # 日常发布预发布（失败自动回滚）
./sb.sh remote-release init            # 正式环境首次初始化
./sb.sh remote-release deploy          # 日常发布正式
```

`status` / `logs [ERROR]` / `rollback` / `ssl 域名` / `ssh` 等命令对两个远程环境通用（Windows 用 `sb.ps1`，命令一致），见 [部署指南](docs/deploy.md#方式二服务器一键部署pm2--nginx推荐)。同一台服务器部署多环境时，`DEPLOY_DIR` 与 `APP_NAME` 各环境要不同。

## 核心能力

| 能力 | 说明 |
|---|---|
| 认证 | JWT accessToken(2h) + refreshToken(7d) 轮换，前端静默续期 |
| RBAC | 用户-角色-菜单/权限点，接口级 `@RequirePermissions` + 前端 `v-permission` |
| 动态定时任务 | cron 存 DB、代码注册 handler，管理页增删改即时生效，支持分布式锁 |
| 日志 | **只落文件不落库**：每天一个 `app.YYYY-MM-DD.log`，`level` 区分 INFO/WARN/ERROR，`category` 区分 app/access/audit/job，traceId 全链路，敏感字段脱敏，按 `LOG_KEEP_DAYS` 自动清理 |
| 统一规范 | 统一响应 `{code,data,message,traceId}`、全局异常、DTO 强校验、分页基座、Prisma Migrate 迁移 |
| 安全 | helmet 安全头、请求体大小限制、登录限流、refreshToken 重放检测、容器非 root 运行 |
| 性能 | 登录用户权限缓存（变更即时失效），访问日志跳过探活 |
| 可选 Redis | `LOCK_DRIVER=redis|db`，未装 Redis 时自动降级数据库锁 |
| 审计 | 登录（含失败原因）、写操作（`@OperateLog`，成功/失败）、任务执行均写入日志文件；管理端「系统日志 / 登录日志 / 操作日志」按天检索、可下载原文件 |
| 前端 | 菜单→动态路由、路由级权限 + 403 页、按钮 `v-permission`；错误提示分级且带追踪码；路由加载进度条；发版后旧 chunk 自动刷新 |

## 文档

- [架构说明](docs/architecture.md)
- [业务模块开发指南](docs/module-guide.md)
- [定时任务指南](docs/job-guide.md)
- [部署指南](docs/deploy.md)
- [约定](docs/conventions.md)
