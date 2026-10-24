import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { E2E_DB_NAME, setupE2eEnv } from './e2e-env';

/**
 * E2E 全局准备（每个 jest 进程执行一次）：
 *   1. 建库（不存在时）——连 mysql 系统库执行 CREATE DATABASE
 *   2. prisma migrate deploy —— 与生产发布完全一致的迁移方式
 *   3. 种子数据（超管/菜单/默认任务），幂等
 * 数据库与开发库隔离，重复运行无需清理。
 */
export default async function globalSetup(): Promise<void> {
  setupE2eEnv();

  const url = process.env.DATABASE_URL!;
  const admin = new PrismaClient({
    datasources: { db: { url: url.replace(`/${E2E_DB_NAME}`, '/mysql') } },
  });
  await admin.$executeRawUnsafe(
    `CREATE DATABASE IF NOT EXISTS \`${E2E_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.$disconnect();

  const cwd = process.cwd(); // apps/server（jest 由 pnpm --filter 在包目录内启动）
  execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd });
  execSync('npx ts-node src/database/seed.ts', { stdio: 'inherit', cwd });
}
