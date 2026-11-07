# 框架成熟度差距分析

> 评估视角：把 SystemBase 当作「开新项目直接复用的基础框架」来要求（对标 RuoYi / vben-admin / Soybean Admin 这类成熟后台脚手架）。
> 最近更新：2026-11-07（框架级问题审查后的修复，详见 CHANGELOG「框架审查修复」段）。

---

## 一、已具备的能力

| 维度 | 现状 |
|---|---|
| 部署运维 | 三环境统一入口；init / deploy / rollback / doctor / db-backup；服务器后台发布（断网不中断）、原子切换 + 版本号健康检查 + 失败自动回滚（代码 + 配置 + Nginx）；迁移前自动备份 + 每日定时备份 |
| 安全 | 权限默认拒绝、防提权、JWT 轮换 + 重放检测、改密即时失效、登录失败两层锁定（账号@IP + 账号）+ 验证码、限流、helmet、操作审计、上传类型校验 |
| 多实例 | `LOCK_DRIVER=redis` 后锁、限流计数、登录计数、验证码、权限 / 参数 / 字典缓存失效全部跨实例共享；定时任务每次触发只执行一次；Redis 故障时降级可用且不卡请求 |
| 错误处理 | 业务错误码 `BizCode`（前后端共用 `@sb/shared`）；重复类统一 409 / 40901；Prisma 约束错误集中映射（P2002 / P2025 / P2003 / P2000） |
| 前端框架 | `usePagedList`（竞态保护 + 可取消）、`useCrudForm`、`DictSelect` / `DictTag`（字典缓存）、`IconPicker`、`MenuIcon`（图标按需加载）、多级菜单 + 侧栏折叠 + 面包屑、页面级错误边界、CSV 导出、隐藏菜单页、深色模式（浅色 / 深色 / 跟随系统） |
| 工程化 | pnpm monorepo；ESLint + Prettier + EditorConfig；后端单测 + 覆盖率门 50%、前端 vitest、E2E；CI（lint / 测试 / 构建 / 生成器冒烟 / 脚本检查 / 依赖审计 / E2E）+ Dependabot；pre-commit 卡口；版本号同步脚本 |
| 复用 | `init-project`（改项目名 / 包作用域 / 库名、删示例模块）；`gen-crud`（对齐框架约定，支持 `--dry-run` / `--remove`）；Docker 开发依赖（MySQL + Redis） |
| 可观测性 | traceId 贯穿前后端、按天滚动日志、Prometheus 格式指标、错误日志告警任务、`/api/health/ready` |

---

## 二、仍待补齐（按建议优先级）

### P1：真实项目落地时一定会遇到

| 事项 | 现状 | 建议方向 |
|---|---|---|
| **部门与数据权限** | 只有功能权限（RBAC），没有 Dept 模型，没有「本人 / 本部门 / 全部」数据范围 | 增加部门树 + 用户所属部门 + 角色数据范围；查询层提供统一的数据范围过滤器 |
| **乐观锁与归属审计字段** | 表上没有 `version`，也没有 `createdBy` / `updatedBy` | 新表模板默认带这三个字段；Prisma 扩展自动填充与版本校验（冲突返回 409） |
| **文件存储抽象** | `FileService` 直写本地 `UPLOAD_DIR`；多实例需共享存储 | 抽 `StorageDriver` 接口（local / S3 兼容 / OSS），按配置切换 |
| **审计日志落库或外发** | 登录 / 操作日志只写本机文件，多实例只能查到当前实例 | 可选写库（带保留期）或外发到集中式日志 |

### P2：体验与规模化

| 事项 | 现状 | 建议方向 |
|---|---|---|
| 实时通知 | 公告未读数 60 秒轮询 | SSE（单向推送足够，比 WebSocket 简单），多实例经 EventBus 转发 |
| 国际化 | 全中文硬编码 | 先抽框架自带文案（vue-i18n），业务按需 |
| 多标签页 / keep-alive | 无 | 布局层可选开启 |
| 密码哈希 | `bcryptjs`（纯 JS，占事件循环） | 换原生 `bcrypt` 或 `argon2`（需兼容旧哈希） |
| Excel 导入 | 只有 CSV 导出 | 按需引入 xlsx 解析 + 后端批量校验 |

### P3：生态完备度

| 事项 | 现状 |
|---|---|
| 依赖大版本 | Node 20（2026-04 已停止维护）、NestJS 10、Prisma 5、Vite 5、Pinia 2；`@nestjs/core` 与 `file-type` 两个中危漏洞需升 NestJS 11 才能修 |
| Prettier 存量 | 已提供配置与 `pnpm format`，存量约 80 个文件未统一格式化，未在 CI 强制 |
| Swagger 覆盖 | 接口注解基本齐全；role / menu / job / monitor 的 DTO 缺 `@ApiProperty` |
| 监控配套 | `/api/metrics` 已输出，但没有现成的 Prometheus 告警规则与 Grafana 面板 |
| 灰度 / 零停机发布 | 单实例 fork 模式，每次发布后端有数秒不可用（见 deploy.md） |
| ESLint `any` | 78 处 `no-explicit-any` 警告待收敛 |
