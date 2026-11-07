#!/usr/bin/env node
/**
 * CRUD 代码生成器：按框架约定一次性生成一个业务模块的前后端骨架（只在本机生成文件，不碰数据库与服务器）。
 *
 * 用法（统一入口）:
 *   ./sb.sh gen-crud <模块名> [--title 中文名] [--perm 权限前缀] [--dir biz] [--force] [--dry-run]
 *   ./sb.sh gen-crud <模块名> --remove [--dir biz]        删除本生成器为该模块生成的文件
 * 例如:
 *   ./sb.sh gen-crud booking --title 预约管理
 *   ./sb.sh gen-crud booking-item --title 预约项 --perm booking:item
 *
 * 生成:
 *   后端 apps/server/src/modules/<name>/{dto,service,controller,module}.ts + service.spec.ts
 *   前端 apps/web/src/api/<name>.ts + views/<dir>/<name>/<Pascal>List.vue
 *
 * 产物遵守的框架约定（见 CONTRIBUTING.md）:
 *   - 后端：每个接口声明 @RequirePermissions（默认拒绝）、Swagger 注解、分页 DTO、
 *           编码唯一「先预检 + withUniqueViolation 兜底」、软删除
 *   - 前端：usePagedList + useCrudForm + TablePager + StatusTag + v-permission + formatTime；
 *           编辑只提交 DTO 白名单字段（后端 forbidNonWhitelisted）；写操作按钮 saving + :loading
 *   - 页面默认放在业务目录 views/biz/（不放进框架目录 views/system/，避免跟随上游升级时冲突）
 *
 * 生成后仍需手动完成三步（脚本会打印片段，不自动改，避免误伤）:
 *   1. schema.prisma 增加模型 → make db-migrate name=add_<表名>
 *   2. app.module.ts 的 imports 注册模块
 *   3. database/seed.ts 增加菜单与权限点
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================
// 一、参数解析：--key value / --flag；其余为位置参数
// ============================================================
const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { flags.set(key, next); i++; } else flags.set(key, 'true');
  } else positional.push(a);
}

const rawName = positional[0];
if (!rawName || rawName === 'help' || rawName === '-h') {
  console.log(`用法: ./sb.sh gen-crud <模块名> [--title 中文名] [--perm 权限前缀] [--dir biz] [--force] [--dry-run]
      ./sb.sh gen-crud <模块名> --remove [--dir biz]

  <模块名>   小写字母/数字/连字符，如 booking、booking-item
  --title    菜单与页面的中文名（默认取模块名）
  --perm     权限码前缀（默认 <模块名去连字符>，权限码形如 <perm>:list）
  --dir      前端页面所在目录（默认 biz，页面路径 /<dir>/<name>；不建议用 system，那是框架目录）
  --force    已存在的文件直接覆盖
  --dry-run  只列出将要生成的文件，不写盘
  --remove   删除本生成器为该模块生成的文件（不会改 schema/app.module/seed）`);
  process.exit(rawName ? 0 : 1);
}

if (!/^[a-z][a-z0-9-]*$/.test(rawName)) {
  console.error(`✗ 模块名不合法: ${rawName}（只允许小写字母、数字、连字符，且以字母开头）`);
  process.exit(1);
}

// 各种命名形式
const name = rawName;                                                   // booking-item（目录/文件名/URL）
const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());  // bookingItem（变量名 / prisma 访问器）
const Pascal = camel[0].toUpperCase() + camel.slice(1);                 // BookingItem（类名 / 模型名）
const title = flags.get('title') || name;
const perm = flags.get('perm') || name.replace(/-/g, '');
const dir = flags.get('dir') || 'biz';
const force = flags.has('force');
const dryRun = flags.has('dry-run');
const remove = flags.has('remove');
const route = `/${dir}/${name}`;
const tableName = name.replace(/-/g, '_');

if (!/^[a-z][a-z0-9-]*$/.test(dir)) {
  console.error(`✗ --dir 不合法: ${dir}（只允许小写字母、数字、连字符）`);
  process.exit(1);
}
if (dir === 'system') {
  console.warn('⚠ --dir system 是框架目录（跟随上游升级时会冲突），业务页面建议放到默认的 biz 目录');
}

// ============================================================
// 二、模板：后端
// ============================================================

// DTO：查询（继承分页）/ 新增 / 编辑。code 允许传 null 表示清空
const dto = `import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Status } from '@sb/shared';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class Query${Pascal}Dto extends PaginationDto {
  @ApiPropertyOptional({ description: '名称/编码模糊匹配' })
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}

export class Create${Pascal}Dto {
  @ApiProperty({ description: '名称' })
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: '编码（唯一，传 null 表示不设置）', nullable: true })
  @IsOptional() @IsString() @MaxLength(50)
  code?: string | null;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}

export class Update${Pascal}Dto extends Create${Pascal}Dto {}
`;

// Service：列表（分页 + 关键字 + 状态）/ 新增 / 编辑 / 软删除
const service = `import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paginate } from '../../core/pagination/paginate';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { Create${Pascal}Dto, Query${Pascal}Dto, Update${Pascal}Dto } from './${name}.dto';

@Injectable()
export class ${Pascal}Service {
  constructor(private readonly prisma: PrismaService) {}

  /** 分页列表：只查未删除的记录 */
  async list(query: Query${Pascal}Dto) {
    return paginate(this.prisma, this.prisma.${camel}, {
      where: {
        deletedAt: null,
        ...(query.keyword
          ? { OR: [{ name: { contains: query.keyword } }, { code: { contains: query.keyword } }] }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
    });
  }

  /** 新增：编码唯一「先预检给出友好提示 + withUniqueViolation 兜底并发写入」 */
  async create(dto: Create${Pascal}Dto) {
    await this.assertCodeFree(dto.code);
    return withUniqueViolation(() => this.prisma.${camel}.create({ data: dto }), \`编码「\${dto.code}」已存在\`);
  }

  /** 编辑：改了编码时同样做唯一校验 */
  async update(id: number, dto: Update${Pascal}Dto) {
    await this.assertExists(id);
    await this.assertCodeFree(dto.code, id);
    return withUniqueViolation(
      () => this.prisma.${camel}.update({ where: { id }, data: dto }),
      \`编码「\${dto.code}」已存在\`,
    );
  }

  /** 软删除（数据保留，列表不再显示） */
  async remove(id: number) {
    await this.assertExists(id);
    await this.prisma.${camel}.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** 记录必须存在且未删除，否则 404 */
  private async assertExists(id: number) {
    const row = await this.prisma.${camel}.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('记录不存在或已删除');
    return row;
  }

  /** 编码未被其他记录占用（excludeId：编辑时排除自己）；编码为空不校验 */
  private async assertCodeFree(code?: string | null, excludeId?: number) {
    if (!code) return;
    const exists = await this.prisma.${camel}.findFirst({
      where: { code, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (exists) throw new BadRequestException(\`编码「\${code}」已存在\`);
  }
}
`;

// Controller：每个接口都声明权限码（框架默认拒绝）+ 操作日志 + Swagger
const controller = `import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { ${Pascal}Service } from './${name}.service';
import { Create${Pascal}Dto, Query${Pascal}Dto, Update${Pascal}Dto } from './${name}.dto';

@ApiTags('${title}')
@ApiBearerAuth('accessToken')
@Controller('${name}s')
export class ${Pascal}Controller {
  constructor(private readonly service: ${Pascal}Service) {}

  @Get()
  @RequirePermissions('${perm}:list')
  @ApiOperation({ summary: '${title}列表（分页）' })
  list(@Query() query: Query${Pascal}Dto) {
    return this.service.list(query);
  }

  @Post()
  @RequirePermissions('${perm}:create')
  @OperateLog({ module: '${title}', action: '新增' })
  @ApiOperation({ summary: '新增${title}' })
  create(@Body() dto: Create${Pascal}Dto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @RequirePermissions('${perm}:update')
  @OperateLog({ module: '${title}', action: '编辑' })
  @ApiOperation({ summary: '编辑${title}' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Update${Pascal}Dto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('${perm}:delete')
  @OperateLog({ module: '${title}', action: '删除' })
  @ApiOperation({ summary: '删除${title}（软删除）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
`;

// Module
const moduleTs = `import { Module } from '@nestjs/common';
import { ${Pascal}Controller } from './${name}.controller';
import { ${Pascal}Service } from './${name}.service';

@Module({
  controllers: [${Pascal}Controller],
  providers: [${Pascal}Service],
  exports: [${Pascal}Service],
})
export class ${Pascal}Module {}
`;

// 单测：不连数据库，用最小桩替身覆盖新增 / 编辑 / 删除的业务分支
const spec = `import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ${Pascal}Service } from './${name}.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessException } from '../../core/filter/business.exception';

/** 最小桩替身 */
const prismaMock = {
  ${camel}: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};

/** 模拟 Prisma 唯一约束冲突（P2002） */
const uniqueError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('${Pascal}Service', () => {
  let service: ${Pascal}Service;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [${Pascal}Service, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(${Pascal}Service);
  });

  it('新增：编码已存在时提示重复', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue({ id: 2, code: 'A' });
    await expect(service.create({ name: 'x', code: 'A' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.${camel}.create).not.toHaveBeenCalled();
  });

  it('新增：并发写入撞唯一约束时转成业务错误码', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue(null);
    prismaMock.${camel}.create.mockRejectedValue(uniqueError);
    await expect(service.create({ name: 'x', code: 'A' })).rejects.toBeInstanceOf(BusinessException);
  });

  it('新增：正常', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue(null);
    prismaMock.${camel}.create.mockResolvedValue({ id: 1, name: 'x' });
    await expect(service.create({ name: 'x' })).resolves.toEqual({ id: 1, name: 'x' });
  });

  it('编辑：记录不存在时抛 404', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue(null);
    await expect(service.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('编辑：正常', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValueOnce({ id: 1, name: 'old' });
    prismaMock.${camel}.update.mockResolvedValue({ id: 1, name: 'new' });
    await expect(service.update(1, { name: 'new' })).resolves.toEqual({ id: 1, name: 'new' });
  });

  it('删除：软删除（写 deletedAt）', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue({ id: 1 });
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(prismaMock.${camel}.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { deletedAt: expect.any(Date) } }),
    );
  });
});
`;

// ============================================================
// 三、模板：前端
// ============================================================

// API 封装：行类型 / 查询参数 / 提交载荷（只含 DTO 字段）
const webApi = `import request from '@/utils/request';
import type { PageResult } from '@sb/shared';

/** 列表行 */
export interface ${Pascal}Item {
  id: number;
  name: string;
  code?: string | null;
  status: string;
  remark?: string | null;
  createdAt: string;
}

/** 查询参数（分页字段必填：与 usePagedList 的约束对齐） */
export interface ${Pascal}Query {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

/** 新增/编辑提交的字段：必须与后端 Create/Update DTO 一致（多传字段会被后端拒绝 400） */
export interface ${Pascal}Payload {
  name: string;
  code?: string | null;
  remark?: string;
  status?: string;
}

export const ${camel}Api = {
  /** signal：列表页切换条件时取消上一次请求（usePagedList 自动传入） */
  list: (params: ${Pascal}Query, signal?: AbortSignal) => request.get<unknown, PageResult<${Pascal}Item>>('/${name}s', { params, signal }),
  create: (data: ${Pascal}Payload) => request.post<unknown, ${Pascal}Item>('/${name}s', data),
  update: (id: number, data: ${Pascal}Payload) => request.put<unknown, ${Pascal}Item>(\`/${name}s/\${id}\`, data),
  remove: (id: number) => request.delete<unknown, { success: boolean }>(\`/${name}s/\${id}\`),
};
`;

// 列表页：查询栏 + 表格 + 分页 + 抽屉表单
const vuePage = `<template>
  <div class="page">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="query.keyword" placeholder="名称/编码" clearable style="width: 200px" @keyup.enter="search" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="启用" value="ENABLED" />
          <el-option label="停用" value="DISABLED" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <div class="spacer" />
        <el-button v-permission="'${perm}:create'" type="primary" @click="openCreate">新增</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="code" label="编码" min-width="140" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'${perm}:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除？" @confirm="onDelete(row)">
              <template #reference>
                <el-button v-permission="'${perm}:delete'" link type="danger" :loading="deletingId === row.id">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>暂无数据</template>
      </el-table>

      <TablePager :query="query" :total="total" :load="load" />
    </el-card>

    <el-drawer v-model="visible" :title="isEdit ? '编辑' : '新增'" size="480px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name"><el-input v-model="form.name" maxlength="50" /></el-form-item>
        <el-form-item label="编码" prop="code"><el-input v-model="form.code" maxlength="50" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, type FormRules } from 'element-plus';
import { ${camel}Api, type ${Pascal}Item, type ${Pascal}Query } from '@/api/${name}';
import { usePagedList } from '@/composables/usePagedList';
import { useCrudForm } from '@/composables/useCrudForm';
import { formatTime } from '@/utils/datetime';

// ---------- 列表：分页/查询/加载统一走 usePagedList（查询自动回到第 1 页；空查询条件由请求层自动去掉） ----------
const { query, rows, total, loading, load, search, reset } = usePagedList<${Pascal}Query, ${Pascal}Item>(
  { page: 1, pageSize: 10, keyword: '', status: '' },
  (q, { signal }) => ${camel}Api.list(q, signal),
);

// ---------- 表单：useCrudForm 负责打开/回填/校验/提交；回填只取 DTO 字段（整行提交会被后端拒绝 400） ----------
const rules: FormRules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};
const { visible, saving, isEdit, form, formRef, openCreate, openEdit, submit } = useCrudForm({
  empty: () => ({ name: '', code: '', remark: '', status: 'ENABLED' }),
  fromRow: (row: ${Pascal}Item) => ({ name: row.name, code: row.code ?? '', remark: row.remark ?? '', status: row.status }),
  // 编码留空提交 null：编辑时可清空编码，也避免空串撞唯一约束
  toPayload: (f) => ({ name: f.name.trim(), code: f.code.trim() || null, remark: f.remark, status: f.status }),
  create: ${camel}Api.create,
  update: ${camel}Api.update,
  onSaved: load,
});

// ---------- 删除：按钮显示 loading，防止重复点击 ----------
const deletingId = ref<number>();
async function onDelete(row: ${Pascal}Item) {
  deletingId.value = row.id;
  try {
    await ${camel}Api.remove(row.id);
    ElMessage.success('已删除');
    load();
  } finally {
    deletingId.value = undefined;
  }
}

onMounted(load);
</script>
`;

// ============================================================
// 四、落盘 / 删除
// ============================================================
const files = [
  [`apps/server/src/modules/${name}/${name}.dto.ts`, dto],
  [`apps/server/src/modules/${name}/${name}.service.ts`, service],
  [`apps/server/src/modules/${name}/${name}.controller.ts`, controller],
  [`apps/server/src/modules/${name}/${name}.module.ts`, moduleTs],
  [`apps/server/src/modules/${name}/${name}.service.spec.ts`, spec],
  [`apps/web/src/api/${name}.ts`, webApi],
  [`apps/web/src/views/${dir}/${name}/${Pascal}List.vue`, vuePage],
];

// 框架自带模块不允许被生成器覆盖或删除
const FRAMEWORK_MODULES = ['auth', 'user', 'role', 'menu', 'job', 'monitor', 'config', 'dict', 'file', 'notice', 'example'];
if (FRAMEWORK_MODULES.includes(name)) {
  console.error(`✗ ${name} 是框架自带模块，不能用生成器生成或删除`);
  process.exit(1);
}

/** --remove：删除生成的文件，并清理随之变空的目录 */
if (remove) {
  console.log(`\n删除模块 ${name} 的生成文件:`);
  for (const [rel] of files) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    if (dryRun) { console.log(`  将删除: ${rel}`); continue; }
    fs.rmSync(file);
    console.log(`  已删除: ${rel}`);
  }
  if (!dryRun) {
    for (const d of [`apps/server/src/modules/${name}`, `apps/web/src/views/${dir}/${name}`]) {
      const abs = path.join(ROOT, d);
      if (fs.existsSync(abs) && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    }
  }
  console.log(`
还需手动撤销（如之前已做过）：
  - app.module.ts 中的 ${Pascal}Module
  - seed.ts 中的「${title}」菜单与 ${perm}:* 权限点（数据库里已有的菜单在菜单管理页删除）
  - schema.prisma 中的 ${Pascal} 模型（已迁移过的表需要再生成一个删除迁移）`);
  process.exit(0);
}

/** 写入单个文件：已存在且未加 --force 时跳过；--dry-run 只打印 */
function write(rel, content) {
  const file = path.join(ROOT, rel);
  const exists = fs.existsSync(file);
  if (exists && !force) {
    console.log(`  跳过（已存在）: ${rel}  —— 需要覆盖请加 --force`);
    return;
  }
  if (dryRun) {
    console.log(`  将${exists ? '覆盖' : '生成'}: ${rel}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`  生成: ${rel}`);
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}生成模块 ${name}（${title}）:`);
for (const [rel, content] of files) write(rel, content);
if (dryRun) process.exit(0);

// ============================================================
// 五、打印需要手动完成的三步
// ============================================================
console.log(`
接下来 3 步（脚本不会自动改）：

1) Prisma 模型 —— apps/server/prisma/schema.prisma 增加：

model ${Pascal} {
  id        Int       @id @default(autoincrement())
  name      String    @db.VarChar(50)
  code      String?   @unique @db.VarChar(50)
  status    String    @default("ENABLED") @db.VarChar(20)
  remark    String?   @db.VarChar(255)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  @@map("${tableName}")
}

   然后: make db-migrate name=add_${tableName}

2) 注册模块 —— apps/server/src/app.module.ts：
   import { ${Pascal}Module } from './modules/${name}/${name}.module';
   并在 imports 中加入 ${Pascal}Module

3) 菜单与权限点 —— apps/server/src/database/seed.ts（业务菜单统一挂在「业务管理」目录下，不放进「系统管理」）：

const biz = await ensureMenu({ parentId: 0, name: '业务管理', type: 'DIRECTORY', path: '/${dir}', icon: 'Briefcase', sort: 10 });
const ${camel}Menu = await ensureMenu({ parentId: biz.id, name: '${title}', type: 'MENU', path: '${route}', component: '${dir}/${name}/${Pascal}List', permission: '${perm}:list', sort: 1 });
await perm(${camel}Menu.id, '新增', '${perm}:create', 1);
await perm(${camel}Menu.id, '编辑', '${perm}:update', 2);
await perm(${camel}Menu.id, '删除', '${perm}:delete', 3);

说明：菜单由后端返回，前端无需改路由；完成后 ./sb.sh local start 即可看到新页面。
撤销本次生成: ./sb.sh gen-crud ${name} --remove${dir !== 'biz' ? ` --dir ${dir}` : ''}
`);
