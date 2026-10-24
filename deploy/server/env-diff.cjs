#!/usr/bin/env node
/**
 * 对比两份 .env 的键值差异（不打印值，避免泄露密码/密钥）。
 *   node env-diff.cjs <期望文件> <实际文件>
 * 输出：仅修改=值不同 / 仅存在于期望=待发布 / 仅存在于实际=服务器独有 / 一致项数量
 */
'use strict';
const fs = require('node:fs');

function parse(file) {
  if (!fs.existsSync(file)) {
    console.error(`找不到文件: ${file}`);
    process.exit(1);
  }
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = v[0];admin
    if (q === '"' || q === "'") {
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      v = v.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = v;
  }
  return out;
}

const [expectFile, actualFile] = process.argv.slice(2);
if (!expectFile || !actualFile) {
  console.error('用法: env-diff.cjs <期望文件> <实际文件>');
  process.exit(1);
}

const expect = parse(expectFile);
const actual = parse(actualFile);
const keys = [...new Set([...Object.keys(expect), ...Object.keys(actual)])].sort();

const changed = [];
const missing = []; // 仅存在于期望（本地改了还没发）
const extra = []; // 仅存在于实际（服务器独有）
let same = 0;

for (const k of keys) {
  const inE = k in expect;
  const inA = k in actual;
  if (inE && inA) {
    if (expect[k] === actual[k]) same++;
    else changed.push(k);
  } else if (inE) missing.push(k);
  else extra.push(k);
}

const line = (arr) => (arr.length ? arr.join(', ') : '（无）');
console.log(`一致: ${same} 项`);
console.log(`值不同: ${line(changed)}`);
console.log(`仅本地有（未发布）: ${line(missing)}`);
console.log(`仅服务器有: ${line(extra)}`);
// 存在差异时退出 2，便于脚本提示（非错误，仅提示）
process.exit(changed.length || missing.length ? 2 : 0);
