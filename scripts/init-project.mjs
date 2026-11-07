#!/usr/bin/env node
/**
 * 新项目初始化：fork / 复制本框架后执行一次，把框架名替换成你的项目名，并可清理示例代码。
 *
 * 用法:
 *   node scripts/init-project.mjs --name crm --title "客户管理系统"            预览（默认只打印将要修改的内容）
 *   node scripts/init-project.mjs --name crm --title "客户管理系统" --yes      执行
 * 可选:
 *   --scope crm          包作用域（@sb/* → @crm/*），默认同 --name
 *   --db crm             数据库名前缀（system_base → crm、system_base_pre → crm_pre），默认 --name 中的 - 换成 _
 *   --remove-example     同时删除示例模块（modules/example + app.module 注册 + seed 示例数据区块）
 *   --force              工作区有未提交改动时也执行（默认拒绝，方便出问题后用 git 还原）
 *
 * 替换规则（只处理 git 跟踪的文本文件；跳过 node_modules / dist / 真实 env 文件 / 本脚本）:
 *   @sb/           → @<scope>/        包名与 import 路径（packages/shared、apps/server、apps/web）
 *   system_base    → <db>             数据库名（含 system_base_pre、system_base_e2e 等）
 *   systembase     → <name>           部署目录、APP_NAME、PM2 进程名、Nginx 站点名等默认值
 *   SystemBase     → <title>          界面上的系统名称、文档标题
 * 执行后：pnpm install（包名变了，要重新链接）→ pnpm lint → 按需修改 README
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.relative(ROOT, fileURLToPath(import.meta.url));

// ============================================================
// 一、参数
// ============================================================
const argv = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next && !next.startsWith('--')) { flags.set(key, next); i++; } else flags.set(key, 'true');
}

const name = flags.get('name');
if (!name || flags.has('help')) {
  console.log('用法: node scripts/init-project.mjs --name <项目名> [--title 中文名] [--scope 包作用域] [--db 库名] [--remove-example] [--yes] [--force]');
  process.exit(name ? 0 : 1);
}
if (!/^[a-z][a-z0-9-]*$/.test(name)) die(`--name 只能包含小写字母、数字、连字符（如 crm、order-center），当前: ${name}`);
const scope = flags.get('scope') || name;
if (!/^[a-z][a-z0-9-]*$/.test(scope)) die(`--scope 不合法: ${scope}`);
const db = flags.get('db') || name.replace(/-/g, '_');
if (!/^[a-z][a-z0-9_]*$/.test(db)) die(`--db 只能包含小写字母、数字、下划线，当前: ${db}`);
const title = flags.get('title') || name;
const apply = flags.has('yes');
const removeExample = flags.has('remove-example');

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ============================================================
// 二、前置检查：必须在 git 仓库中，且工作区干净（出问题可 git checkout . 还原）
// ============================================================
function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}
let tracked;
try {
  tracked = git('ls-files', '-z').split('\0').filter(Boolean);
} catch {
  die('需要在 git 仓库中执行（便于出问题时用 git 还原）');
}
if (apply && !flags.has('force') && git('status', '--porcelain', '--untracked-files=no').trim()) {
  die('工作区有未提交的改动，请先提交或暂存（或加 --force）');
}

// ============================================================
// 三、要替换的文件与规则
// ============================================================
/** 不处理的文件：真实环境配置（含密码，不归 git 管但以防万一）、二进制、本脚本 */
const SKIP = [/(^|\/)node_modules\//, /(^|\/)dist\//, /^deploy\/envs\/(?!.*\.example$)/, /\.(png|jpe?g|gif|ico|svg|woff2?|ttf|zip|gz)$/i];
const files = tracked.filter((f) => f !== SELF && !SKIP.some((re) => re.test(f)) && fs.existsSync(path.join(ROOT, f)));

/** 替换规则：顺序有意义（先替换更长的 / 更具体的） */
const RULES = [
  { from: /@sb\//g, to: `@${scope}/`, label: `@sb/ → @${scope}/` },
  { from: /system_base/g, to: db, label: `system_base → ${db}` },
  { from: /systembase/g, to: name, label: `systembase → ${name}` },
  { from: /SystemBase/g, to: title, label: `SystemBase → ${title}` },
];

// ============================================================
// 四、逐个文件替换（预览模式只统计不写入）
// ============================================================
const changed = [];
const counts = new Map(RULES.map((r) => [r.label, 0]));
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue; // 二进制
  let next = text;
  for (const r of RULES) {
    const n = (next.match(r.from) || []).length;
    if (!n) continue;
    counts.set(r.label, counts.get(r.label) + n);
    next = next.replace(r.from, r.to);
  }
  if (next !== text) {
    changed.push(rel);
    if (apply) fs.writeFileSync(abs, next, 'utf8');
  }
}

// ============================================================
// 五、可选：删除示例模块
// ============================================================
const exampleActions = [];
if (removeExample) {
  const exampleDir = 'apps/server/src/modules/example';
  if (fs.existsSync(path.join(ROOT, exampleDir))) exampleActions.push(`删除目录 ${exampleDir}`);
  const appModule = 'apps/server/src/app.module.ts';
  exampleActions.push(`${appModule}：移除 ExampleModule 的 import 与注册`);
  const seed = 'apps/server/src/database/seed.ts';
  exampleActions.push(`${seed}：删除「示例数据」区块`);
  if (apply) {
    fs.rmSync(path.join(ROOT, exampleDir), { recursive: true, force: true });
    const am = path.join(ROOT, appModule);
    fs.writeFileSync(
      am,
      fs
        .readFileSync(am, 'utf8')
        .replace(/^import \{ ExampleModule \} from '\.\/modules\/example\/example\.module';\r?\n/m, '')
        .replace(/^\s*ExampleModule,\r?\n/m, ''),
    );
    const sd = path.join(ROOT, seed);
    const seedText = fs.readFileSync(sd, 'utf8');
    const cleaned = seedText.replace(/\n\s*\/\/ =+ 示例数据（[\s\S]*?\/\/ =+ 示例数据结束 =+\r?\n/, '\n');
    if (cleaned === seedText) console.warn(`⚠ ${seed} 中没找到「示例数据」区块标记，请手动删除示例任务`);
    fs.writeFileSync(sd, cleaned);
  }
}

// ============================================================
// 六、输出结果
// ============================================================
console.log(`\n${apply ? '已完成' : '[预览] 将要执行'}：项目名 ${name}，界面名称「${title}」，包作用域 @${scope}/，数据库 ${db}\n`);
for (const [label, n] of counts) console.log(`  ${label.padEnd(36)} ${n} 处`);
console.log(`  涉及文件 ${changed.length} 个`);
for (const a of exampleActions) console.log(`  ${a}`);
if (!apply) {
  console.log('\n确认无误后加 --yes 执行。文件列表：');
  for (const f of changed) console.log(`    ${f}`);
} else {
  console.log(`
接下来：
  1. pnpm install                 包名变了，重新链接工作区依赖（会更新 pnpm-lock.yaml）
  2. pnpm lint && pnpm test       确认替换后能编译、测试通过
  3. 修改 deploy/envs/*.env 里的 DATABASE_URL / DEPLOY_DIR / APP_NAME（已有的真实 env 文件不会被自动替换）
  4. 按需更新 README.md、CHANGELOG.md，然后提交
出问题可用 git checkout . && git clean -fd 还原`);
}
