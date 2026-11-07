#!/usr/bin/env node
/**
 * 发版：统一修改全部包的版本号，并把 CHANGELOG 的 Unreleased 段落改成该版本。
 *
 *   node scripts/bump-version.mjs 0.3.0          修改版本号 + CHANGELOG
 *   node scripts/bump-version.mjs 0.3.0 --tag    同时创建 git 提交与 tag（v0.3.0）
 *
 * 版本规则（语义化版本）：破坏性变更升 major、新功能升 minor、只修 bug 升 patch。
 * 所有包（根、apps/*、packages/*）始终保持同一个版本号。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [version, ...rest] = process.argv.slice(2);
const tag = rest.includes('--tag');

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error('用法: node scripts/bump-version.mjs <x.y.z> [--tag]');
  process.exit(1);
}

// ---------- 1. 全部 package.json ----------
const pkgFiles = ['package.json'];
for (const dir of ['apps', 'packages']) {
  for (const d of fs.readdirSync(path.join(ROOT, dir))) {
    const f = path.join(dir, d, 'package.json');
    if (fs.existsSync(path.join(ROOT, f))) pkgFiles.push(f);
  }
}
for (const f of pkgFiles) {
  const abs = path.join(ROOT, f);
  const text = fs.readFileSync(abs, 'utf8');
  // 只替换 version 字段，保留原有格式
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  fs.writeFileSync(abs, next);
  console.log(`  ${f} → ${version}`);
}

// ---------- 2. CHANGELOG：Unreleased → 版本号 + 日期，并留一个新的 Unreleased ----------
const changelog = path.join(ROOT, 'CHANGELOG.md');
if (fs.existsSync(changelog)) {
  const text = fs.readFileSync(changelog, 'utf8');
  if (/^## Unreleased\s*$/m.test(text)) {
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(changelog, text.replace(/^## Unreleased\s*$/m, `## Unreleased\n\n## ${version}（${today}）`));
    console.log(`  CHANGELOG.md：Unreleased → ${version}`);
  } else {
    console.warn('  ⚠ CHANGELOG.md 中没有「## Unreleased」段落，未修改');
  }
}

// ---------- 3. 可选：提交并打 tag ----------
if (tag) {
  execFileSync('git', ['add', ...pkgFiles, 'CHANGELOG.md'], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', `chore: release v${version}`], { cwd: ROOT, stdio: 'inherit' });
  execFileSync('git', ['tag', `v${version}`], { cwd: ROOT, stdio: 'inherit' });
  console.log(`\n已提交并创建 tag v${version}，推送: git push && git push origin v${version}`);
} else {
  console.log(`\n检查无误后提交；打 tag: git tag v${version}`);
}
