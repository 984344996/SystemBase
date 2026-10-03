#!/usr/bin/env node
/**
 * 部署脚本共用的 .env 工具（本机与服务器共用，只依赖 Node 内置模块）。
 * 让 bash / PowerShell 脚本不必各自用正则解析 .env 与 DATABASE_URL。
 *
 *   node env-tool.cjs check <envFile>              校验生产配置，不合格打印原因并退出 1
 *   node env-tool.cjs get   <envFile> <KEY> [默认值] 读取单个变量
 *   node env-tool.cjs db    <envFile>              输出 5 行：host / port / user / password / database
 *   node env-tool.cjs wait-tcp <host> <port> [秒]  等待 TCP 端口可连，超时退出 1
 */
'use strict';
const fs = require('node:fs');
const net = require('node:net');

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

/** 最小 dotenv 解析：KEY=VALUE / KEY="VALUE" / 行尾 # 注释 / CRLF */
function parseEnv(file) {
  if (!fs.existsSync(file)) fail(`找不到配置文件: ${file}`);
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
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

/** 解析失败抛 Error（由调用方决定退出还是汇总） */
function parseDb(url) {
  if (!url) throw new Error('未配置 DATABASE_URL');
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL 格式不正确（密码含 @ : / # 等特殊字符时需 URL 编码）');
  }
  if (u.protocol !== 'mysql:') throw new Error(`DATABASE_URL 必须是 mysql:// 开头，当前为 ${u.protocol}`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL 缺少数据库名（形如 mysql://user:pass@127.0.0.1:3306/system_base）');
  return {
    host: u.hostname,
    port: u.port || '3306',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

const PLACEHOLDER = /请替换|YOUR_|CHANGE_ME|change-me/i;

function check(file) {
  const env = parseEnv(file);
  const problems = [];
  if (env.NODE_ENV !== 'production') problems.push('NODE_ENV 必须为 production');
  try {
    const db = parseDb(env.DATABASE_URL);
    if (PLACEHOLDER.test(db.password) || !db.password) problems.push('DATABASE_URL 中的数据库密码未替换');
  } catch (e) {
    problems.push(e.message);
  }
  const secret = env.JWT_SECRET || '';
  if (secret.length < 16 || PLACEHOLDER.test(secret)) problems.push('JWT_SECRET 必须替换为至少 16 位随机串（建议 32 位以上）');
  if (!env.CORS_ORIGINS || PLACEHOLDER.test(env.CORS_ORIGINS)) problems.push('CORS_ORIGINS 必须填写真实访问地址（如 http://服务器IP 或 https://域名）');
  if (env.PORT && !/^\d+$/.test(env.PORT)) problems.push('PORT 必须为数字');
  if (problems.length) fail(`${file} 配置不合格：\n  - ${problems.join('\n  - ')}`);
  process.stdout.write('ok\n');
}

function waitTcp(host, port, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  const attempt = () => {
    const sock = net.connect({ host, port: Number(port) });
    sock.setTimeout(1000);
    sock.once('connect', () => {
      sock.destroy();
      process.exit(0);
    });
    const retry = () => {
      sock.destroy();
      if (Date.now() >= deadline) process.exit(1);
      setTimeout(attempt, 1000);
    };
    sock.once('error', retry);
    sock.once('timeout', retry);
  };
  attempt();
}

const [cmd, a, b, c] = process.argv.slice(2);
switch (cmd) {
  case 'check':
    check(a);
    break;
  case 'get': {
    const v = parseEnv(a)[b];
    process.stdout.write(`${v === undefined || v === '' ? (c ?? '') : v}\n`);
    break;
  }
  case 'db': {
    let d;
    try {
      d = parseDb(parseEnv(a).DATABASE_URL);
    } catch (e) {
      fail(e.message);
    }
    process.stdout.write([d.host, d.port, d.user, d.password, d.database].join('\n') + '\n');
    break;
  }
  case 'wait-tcp':
    waitTcp(a, b, Number(c || 15));
    break;
  default:
    fail('用法: env-tool.cjs check|get|db|wait-tcp ...');
}
