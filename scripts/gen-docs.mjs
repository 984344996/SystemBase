#!/usr/bin/env node
/**
 * 文档自动化生成：从源码提取「事实」生成参考文档，杜绝手写清单与代码漂移。
 *
 *   node scripts/gen-docs.mjs        （或 pnpm docs:gen）
 *
 * 产出（docs/generated/，文件头带勿手改标记）：
 *   1. module-map.md    模块地图：后端各模块的路由 / 权限码 / 服务方法
 *   2. permissions.md   权限码对照表：seed 定义 × 前端使用，孤儿码/未定义码一目了然
 *
 * CI 中运行后会用 git diff 检测漂移：源码改了但没重新生成文档会让 CI 失败，
 * 提醒提交者跑一次 pnpm docs:gen。
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
mkdirSync(join(ROOT, 'docs/generated'), { recursive: true });

/** 内容不变则不写（保持 git diff 稳定，CI 漂移检测依赖这一点；文档内不放生成时间戳同理） */
function writeIfChanged(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) {
    console.log(`= ${file.replace(ROOT, '')}（无变化，跳过写入）`);
    return;
  }
  writeFileSync(file, content);
}
const HEADER = (title) =>
  `<!-- ⚠️ 本文件由 scripts/gen-docs.mjs 自动生成，请勿手改；更新方式：pnpm docs:gen -->\n\n# ${title}\n`;

// ---------- 工具 ----------
function walk(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.includes(extname(name))) acc.push(p);
  }
  return acc;
}
const read = (p) => readFileSync(p, 'utf8');

// ---------- 1. 后端模块地图 ----------
const MODULES_DIR = join(ROOT, 'apps/server/src/modules');
const modules = [];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'async']);

