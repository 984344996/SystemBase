# 业务模块开发指南

本文说明如何基于 SystemBase 框架写一个业务模块。以 `example` 模块为模板（可直接复制改名）。

## 1. 开新项目

```bash
# 删除示例模块
rm -rf apps/server/src/modules/example
# 在 app.module.ts 中移除 ExampleModule 导入
```

## 2. 创建模块骨架

```
modules/booking/
├── booking.module.ts
├── booking.controller.ts
├── booking.service.ts
└── dto/
    ├── create-booking.dto.ts
    └── query-booking.dto.ts
```

## 3. 写代码的三条规则

### 规则一：所有写操作必须 DTO class（强校验）

```ts
// dto/create-booking.dto.ts
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBookingDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  title: string;

  @IsOptional() @Type(() => Number) @IsInt()
  capacity?: number;
}
```

> 框架已开 `whitelist + forbidNonWhitelisted`：未声明字段直接 400，防参数污染。
> **禁止**用 inline 接口（`dto: { title: string }`）做参数类型——校验完全不生效。

### 规则二：接口必须挂权限码，写操作挂审计

```ts
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Get()
  @RequirePermissions('booking:list')        // 与菜单 BUTTON 的 permission 一致
  list(@Query() query: QueryBookingDto) { ... }

  @Post()
  @RequirePermissions('booking:create')
  @OperateLog({ module: '预约管理', action: '创建预约' })   // 自动审计：谁/何时/参数/耗时/traceId
  create(@Body() dto: CreateBookingDto) { ... }
}
```

只读接口不强制挂 `@OperateLog`。

### 规则三：列表一律分页

```ts
export class QueryBookingDto extends PaginationDto {   // 自带 page/pageSize/sort
  @IsOptional() @IsString() keyword?: string;
}

// service
const result = await paginate(this.prisma, this.prisma.booking, {
  where: { deletedAt: null },
  page: query.page,
  pageSize: query.pageSize,
  sort: query.sort,
});
```

## 4. 其他常用能力

| 需求 | 用法 |
|---|---|
| 当前用户 | `@CurrentUser() user: AuthUser` |
| 打日志 | 注入 `AppLogger`：`info / warnFields / errorFields(fields, msg)`，自动带 traceId 写当日日志文件；也可直接用 Nest `new Logger(Ctx.name)`。**不要为日志建表** |
| 业务审计 | 写接口加 `@OperateLog({ module, action })` 即可（成功 INFO / 失败 WARN，参数自动脱敏）；特殊事件用 `logger.audit({ event: 'xxx', ... }, msg, 'warn')` |
| 分布式锁 | `const release = await lock.acquire(key, ttlMs)`（防并发下单/排课）|
| 事务 | `prisma.$transaction([...])` |
| 定时任务 | 见 [job-guide.md](./job-guide.md) |
| 抛业务错误 | `throw new BadRequestException('xxx')` → 自动统一响应结构 |

## 5. 前端页面

1. `apps/web/src/views/<biz>/BookingList.vue` 建页面
2. 菜单管理（或 seed）新增：目录 → 页面菜单（component 填 `biz/BookingList`，permission 填 `booking:list`）→ 按钮权限点（`booking:create` 等）
3. 角色管理里勾选新菜单授权给角色
4. 无需改前端路由代码——动态路由自动注册

按钮级权限二选一（底层同一份权限数据）：

```vue
<!-- 推荐：无权限直接从 DOM 移除，模板更干净 -->
<el-button v-permission="'booking:create'">新增</el-button>
<!-- 满足任一即可 -->
<el-button v-permission="['booking:update', 'booking:reset']">编辑</el-button>

<!-- 需要复杂判断时用函数式 -->
<el-button v-if="auth.hasPerm('booking:create')">新增</el-button>
```

## 6. 数据库变更

```bash
# 改 prisma/schema.prisma 后：生成迁移并应用到本地库，迁移文件随代码提交
make db-migrate name=add_booking
# 生产环境由部署脚本 prisma migrate deploy 自动执行，无需手工操作
```

> 新增菜单/权限点写进 `src/database/seed.ts`（幂等），部署后执行一次 seed 即可。
