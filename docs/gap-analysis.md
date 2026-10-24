# 框架成熟度差距分析

> 评估视角：把 SystemBase 当作「开新项目直接复用的基础框架」来要求（对标 RuoYi / Soybean Admin / Fantastic-admin 这类成熟后台脚手架）。
> 结论先行：**工程与运维链路（部署/回滚/备份/巡检）已达到甚至超过多数同类开源；短板集中在质量保障（测试/CI）、前端框架化（i18n/主题/CRUD 抽象）、以及多实例横向扩展能力**。按「拿去开新项目还缺什么」排序如下。

---

## 0. 已经做对的（不需要补）

| 维度 | 现状 |
|---|---|
| 部署运维 | 三环境统一入口、init/deploy/rollback/doctor/db-backup、原子切换 + 健康检查失败自动回滚、flock 防并发发布——**超出多数同类** |
| 安全 | JWT 轮换 + 重放检测吊销、登录失败锁定 + 验证码、密码强度策略、防用户名枚举（时间抹平）、限流、helmet、操作审计 |
| 可观测性 | traceId 贯穿前后端、按天滚动日志、登录/操作审计、Prometheus 格式指标（零依赖实现）、webhook 告警任务 |
| 工程化 | pnpm monorepo + @sb/shared 同构类型、gen-crud 代码生成、132 个后端单测、pre-commit 卡口、CHANGELOG |
| 框架基建 | RBAC + 动态菜单 + 权限缓存失效、动态定时任务（cron 入库/错过策略/超时/锁）、example 模块演示接入方式 |

---

## A. 质量保障（最大短板）

1. **没有 E2E 测试**。`test/jest-e2e.json` 是空壳；登录→授权→CRUD→回滚这条主链路目前完全靠手工冒烟（每次改完只能 curl 验证）。至少补一组 supertest 冒烟用例（登录、权限拒绝、一个完整 CRUD、健康检查）。
2. **覆盖率未度量**。jest 未配置 `collectCoverage` 与 `coverageThreshold`，auth / permission-cache / job 锁语义这些核心模块的真实覆盖未知——上次优化 `buildTree` 时就是靠类型检查暴露的测试问题，说明覆盖有盲区。
3. **前端零测试**。无 vitest / 组件测试；`usePagedList` 这类 composable 恰恰是最适合单测的纯逻辑。
4. **没有 CI**。删掉 GitHub Actions 改本地卡口后，「推送后的自动验证」缺失：换台机器、贡献者、或忘了跑 pre-commit，质量门就没了。建议恢复一个最小 Actions（lint + test + build），与本地卡口互补。
5. **依赖漏洞零感知**。无 `npm audit` 卡口 / Dependabot / 锁文件许可检查。框架会被复制到很多项目，一个带漏洞的 lockfile 会被扩散。

## B. 前端框架化（作为「框架」最直观的差距）

1. **无 i18n**。全中文硬编码（含后端错误文案），复用到需要双语的项目要全局替换。
2. **无主题/暗色模式**。Element Plus 默认样式 + 散落的色值（虽已收敛部分到全局样式），无 CSS 变量体系。
3. **CRUD 抽象未完成**。列表页三件套（`usePagedList`/`TablePager`/`StatusTag`）已落地，但「弹窗表单」样板 ×8 仍是复制粘贴（`useCrudForm` 上次评估后暂缓）；成熟框架通常一个 `useForm` + schema 配置解决。
4. **表格能力**：无自定义列/列设置记忆、无虚拟滚动（大数据量列表会卡）、无导出 Excel（管理后台高频刚需）。
5. **无响应式适配**：布局按桌面设计，窄屏不可用；至少保证登录页和错误页可用。
6. **无 loading 骨架屏 / 路由级错误边界**：新页面加载是白屏或突兀的表格跳变。

## C. 后端架构