for (const name of readdirSync(MODULES_DIR)) {
  const dir = join(MODULES_DIR, name);
  if (!statSync(dir).isDirectory()) continue;

  const mod = { name, routes: [], serviceMethods: [] };
  const controller = walk(dir, ['.ts']).find((p) => p.endsWith('.controller.ts'));
  if (controller) {
    const src = read(controller);
    mod.controller = basename(controller);
    mod.base = src.match(/@Controller\('([^']*)'\)/)?.[1] ?? '';
    // 逐段扫描：装饰器行（HTTP 动词 + 权限 + summary）与其后的方法签名行
    const lines = src.split('\n');
    let pending = null;
    for (const line of lines) {
      // 兼容 @Get()（无参数）与 @Get(':id') 两种形式
      const m = line.match(/^\s*@(Get|Post|Put|Delete|Patch)(?:\(\s*(?:'([^']*)')?\s*\))?\s*$/);
      if (m) {
        pending = { method: m[1].toUpperCase(), path: m[2] ?? '' };
        continue;
      }
      if (!pending) continue;
      if (/^\s*@Public\(/.test(line)) pending.isPublic = true;
      const perm = line.match(/@RequirePermissions\('([^']+)'\)/);
      if (perm) pending.perm = perm[1];
      const summ = line.match(/@ApiOperation\(\{ summary: '([^']+)' \}\)/);
      if (summ) pending.summary = summ[1];
      // 方法签名行：不以 @ 开头、是「函数名(」形式、且不是关键字（参数里的 @Body 等装饰器不影响）
      const fn = line.match(/^\s*(?:async\s+)?(\w+)\s*\(/);
      if (fn && !/^\s*@/.test(line) && !KEYWORDS.has(fn[1])) {
        pending.action = fn[1];
        mod.routes.push(pending);
        pending = null;
      }
    }
  }

  const service = walk(dir, ['.ts']).find((p) => p.endsWith('.service.ts'));
  if (service) {
    const src = read(service);
    for (const m of src.matchAll(/^\s*(?:\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*)?(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\([^)]*\)[^{]*\{\s*$/gm)) {
      if (!KEYWORDS.has(m[1])) mod.serviceMethods.push(m[1]);
    }
  }
  modules.push(mod);
}

let map = HEADER('模块地图（自动生成）');
map += `\n后端业务模块清单（\`apps/server/src/modules/\`），路由与权限码直接提取自 controller 源码。\n\n`;
for (const mod of modules.sort((a, b) => a.name.localeCompare(b.name))) {
  map += `## ${mod.name}\n\n`;
  if (mod.routes.length) {
    map += `| HTTP | 路径 | 权限码 | 说明 |\n|---|---|---|---|\n`;
    for (const r of mod.routes) {
      const access = r.perm ? `\`${r.perm}\`` : r.isPublic ? '公开' : '登录即可';
      map += `| ${r.method} | /api/${mod.base}${r.path ? `/${r.path.replace(/^\//, '')}` : ''} | ${access} | ${r.summary ?? r.action ?? ''} |\n`;
    }
    map += `\n`;
  }
  if (mod.serviceMethods.length) {
    map += `Service 方法：${mod.serviceMethods.map((m) => `\`${m}()\``).join('、')}\n\n`;
  }
}
writeIfChanged(join(ROOT, 'docs/generated/module-map.md'), map);

// ---------- 2. 权限码对照表 ----------
const seedPerms = new Set();
// seed 的 perm(menuId, '名称', 'system:xxx:yyy', sort) —— 权限码是第三个参数
for (const m of read(join(ROOT, 'apps/server/src/database/seed.ts')).matchAll(/perm\([^,]+,[^,]+,\s*'([^']+)'/g)) {
  seedPerms.add(m[1]);
}

const frontendUsage = new Map(); // code -> [文件:行]
for (const file of walk(join(ROOT, 'apps/web/src'), ['.vue', '.ts'])) {
  const src = read(file);
  for (const m of src.matchAll(/v-permission="'([^']+)'"/g)) {
    const key = m[1];
    frontendUsage.set(key, [...(frontendUsage.get(key) ?? []), basename(file)]);
  }
  for (const m of src.matchAll(/hasPerm\('([^']+)'\)/g)) {
    const key = m[1];
    frontendUsage.set(key, [...(frontendUsage.get(key) ?? []), `${basename(file)}(hasPerm)`]);
  }
}

const allCodes = new Set([...seedPerms, ...frontendUsage.keys()]);
let permDoc = HEADER('权限码对照表（自动生成）');
permDoc += `\n来源对照：\`database/seed.ts\` 中的定义 × 前端 \`v-permission\` / \`hasPerm\` 的实际使用。\n\n`;
permDoc += `| 权限码 | seed 定义 | 前端使用 | 状态 |\n|---|---|---|---|\n`;
let okCount = 0;
const problems = [];
for (const code of [...allCodes].sort()) {
  const defined = seedPerms.has(code);
  const used = frontendUsage.get(code) ?? [];
  const usedStr = used.length ? [...new Set(used)].join('、') : '-';
  let status;
  if (defined && used.length) {
    status = '✓';
    okCount++;
  } else if (defined) {
    status = '⚠ 已定义未使用（保留给 API 调用方或后续页面）';
    problems.push(code);
  } else {
    status = '✗ 前端在用但 seed 未定义（权限将永远不生效！）';
    problems.push(code);
  }
  permDoc += `| \`${code}\` | ${defined ? '✓' : '✗'} | ${usedStr} | ${status} |\n`;
}
permDoc += `\n共 ${allCodes.size} 个权限码：${okCount} 个正常使用。\n`;
if (problems.length) {
  permDoc += `\n> 需要处理 ${problems.length} 个：${problems.map((p) => `\`${p}\``).join('、')}\n`;
}
writeIfChanged(join(ROOT, 'docs/generated/permissions.md'), permDoc);
console.log(`✓ 权限码：${allCodes.size} 个，待处理 ${problems.length} 个`);
