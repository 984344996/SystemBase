import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** E2E 独立数据库（与本机开发库 system_base 隔离，可随时整库删除重建） */
export const E2E_DB_NAME = 'system_base_e2e';

/**
 * E2E 测试环境（幂等，setupFiles 与 globalSetup 都会调用）：
 * - DATABASE_URL：优先 E2E_DATABASE_URL（CI 传 MySQL service 连接串），否则本机 root 免密默认值
 * - 其余给最小合法配置；已存在的环境变量优先（不覆盖）
 */
export function setupE2eEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.E2E_DATABASE_URL || `mysql://root@127.0.0.1:3306/${E2E_DB_NAME}`;

  process.env.JWT_SECRET ||= 'e2e-test-secret-not-for-production';
  process.env.JWT_EXPIRES_IN ||= '2h';
  process.env.JWT_REFRESH_EXPIRES_IN ||= '7d';
  process.env.PERMISSION_CACHE_TTL ||= '30';
  process.env.LOCK_DRIVER ||= 'db'; // 不依赖 Redis
  process.env.THROTTLE_TTL ||= '60';
  process.env.THROTTLE_LIMIT ||= '1000'; // 放宽：E2E 不测限流
  process.env.THROTTLE_LOGIN_LIMIT ||= '1000';
  process.env.LOGIN_FAIL_LOCK_COUNT ||= '0'; // 关闭锁定：E2E 有故意失败的登录用例
  // 用例固定用 admin/admin123 登录：强制覆盖，不受本机 local.env 的 ADMIN_INITIAL_PASSWORD 影响
  process.env.ADMIN_INITIAL_PASSWORD = 'admin123';

  // 日志与上传文件写到临时目录，不污染工作区（上传用例会真实落盘）
  const logDir = join(tmpdir(), 'sb-e2e-logs');
  mkdirSync(logDir, { recursive: true });
  process.env.LOG_DIR ||= logDir;
  const uploadDir = join(tmpdir(), 'sb-e2e-uploads');
  mkdirSync(uploadDir, { recursive: true });
  process.env.UPLOAD_DIR ||= uploadDir;
}
