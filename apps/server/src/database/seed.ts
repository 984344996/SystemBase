/**
 * 种子数据：超管账号、超管角色、系统管理菜单树、两个默认定时任务。
 * 幂等：可重复执行（只补缺失项，不覆盖已有数据）。
 *
 * 放在 src/ 下随 nest build 一起编译，生产环境无需 ts-node：
 *   开发：pnpm --filter @sb/server prisma:seed   (ts-node src/database/seed.ts)
 *   生产：node dist/database/seed.js
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 独立运行（不经过 Nest ConfigModule）时自行加载 cwd 下的 .env；已存在的环境变量优先（外部注入）。
 * pnpm 下 Prisma Client 生成在 .pnpm 目录，不会自动找到 apps/server/.env。
 */
function loadDotEnv(file = join(process.cwd(), '.env')): void {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(raw);
    if (!m || m[1] in process.env) continue;
    let v = m[2].trim();
    const q = v[0];
    if (q === '"' || q === "'") {
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    process.env[m[1]] = v;
  }
}
loadDotEnv();

/** 超管初始密码：.env 的 ADMIN_INITIAL_PASSWORD，未配置时为 admin123 */
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'admin123';

const prisma = new PrismaClient();

async function ensureMenu(data: {
  parentId: number;
  name: string;
  type: string;
  path?: string;
  component?: string;
  permission?: string;
  icon?: string;
  sort: number;
}) {
  const existing = await prisma.menu.findFirst({
    where: { parentId: data.parentId, name: data.name, type: data.type },
  });
  if (existing) return existing;
  return prisma.menu.create({ data });
}

/** 幂等：字典类型存在则不改，只补齐缺失的字典项 */
async function ensureDict(code: string, name: string, items: { label: string; value: string; sort: number }[]) {
  const dict = await prisma.dict.upsert({
    where: { code },
    update: {},
    create: { code, name },
  });
  for (const it of items) {
    await prisma.dictItem.upsert({
      where: { dictId_value: { dictId: dict.id, value: it.value } },
      update: {},
      create: { dictId: dict.id, ...it },
    });
  }
  return dict;
}

/** 幂等：内置参数只创建不覆盖（避免每次发布重置用户改过的配置） */
async function ensureConfig(data: {
  key: string;
  value: string;
  type: string;
  group: string;
  label: string;
  builtin: boolean;
  remark?: string;
}) {
  const exists = await prisma.sysConfig.findUnique({ where: { key: data.key } });
  if (exists) return exists;
  return prisma.sysConfig.create({ data });
}

