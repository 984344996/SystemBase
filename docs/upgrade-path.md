# 升级路径（基于本框架的项目如何跟随上游更新）

> 复用型框架的核心问题：改了业务代码的项目，如何安全地吃到上游框架层的修复与优化？
> 答案取决于「框架文件」和「业务文件」的边界是否清晰——本框架的分层设计就是为此服务的。

## 一、文件归属清单

### 框架文件（上游会改，升级时可能被覆盖/需要合并）

| 位置 | 内容 | 升级策略 |
|---|---|---|
| `apps/server/src/core/**` | 守卫/过滤器/拦截器/分页/日志/安全/锁/Redis/指标 | **整体跟随上游**；除非修 bug，不要改动 |
| `apps/server/src/app.module.ts` | 模块注册 | 每加一个业务模块要在 imports 里登记一行（合并点） |
| `apps/server/src/database/seed.ts` | 超管/菜单/权限种子 | 新增业务菜单在 seed 里追加（合并点） |
| `apps/server/prisma/schema.prisma` | 数据模型 | 业务表追加；框架表（User/Role/Menu/JobLog...）结构由上游演进 |
| `apps/web/src/{composables,components,directives,stores,utils,layouts}/**` | usePagedList/TablePager/StatusTag、权限指令、请求封装、布局 | **整体跟随上游** |
| `apps/web/src/views/system/**` | 系统管理页面（用户/角色/菜单/任务/日志...） | 跟随上游，除非有意定制 |
| `apps/web/src/{main.ts,router/index.ts,styles}` | 入口/动态路由/全局样式 | 跟随上游；业务路由在 seed 的菜单数据里配，不进代码 |
| `packages/shared/**` | 前后端同构类型与工具 | 跟随上游；业务共享类型可追加 |
| `deploy/**`、`sb.sh`、`start-local.*`、`scripts/gen-crud.mjs` | 部署运维体系 | 跟随上游 |
| `docs/**`、`CONTRIBUTING.md`、`CHANGELOG.md` | 文档 | 跟随上游 |

### 业务文件（你的项目资产，升级不受影响）

| 位置 | 内容 |
|---|---|
| `apps/server/src/modules/<你的模块>/**` | 业务 controller/service/dto（`example` 模块演示了标准结构，开新项目时删除） |
| `apps/web/src/views/<你的页面>/**` + `apps/web/src/api/<你的模块>.ts` | 业务页面与 API 封装 |
| `schema.prisma` 里你新增的模型 | 业务数据表 |
| `seed.ts` 里你追加的菜单/权限 | 业务菜单树 |
| `apps/server/src/modules/job/` 里注册的 `@JobHandler` | 业务定时任务 |

## 二、升级操作步骤

```bash
# 1. 添加上游（若 fork 自本仓库）并拉取
git remote add upstream <本仓库地址>
git fetch upstream

# 2. 合并到本地分支（推荐 merge 保留双方历史；冲突集中在下面三个合并点）
git merge upstream/master

# 3. 冲突一般只出现在三处，逐个处理：
#    - app.module.ts：imports 列表（你的模块 + 上游新模块都要保留）
#    - seed.ts：菜单数据区（你的菜单 + 上游新增的系统菜单都保留）
#    - schema.prisma：模型区（框架表以上游为准，业务表保留你的）
#
# 4. 迁移 + 验证（一条龙，任何一步红了都不要上线）
pnpm install --frozen-lockfile
pnpm --filter @sb/server prisma:migrate     # 上游若改了框架表结构会生成新迁移
pnpm lint && pnpm test && pnpm build
pnpm --filter @sb/server test:e2e           # 主链路冒烟（E2E 用独立库，不碰开发数据）

# 5. 预发验证后发布
./sb.sh remote-pre deploy
```

## 三、升级前检查清单

- [ ] 读上游 `CHANGELOG.md` 的 Unreleased 段：有没有标记破坏性变更
- [ ] `git diff upstream/master -- apps/server/src/core apps/web/src/composables` 确认框架层差异
- [ ] 上游是否新增了 env 配置项（对照 `*.env.example` 的 diff，缺的补到你的 env 文件）
- [ ] 上游是否新增了 Prisma 迁移（有则 `prisma migrate dev` 后检查业务查询兼容性）

## 四、反模式（会毁掉升级路径）

- ❌ 直接改 `core/` 里的框架代码而不反馈上游——下次合并必然冲突
- ❌ 把业务代码写进 `views/system/` 或 `modules/` 的框架模块里
- ❌ 绕过 `@sb/shared` 在前后端各写一份重复类型
- ❌ 修改 `deploy/server/*.sh`（部署脚本按版本随发布包走，改了会在下次发布被上游版本覆盖）

正确姿势：框架层的问题修在上游（fork 场景提 PR 回本仓库），业务层的问题随意改。
