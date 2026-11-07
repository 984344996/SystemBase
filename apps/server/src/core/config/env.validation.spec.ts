import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateEnv } from './env.validation';

/** 最小 dotenv 解析（与 deploy/server/env-tool.cjs 规则一致） */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    let v = m[2].trim();
    if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1, v.indexOf(v[0], 1));
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** 合法的最小配置（开发环境） */
const base = { NODE_ENV: 'development', DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/db' };

describe('validateEnv', () => {
  it('最小配置通过，并填充默认值', () => {
    const env = validateEnv({ ...base });
    expect(env).toMatchObject({ PORT: '3000', TRUST_PROXY: 'false', LOCK_DRIVER: 'db', BODY_LIMIT: '1mb' });
    expect(env.JWT_SECRET).toBeTruthy(); // 开发环境回退开发密钥
  });

  it('KEY= 留空视为未配置，不按格式校验', () => {
    expect(() => validateEnv({ ...base, UPLOAD_MAX_SIZE: '', LOG_ALERT_WEBHOOK: '', PORT: '' })).not.toThrow();
  });

  it.each([
    ['UPLOAD_MAX_SIZE', '10MB'],
    ['JOB_RECONCILE_SECONDS', '1m'],
    ['LOCK_DRIVER', 'memcache'],
    ['TRUST_PROXY', 'yes'],
    ['CLIENT_LOG_ENABLED', 'enabled'],
    ['LOG_ALERT_WEBHOOK', 'not-a-url'],
    ['PORT', 'abc'],
  ])('%s=%s 格式错误时启动失败', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(key);
  });

  it('生产环境必须配置足够长的 JWT_SECRET 与 CORS_ORIGINS', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/JWT_SECRET[\s\S]*CORS_ORIGINS/);
  });

  // 仓库里的 env 模板（以及本机存在的真实 env 文件）必须能通过校验：防止新增校验规则后已有环境启动失败
  const envDir = join(__dirname, '../../../../../deploy/envs');
  const files = ['local.env.example', 'remote.env.example', 'local.env', 'remote-pre.env', 'remote-release.env']
    .map((f) => join(envDir, f))
    .filter((f) => existsSync(f));
  it.each(files)('env 文件可通过校验: %s', (file) => {
    const env = parseEnvFile(file);
    // 模板里的占位密钥/地址不属于本测试范围，用合法值替换
    if (!env.JWT_SECRET || /请替换|YOUR_|CHANGE_ME/i.test(env.JWT_SECRET)) env.JWT_SECRET = 'x'.repeat(32);
    if (!env.CORS_ORIGINS) env.CORS_ORIGINS = 'http://localhost';
    expect(() => validateEnv(env)).not.toThrow();
  });
});
