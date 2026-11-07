#!/usr/bin/env node
/**
 * 校验 prisma/schema.prisma 的语法与模型定义（pnpm lint 调用）。
 *
 * prisma validate 要求环境变量 DATABASE_URL 存在（只检查格式，不会连接数据库）。
 * 全新克隆的仓库、CI 环境里没有 .env，这里在未配置时填一个占位地址，
 * 保证「只校验 schema」这件事不依赖本机配置；已配置时原样使用。
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const env = { ...process.env };
if (!env.DATABASE_URL) env.DATABASE_URL = 'mysql://placeholder:placeholder@127.0.0.1:3306/placeholder';

const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
try {
  execFileSync(bin, ['validate'], { stdio: 'inherit', env, cwd: path.join(__dirname, '..'), shell: process.platform === 'win32' });
} catch {
  process.exit(1);
}
