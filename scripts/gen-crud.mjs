#!/usr/bin/env node
/**
 * CRUD 代码生成器（./sb.sh gen-crud <模块名> [--title 中文名]）
 *
 * 做了什么（只在本机生成文件，不碰数据库与服务器）：
 *   1. 后端：module / controller / service / dto 骨架（沿用 example 模块写法）
 *   2. 前端：列表页骨架（Element Plus 表格 + 分页 + 查询栏）
 *   3. 测试：service 单测骨架
 *   4. 终端打印：需手动加到 schema.prisma 的模型片段、加到 seed.ts 的菜单与权限点片段
 *
 * 生成后仍需手动做三步（脚本不自动改，避免误伤）：
 *   a. 模型粘进 prisma/schema.prisma → make db-migrate name=<模块>
 *   b. 菜单/权限点粘进 src/database/seed.ts（下次 seed 生效）
 *   c. 在 app.module.ts 的 imports 里注册新模块
 */
/**
 * CRUD 代码生成器（./sb.sh gen-crud <模块名> [--title 中文名]）
 *
 * 做了什么（【只在本机生成文件，不碰数据库与服务器】）：
 *   1. 后端：生成 module / controller / service / dto 骨架（沿用 example 模块的写法）
 *   2. 前端：生成列表页骨架（Element Plus 表格 + 分页 + 查询栏）
 *   3. 测试：生成 service 单测骨架
 *   4. 终端打印：需要你手动加到 prisma/schema.prisma 的模型片段，
 *      以及需要加到 src/database/seed.ts 的菜单与权限点片段
 *
 * 生成后还要做的三步（脚本不会替你做，避免误改）：
 *   a. 把模型粘到 schema.prisma → make db-migrate name=<模块>
 *   b. 把菜单/权限点粘到 seed.ts（或重新 seed 使其生效）
 *   c. 在 app.module.ts 的 imports 里注册新模块
 */
/**
 * CRUD 代码生成器：按现有模块骨架（modules/user）一次性生成业务模块全套文件。
 *
 * 用法（统一入口）:
 *   ./sb.sh gen-crud <模块名> [--title 中文名] [--perm 权限前缀] [--dir system] [--force]
 * 例如:
 *   ./sb.sh gen-crud booking --title 预约管理
 *   ./sb.sh gen-crud booking-item --title 预约项 --perm booking:item
 *
 * 生成:
 *   后端 apps/server/src/modules/<name>/{dto,service,controller,module}.ts + service.spec.ts
 *   前端 apps/web/src/api/<name>.ts + views/<dir>/<name>/<Pascal>List.vue
 * 生成后仍需手动完成（脚本会打印提示）:
 *   1. schema.prisma 增加模型并执行 make db-migrate
 *   2. app.module.ts 注册模块
 *   3. database/seed.ts 增加菜单与权限点（脚本会打印片段）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 参数 ----------
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
  console.log(`用法: ./sb.sh gen-crud <模块名> [--title 中文名] [--perm 权限前缀] [--dir system] [--force]

  <模块名>   小写字母/数字/连字符，如 booking、booking-item
  --title    菜单与页面的中文名（默认取模块名）
  --perm     权限码前缀（默认 <模块名去连字符>，权限码形如 <perm>:list）
  --dir      前端页面所在目录（默认 system，页面路径 /<dir>/<name>）
  --force    已存在的文件直接覆盖`);
  process.exit(rawName ? 0 : 1);
}

if (!/^[a-z][a-z0-9-]*$/.test(rawName)) {
  console.error(`✗ 模块名不合法: ${rawName}（只允许小写字母、数字、连字符，且以字母开头）`);
  process.exit(1);
}

const name = rawName;                                              // booking-item
const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()); // bookingItem
const Pascal = camel[0].toUpperCase() + camel.slice(1);            // BookingItem
const title = flags.get('title') || name;
const perm = flags.get('perm') || name.replace(/-/g, '');
const dir = flags.get('dir') || 'system';
const force = flags.has('force');
const route = `/${dir}/${name}`;
const tableName = name.replace(/-/g, '_');

// ---------- 模板 ----------
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

  @ApiPropertyOptional({ description: '编码（唯一）' })
  @IsOptional() @IsString() @MaxLength(50)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}

export class Update${Pascal}Dto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @ApiPropertyOptional({ enum: [Status.ENABLED, Status.DISABLED] })
  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}
`;

const service = `import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { paginate } from '../../core/pagination/paginate';
import { Create${Pascal}Dto, Query${Pascal}Dto, Update${Pascal}Dto } from './${name}.dto';

@Injectable()
export class ${Pascal}Service {
  constructor(private readonly prisma: PrismaService) {}

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

  async create(dto: Create${Pascal}Dto) {
    if (dto.code) {
      const exists = await this.prisma.${camel}.findFirst({ where: { code: dto.code, deletedAt: null } });
      if (exists) throw new BadRequestException(\`编码「\${dto.code}」已存在\`);
    }
    return this.prisma.${camel}.create({ data: dto });
  }

  async update(id: number, dto: Update${Pascal}Dto) {
    await this.assertExists(id);
    return this.prisma.${camel}.update({ where: { id }, data: dto });
  }

  /** 软删除 */
  async remove(id: number) {
    await this.assertExists(id);
    await this.prisma.${camel}.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  private async assertExists(id: number) {
    const row = await this.prisma.${camel}.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('记录不存在或已删除');
    return row;
  }
}
`;

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

const spec = `import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ${Pascal}Service } from './${name}.service';
import { PrismaService } from '../../core/prisma/prisma.service';