async function main() {
  // ---------- 超管角色 ----------
  const superRole = await prisma.role.upsert({
    where: { code: 'SUPER_ADMIN' },
    update: {},
    create: { code: 'SUPER_ADMIN', name: '超级管理员', remark: '拥有全部权限' },
  });

  // ---------- 菜单树 ----------
  await ensureMenu({ parentId: 0, name: '仪表盘', type: 'MENU', path: '/dashboard', component: 'dashboard/Dashboard', icon: 'Odometer', sort: 1 });
  const system = await ensureMenu({ parentId: 0, name: '系统管理', type: 'DIRECTORY', path: '/system', icon: 'Setting', sort: 99 });

  const perm = async (parentId: number, name: string, permission: string, sort: number) =>
    ensureMenu({ parentId, name, type: 'BUTTON', permission, sort });

  const userMenu = await ensureMenu({ parentId: system.id, name: '用户管理', type: 'MENU', path: '/system/user', component: 'system/user/UserList', permission: 'system:user:list', sort: 1 });
  await perm(userMenu.id, '新增用户', 'system:user:create', 1);
  await perm(userMenu.id, '编辑用户', 'system:user:update', 2);
  await perm(userMenu.id, '删除用户', 'system:user:delete', 3);
  await perm(userMenu.id, '重置密码', 'system:user:resetPwd', 4);

  const roleMenu = await ensureMenu({ parentId: system.id, name: '角色管理', type: 'MENU', path: '/system/role', component: 'system/role/RoleList', permission: 'system:role:list', sort: 2 });
  await perm(roleMenu.id, '新增角色', 'system:role:create', 1);
  await perm(roleMenu.id, '编辑角色', 'system:role:update', 2);
  await perm(roleMenu.id, '删除角色', 'system:role:delete', 3);

  const menuMenu = await ensureMenu({ parentId: system.id, name: '菜单管理', type: 'MENU', path: '/system/menu', component: 'system/menu/MenuList', permission: 'system:menu:list', sort: 3 });
  await perm(menuMenu.id, '新增菜单', 'system:menu:create', 1);
  await perm(menuMenu.id, '编辑菜单', 'system:menu:update', 2);
  await perm(menuMenu.id, '删除菜单', 'system:menu:delete', 3);

  const jobMenu = await ensureMenu({ parentId: system.id, name: '定时任务', type: 'MENU', path: '/system/job', component: 'system/job/JobList', permission: 'system:job:list', sort: 4 });
  await perm(jobMenu.id, '新增任务', 'system:job:create', 1);
  await perm(jobMenu.id, '编辑任务', 'system:job:update', 2);
  await perm(jobMenu.id, '删除任务', 'system:job:delete', 3);
  await perm(jobMenu.id, '手动执行', 'system:job:run', 4);

  // 日志类页面：数据全部来自日志文件，只读（保留期由 LOG_KEEP_DAYS 控制）
  const logMenu = await ensureMenu({ parentId: system.id, name: '系统日志', type: 'MENU', path: '/system/log', component: 'system/log/LogList', permission: 'system:log:list', icon: 'Document', sort: 5 });
  await perm(logMenu.id, '下载日志', 'system:log:download', 1);
  await ensureMenu({ parentId: system.id, name: '登录日志', type: 'MENU', path: '/system/login-log', component: 'system/login-log/LoginLogList', permission: 'system:loginlog:list', icon: 'User', sort: 6 });
  await ensureMenu({ parentId: system.id, name: '操作日志', type: 'MENU', path: '/system/operate-log', component: 'system/operate-log/OperateLogList', permission: 'system:operatelog:list', icon: 'Tickets', sort: 7 });

  // 系统参数：运行时可改（不必改 env 重启）
  const configMenu = await ensureMenu({ parentId: system.id, name: '系统参数', type: 'MENU', path: '/system/config', component: 'system/config/ConfigList', permission: 'system:config:list', icon: 'Tools', sort: 8 });
  await perm(configMenu.id, '新增参数', 'system:config:create', 1);
  await perm(configMenu.id, '修改参数', 'system:config:update', 2);
  await perm(configMenu.id, '删除参数', 'system:config:delete', 3);

  // 数据字典：下拉选项统一来源
  const dictMenu = await ensureMenu({ parentId: system.id, name: '数据字典', type: 'MENU', path: '/system/dict', component: 'system/dict/DictList', permission: 'system:dict:list', icon: 'Collection', sort: 9 });
  await perm(dictMenu.id, '新增字典', 'system:dict:create', 1);
  await perm(dictMenu.id, '编辑字典', 'system:dict:update', 2);
  await perm(dictMenu.id, '删除字典', 'system:dict:delete', 3);

  // 文件管理：上传/下载均需权限（下载走接口鉴权，不暴露静态目录）
  const fileMenu = await ensureMenu({ parentId: system.id, name: '文件管理', type: 'MENU', path: '/system/file', component: 'system/file/FileList', permission: 'system:file:list', icon: 'Folder', sort: 10 });
  await perm(fileMenu.id, '上传文件', 'system:file:upload', 1);
  await perm(fileMenu.id, '下载文件', 'system:file:download', 2);
  await perm(fileMenu.id, '删除文件', 'system:file:delete', 3);

  // 通知公告
  const noticeMenu = await ensureMenu({ parentId: system.id, name: '通知公告', type: 'MENU', path: '/system/notice', component: 'system/notice/NoticeList', permission: 'system:notice:list', icon: 'Bell', sort: 11 });
  await perm(noticeMenu.id, '新增公告', 'system:notice:create', 1);
  await perm(noticeMenu.id, '编辑公告', 'system:notice:update', 2);
  await perm(noticeMenu.id, '发布公告', 'system:notice:publish', 3);
  await perm(noticeMenu.id, '删除公告', 'system:notice:delete', 4);

  // 已废弃的权限点（日志不再落库，不提供清理）：旧库升级时移除
  await prisma.menu.deleteMany({ where: { permission: { in: ['system:loginlog:delete', 'system:operatelog:delete'] } } });

  // ---------- 演示公告（幂等，只创建一次）----------
  const demoNotice = await prisma.notice.findFirst({ where: { title: '欢迎使用 SystemBase' } });
  if (!demoNotice) {
    await prisma.notice.create({
      data: {
        title: '欢迎使用 SystemBase',
        content: '这里是公告中心：支持置顶、有效期与已读记录。发布后所有登录用户可见，顶栏铃铛显示未读数量。',
        type: 'NOTICE',
        top: true,
        status: 'PUBLISHED',
        publisherId: null,
      },
    });
  }

  // ---------- 内置字典 ----------
  await ensureDict('common_status', '通用状态', [
    { label: '启用', value: 'ENABLED', sort: 1 },
    { label: '停用', value: 'DISABLED', sort: 2 },
  ]);

  // ---------- 内置系统参数 ----------
  await ensureConfig({ key: 'login.captcha', value: 'off', type: 'STRING', group: 'security', label: '登录验证码（off/auto/on）', builtin: true, remark: '与环境变量 LOGIN_CAPTCHA 一致；此处优先级更高时在业务里读取' });
  await ensureConfig({ key: 'site.name', value: 'SystemBase', type: 'STRING', group: 'base', label: '站点名称', builtin: true });

  // ---------- 超管账号 ----------
  // 初始密码取 .env 的 ADMIN_INITIAL_PASSWORD（默认 admin123）；只在账号不存在时生效，已存在不覆盖
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      name: '超级管理员',
      password: await bcrypt.hash(ADMIN_INITIAL_PASSWORD, 10),
      remark: '内置超管；最后一个启用的超管不可禁用/删除',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
    update: {},
    create: { userId: admin.id, roleId: superRole.id },
  });

  // ---------- 默认定时任务 ----------
  await prisma.job.upsert({
    where: { name: '系统数据清理' },
    update: {},
    create: {
      name: '系统数据清理',
      handlerKey: 'system.cleanup',
      cronExpr: '0 * * * *',
      misfirePolicy: 'SKIP',
      timeoutSec: 120,
      status: 'ENABLED',
      remark: '清理过期锁/过期刷新令牌（日志文件按 LOG_KEEP_DAYS 自动清理）',
    },
  });
  await prisma.job.upsert({
    where: { name: '示例-每日问候' },
    update: {},
    create: {
      name: '示例-每日问候',
      handlerKey: 'example.hello',
      cronExpr: '0 3 * * *',
      params: { from: 'SystemBase' },
      misfirePolicy: 'SKIP',
      timeoutSec: 30,
      status: 'ENABLED',
      remark: '示例任务，可删除',
    },
  });

  console.log('✅ 种子数据完成：超管 admin（初始密码 ADMIN_INITIAL_PASSWORD），菜单与默认任务已初始化');
}

// 仅在直接执行时运行，被 import 时不产生副作用
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