1. **业务错误码缺失**（上次已识别暂缓）：响应 `code` 恒等于 HTTP status，「用户名重复」和「角色编码重复」前端无法区分；`needCaptcha` 现在靠塞进 message 的 hack 传递。需要 `BusinessException(code, message, data)` + 错误码表 + filter 透传。
2. **Redis 连接三处各建**（Lock / PermissionCache），无统一 `RedisModule`；REDIS 降级策略各自为政。
3. **单机假设散落**：
   - 限流（throttler）默认内存计数 → 多实例时每台各算各的，限流形同虚设；
   - 登录失败锁定若也是内存态则同理；
   - `LOCK_DRIVER=db` 的锁依赖 DB 轮询；
   - 文件存本地磁盘 + 各实例不共享。
   需要一份《多实例部署前置条件》文档，或把这三处状态明确迁到 Redis。
4. **文件存储无抽象**：`FileService` 直写本地 `UPLOAD_DIR`，无 storage 接口（本地/OSS/S3 切换）；上云的项目第一个要改的就是这里。
5. **无实时通道**：公告红点、任务执行结果是拉模式（进页面拉一次 / 轮询日志）；无 WebSocket/SSE。成熟后台至少有「在线用户 + 实时通知」。
6. **无数据权限（行级）**：只有功能权限（RBAC），没有「本人/本部门/全部」数据范围；多数管理系统的第二个需求就是它。
7. **无乐观锁与归属审计**：核心表无 `version`，无 `createdBy/updatedBy`——并发覆盖与追责都做不到。

## D. 安全加固（已 70 分，补最后三块）

1. **密码哈希用 bcryptjs**（纯 JS，慢且占主线程事件循环），换 `argon2`（有 prebuilt）或原生 `bcrypt`。
2. **审计日志只写文件**：可被 root 直接修改删除，合规场景需要追加「追加写/外发」策略。
3. **安全响应头细节**：helmet 默认开了，但 CSP（当前同源 + 需要放开 element 图标 CDN 的场景）、`X-Frame-Options` 与子路径部署的组合未文档化。

## E. 运维链路（已很强，补三件事）

1. **发布只有「整切 + 回滚」**，无灰度/蓝绿/按流量切分；单机 PM2 架构下做灰度成本高，至少文档声明「不支持」的边界。
2. **监控只有出口无配套**：`/api/metrics` 输出了 Prometheus 格式，但仓库里没有 prometheus 告警规则文件和 Grafana 面板 JSON（使用者要自己配）。
3. **日志只在本机文件**：多实例/上云后「登录服务器 tail 文件」的方式失效；至少提供 Loki/Journald 的接入说明。

## F. 文档与生态

1. **Swagger 覆盖一半**：config/dict/file/notice 有注解，user/role/menu/auth/job/monitor 全没有——`/api/docs` 打开是半成品。
2. **gen-crud 与新范式未对齐**：生成器模板若还是「手写分页 + el-pagination + hasPerm」旧写法，新项目一生成就把 `usePagedList/TablePager/v-permission` 的统一性破坏掉（生成器是最该先吃到框架层抽象红利的地方）。
3. **无版本与升级策略**：`version` 停在 0.1.0；基于此框架的项目如何跟随上游更新（哪些文件属于「框架」会被覆盖、哪些属于「业务」不动）没有说法——这是复用型框架能否被长期使用的核心。
4. **无 CONTRIBUTING**：约定（事务两种写法何时用哪种、新页面必须用三件套等）都在个人脑子里。

---

## 优先级建议

| 优先级 | 事项 | 理由 |
|---|---|---|
| **P0** | E2E 冒烟 + 恢复最小 CI + jest 覆盖率门 + gen-crud 对齐三件套 | 保护既有成果不被回归；生成器不对齐会让新代码继续发散 |
| **P1** | 业务错误码体系、RedisModule 统一、i18n、暗色主题 | 框架复用的第一道门槛（错误码/i18n 是接手者的第一句吐槽） |
| **P2** | storage 抽象（OSS）、WebSocket 通知、数据权限、多实例前置条件文档 | 真实项目落地时才痛，但一定痛 |
| **P3** | Grafana 面板/告警规则、日志外发说明、CONTRIBUTING、语义化版本 | 生态完备度，锦上添花 |
