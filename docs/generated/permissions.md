<!-- ⚠️ 本文件由 scripts/gen-docs.mjs 自动生成，请勿手改；更新方式：pnpm docs:gen -->

# 权限码对照表（自动生成）

来源对照：`database/seed.ts` 中的定义 × 前端 `v-permission` / `hasPerm` 的实际使用。

| 权限码 | seed 定义 | 前端使用 | 状态 |
|---|---|---|---|
| `system:config:create` | ✓ | ConfigList.vue | ✓ |
| `system:config:delete` | ✓ | ConfigList.vue | ✓ |
| `system:config:update` | ✓ | ConfigList.vue | ✓ |
| `system:dict:create` | ✓ | DictList.vue | ✓ |
| `system:dict:delete` | ✓ | DictList.vue | ✓ |
| `system:dict:update` | ✓ | DictList.vue | ✓ |
| `system:file:delete` | ✓ | FileList.vue | ✓ |
| `system:file:download` | ✓ | FileList.vue | ✓ |
| `system:file:upload` | ✓ | FileList.vue | ✓ |
| `system:job:create` | ✓ | JobList.vue | ✓ |
| `system:job:delete` | ✓ | JobList.vue | ✓ |
| `system:job:run` | ✓ | JobList.vue | ✓ |
| `system:job:update` | ✓ | JobList.vue、JobList.vue(hasPerm) | ✓ |
| `system:log:download` | ✓ | LogList.vue | ✓ |
| `system:menu:create` | ✓ | MenuList.vue(hasPerm) | ✓ |
| `system:menu:delete` | ✓ | MenuList.vue(hasPerm) | ✓ |
| `system:menu:update` | ✓ | MenuList.vue(hasPerm) | ✓ |
| `system:notice:create` | ✓ | NoticeList.vue | ✓ |
| `system:notice:delete` | ✓ | NoticeList.vue | ✓ |
| `system:notice:publish` | ✓ | NoticeList.vue | ✓ |
| `system:notice:update` | ✓ | NoticeList.vue | ✓ |
| `system:role:create` | ✓ | RoleList.vue | ✓ |
| `system:role:delete` | ✓ | RoleList.vue | ✓ |
| `system:role:update` | ✓ | RoleList.vue | ✓ |
| `system:user:create` | ✓ | permission.ts、UserList.vue | ✓ |
| `system:user:delete` | ✓ | UserList.vue | ✓ |
| `system:user:resetPwd` | ✓ | UserList.vue | ✓ |
| `system:user:update` | ✓ | UserList.vue | ✓ |

共 28 个权限码：28 个正常使用。