/** 用最小桩替身跑通业务分支（不连数据库） */
const prismaMock = {
  ${camel}: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
};

describe('${Pascal}Service', () => {
  let service: ${Pascal}Service;

  beforeEach(async () => {
    jest.clearAllMocks();
    const mod: TestingModule = await Test.createTestingModule({
      providers: [${Pascal}Service, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(${Pascal}Service);
  });

  it('更新不存在的记录时抛 404', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue(null);
    await expect(service.update(999, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('正常更新', async () => {
    prismaMock.${camel}.findFirst.mockResolvedValue({ id: 1, name: 'old' });
    prismaMock.${camel}.update.mockResolvedValue({ id: 1, name: 'new' });
    await expect(service.update(1, { name: 'new' })).resolves.toEqual({ id: 1, name: 'new' });
  });
});
`;

const webApi = `import request from '@/utils/request';
import type { PageResult } from '@sb/shared';

export interface ${Pascal}Item {
  id: number;
  name: string;
  code?: string | null;
  status: string;
  remark?: string | null;
  createdAt: string;
}

/** 分页字段必填：与 usePagedList 的查询约束对齐 */
export interface ${Pascal}Query {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
}

export type ${Pascal}Payload = Partial<${Pascal}Item>;

export const ${camel}Api = {
  list: (params: ${Pascal}Query) => request.get<any, PageResult<${Pascal}Item>>('/${name}s', { params }),
  create: (data: ${Pascal}Payload) => request.post<any, ${Pascal}Item>('/${name}s', data),
  update: (id: number, data: ${Pascal}Payload) => request.put<any, ${Pascal}Item>(\`/${name}s/\${id}\`, data),
  remove: (id: number) => request.delete<any, { success: boolean }>(\`/${name}s/\${id}\`),
};
`;

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
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'${perm}:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除？" @confirm="onDelete(row)">
              <template #reference>
                <el-button v-permission="'${perm}:delete'" link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>暂无数据</template>
      </el-table>

      <TablePager :query="query" :total="total" :load="load" />
    </el-card>

    <el-drawer v-model="dialog" :title="form.id ? '编辑' : '新增'" size="480px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="编码"><el-input v-model="form.code" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { ${camel}Api, type ${Pascal}Item, type ${Pascal}Query } from '@/api/${name}';
import { usePagedList } from '@/composables/usePagedList';

// 分页/查询/加载统一走 usePagedList（查询自动回到第 1 页）
const { query, rows, total, loading, load, search } = usePagedList<${Pascal}Query, ${Pascal}Item>(
  { page: 1, pageSize: 10, keyword: '', status: '' },
  (q) => ${camel}Api.list(q),
);
const saving = ref(false);
const dialog = ref(false);
const form = reactive<Partial<${Pascal}Item>>({});

function reset() {
  Object.assign(query, { keyword: '', status: '' });
  search();
}

function openCreate() {
  Object.assign(form, { id: undefined, name: '', code: '', remark: '', status: 'ENABLED' });
  dialog.value = true;
}

function openEdit(row: ${Pascal}Item) {
  Object.assign(form, row);
  dialog.value = true;
}

async function submit() {
  saving.value = true;
  try {
    if (form.id) await ${camel}Api.update(form.id, form);
    else await ${camel}Api.create(form);
    ElMessage.success('保存成功');
    dialog.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: ${Pascal}Item) {
  await ${camel}Api.remove(row.id);
  ElMessage.success('已删除');
  load();
}

onMounted(load);
</script>
`;

// ---------- 落盘 ----------
function write(rel, content) {
  const file = path.join(ROOT, rel);
  if (fs.existsSync(file) && !force) {
    console.log(`  跳过（已存在）: ${rel}  —— 需要覆盖请加 --force`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`  生成: ${rel}`);
}

const files = [
  [`apps/server/src/modules/${name}/${name}.dto.ts`, dto],
  [`apps/server/src/modules/${name}/${name}.service.ts`, service],
  [`apps/server/src/modules/${name}/${name}.controller.ts`, controller],
  [`apps/server/src/modules/${name}/${name}.module.ts`, moduleTs],
  [`apps/server/src/modules/${name}/${name}.service.spec.ts`, spec],
  [`apps/web/src/api/${name}.ts`, webApi],
  [`apps/web/src/views/${dir}/${name}/${Pascal}List.vue`, vuePage],
];

console.log(`\n生成模块 ${name}（${title}）:`);
for (const [rel, content] of files) write(rel, content);

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

3) 菜单与权限点 —— apps/server/src/database/seed.ts：

const ${camel}Menu = await ensureMenu({ parentId: system.id, name: '${title}', type: 'MENU', path: '${route}', component: '${dir}/${name}/${Pascal}List', permission: '${perm}:list', sort: 10 });
await perm(${camel}Menu.id, '新增', '${perm}:create', 1);
await perm(${camel}Menu.id, '编辑', '${perm}:update', 2);
await perm(${camel}Menu.id, '删除', '${perm}:delete', 3);

说明：菜单由后端返回，前端无需改路由；完成后 ./sb.sh local start 即可看到新页面。
`);
