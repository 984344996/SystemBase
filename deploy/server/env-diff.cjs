#!/usr/bin/env node
/**
 * 对比两份 .env 的键值差异（只输出键名，不打印值，避免泄露密码/密钥）。
 * 由 doctor.sh 调用：期望文件 = 本机 env 剔除部署段后的应用配置，实际文件 = 服务器 shared/.env
 *
 *   node env-diff.cjs <期望文件> <实际文件>
 *
 * 输出：一致项数量 / 值不同的键 / 仅本地有（改了还没发布）/ 仅服务器有
 * 退出码：0 完全一致；2 存在「值不同」或「仅本地有」（提示需要发布）；1 参数或文件错误
 */
'use strict';
const fs = require('node:fs');

/**
 * 最小 dotenv 解析（与 env-tool.cjs 规则一致）：
 * 支持 KEY=VALUE / KEY="VALUE" / KEY='VALUE' / export KEY=VALUE / 行尾 # 注释 / CRLF
 */
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
    const q = v[0];
    if (q === '"' || q === "'") {
      // 带引号：取到配对的引号为止（引号内的 # 不算注释）
      const end = v.indexOf(q, 1);
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      // 不带引号：去掉行尾「空白 + #」开始的注释
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

const changed = []; // 两边都有但值不同
const missing = []; // 仅存在于期望（本地改了还没发布）
const extra = []; // 仅存在于实际（服务器上手工加的）
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
