import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Matches, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvVariables {
  @IsEnum(NodeEnv) @IsOptional() NODE_ENV?: NodeEnv;
  @IsString() DATABASE_URL!: string;
  @IsString() @IsOptional() JWT_SECRET?: string;
  @IsString() @IsOptional() JWT_EXPIRES_IN?: string;
  @IsString() @IsOptional() JWT_REFRESH_EXPIRES_IN?: string;
  @Matches(/^\d+$/, { message: 'PORT 需为端口号' }) @IsOptional() PORT?: string;
  // 信任的反向代理跳数（经 Nginx 单层反代填 1）/ true / false；默认 false（不信任 X-Forwarded-For）
  @Matches(/^(\d+|true|false)$/, { message: 'TRUST_PROXY 为代理跳数（如 1）或 true / false' }) @IsOptional() TRUST_PROXY?: string;
  @IsString() @IsOptional() CORS_ORIGINS?: string;
  @IsIn(['db', 'redis']) @IsOptional() LOCK_DRIVER?: string;
  @IsString() @IsOptional() REDIS_URL?: string;
  // Redis 键名前缀（默认 sb:）：多个环境/项目共用一个 Redis 时用来隔离
  @Matches(/^[\w:.-]{1,32}$/, { message: 'REDIS_KEY_PREFIX 只能包含字母数字 _ : . -，最长 32 位' }) @IsOptional() REDIS_KEY_PREFIX?: string;
  @IsString() @IsOptional() LOG_DIR?: string;
  @IsString() @IsOptional() LOG_KEEP_DAYS?: string;
  @IsIn(['debug', 'info', 'warn', 'error']) @IsOptional() LOG_LEVEL?: string;
  @IsString() @IsOptional() THROTTLE_TTL?: string;
  @IsString() @IsOptional() THROTTLE_LIMIT?: string;
  @IsString() @IsOptional() THROTTLE_LOGIN_LIMIT?: string;
  @Matches(/^\d+(b|kb|mb)$/i, { message: 'BODY_LIMIT 格式如 1mb / 512kb' }) @IsOptional() BODY_LIMIT?: string;
  @Matches(/^\d+$/, { message: 'PERMISSION_CACHE_TTL 为秒数，0 表示关闭缓存' }) @IsOptional() PERMISSION_CACHE_TTL?: string;
  // API 文档开关：on / off（未配置时生产默认 off、其他环境 on）
  @IsIn(['on', 'off', 'true', 'false', '1', '0']) @IsOptional() SWAGGER_ENABLED?: string;
  // 指标端点开关：on / off（默认 off，需自行保证 /api/metrics 不对外暴露）
  @IsIn(['on', 'off', 'true', 'false', '1', '0']) @IsOptional() METRICS_ENABLED?: string;
  // ---- 安全加固（默认宽松：最小长度 8、不锁定、不过期、不要求验证码，避免升级后管理员被锁死）----
  @Matches(/^\d+$/, { message: 'PASSWORD_MIN_LENGTH 需为正整数（默认 8）' }) @IsOptional() PASSWORD_MIN_LENGTH?: string;
  @IsIn(['on', 'off']) @IsOptional() PASSWORD_COMPLEXITY?: string;
  @Matches(/^\d+$/, { message: 'PASSWORD_EXPIRE_DAYS 需为整数天，0 表示不过期' }) @IsOptional() PASSWORD_EXPIRE_DAYS?: string;
  @Matches(/^\d+$/, { message: 'LOGIN_FAIL_LOCK_COUNT 需为整数次，0 表示不锁定' }) @IsOptional() LOGIN_FAIL_LOCK_COUNT?: string;
  @Matches(/^\d+$/, { message: 'LOGIN_FAIL_ACCOUNT_LOCK_COUNT 需为整数次（默认 LOGIN_FAIL_LOCK_COUNT×4），0 表示不按账号锁定' }) @IsOptional() LOGIN_FAIL_ACCOUNT_LOCK_COUNT?: string;
  @Matches(/^\d+$/, { message: 'LOGIN_FAIL_LOCK_MINUTES 需为整数分钟' }) @IsOptional() LOGIN_FAIL_LOCK_MINUTES?: string;
  @Matches(/^\d+$/, { message: 'LOGIN_FAIL_WINDOW_MIN 需为整数分钟' }) @IsOptional() LOGIN_FAIL_WINDOW_MIN?: string;
  @IsIn(['off', 'auto', 'on']) @IsOptional() LOGIN_CAPTCHA?: string;
  @IsString() @IsOptional() IP_WHITELIST?: string;
  @IsString() @IsOptional() IP_BLACKLIST?: string;
  // ---- 文件上传 ----
  @IsString() @IsOptional() UPLOAD_DIR?: string; // 存储目录，默认 uploads（相对后端运行目录）
  @Matches(/^\d+$/, { message: 'UPLOAD_MAX_SIZE 为字节数（默认 10485760 = 10MB）' }) @IsOptional() UPLOAD_MAX_SIZE?: string;
  @IsString() @IsOptional() UPLOAD_ALLOWED_MIME?: string; // 逗号分隔的 MIME 白名单，* 表示不限（高危扩展名仍拒绝）
  // ---- 定时任务 ----
  @Matches(/^\d+$/, { message: 'JOB_RECONCILE_SECONDS 为秒数（默认 60，0 表示关闭多实例任务对账）' }) @IsOptional() JOB_RECONCILE_SECONDS?: string;
  // ---- 前端日志上报 ----
  @IsIn(['on', 'off']) @IsOptional() CLIENT_LOG_ENABLED?: string;
  @Matches(/^\d+$/, { message: 'CLIENT_LOG_DAILY_MAX_BYTES 为字节数（默认 50MB）' }) @IsOptional() CLIENT_LOG_DAILY_MAX_BYTES?: string;
  // ---- 错误日志告警任务 ----
  @Matches(/^\d+$/, { message: 'LOG_ALERT_THRESHOLD 为整数（默认 50）' }) @IsOptional() LOG_ALERT_THRESHOLD?: string;
  @Matches(/^https?:\/\/\S+$/, { message: 'LOG_ALERT_WEBHOOK 需为 http(s) 地址' }) @IsOptional() LOG_ALERT_WEBHOOK?: string;
  // ---- 种子数据：超管初始密码（只在超管不存在时生效），默认 admin123 ----
  @IsString() @IsOptional() ADMIN_INITIAL_PASSWORD?: string;
}

/**
 * 环境变量校验（启动 fail-fast）：
 * - DATABASE_URL 必填
 * - JWT_SECRET：生产缺失/过短直接启动失败；开发环境缺失时回退开发密钥并告警
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  // env 文件里写了 KEY= 但没填值（空字符串）视为未配置：走默认值，不按格式校验
  const filled = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
  const env = plainToInstance(EnvVariables, filled, { enableImplicitConversion: true });
  const problems: string[] = validateSync(env).map(
    (e) => `${Object.keys(e.constraints || {}).join(',')}: ${Object.values(e.constraints || {}).join('; ')}`,
  );

  const isProd = config.NODE_ENV === 'production';
  // 只有显式声明为开发/测试环境才允许用默认密钥：漏配 NODE_ENV 时按生产要求处理，
  // 否则一次漏配就会用源码里公开的密钥签发 token（任何人可伪造任意用户）
  const isDevLike = config.NODE_ENV === 'development' || config.NODE_ENV === 'test';
  const secret = (config.JWT_SECRET as string) || '';
  if (!secret || secret.length < 16) {
    if (!isDevLike) {
      problems.push(
        `JWT_SECRET 必填且长度至少 16 位（当前 NODE_ENV=${config.NODE_ENV ?? '未设置'}；仅 development/test 环境允许使用默认密钥）`,
      );
    } else if (!secret) {
      env.JWT_SECRET = 'systembase-dev-secret-change-me';
    }
  }
  if (isProd && !((config.CORS_ORIGINS as string) || '').trim()) {
    problems.push('生产环境必须显式配置 CORS_ORIGINS 白名单（逗号分隔）');
  }

  if (problems.length) {
    throw new Error(`环境变量校验失败，请检查 .env：\n  - ${problems.join('\n  - ')}`);
  }

  // 填充默认值
  const merged: Record<string, unknown> = {
    ...config,
    NODE_ENV: env.NODE_ENV || NodeEnv.Development,
    JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '2h',
    JWT_REFRESH_EXPIRES_IN: env.JWT_REFRESH_EXPIRES_IN || '7d',
    PORT: env.PORT || '3000',
    // 默认不信任代理头：服务直接对外时 X-Forwarded-For 可被伪造（绕过 IP 白名单/限流/登录锁定）。
    // 经 Nginx 反代部署时在 env 显式配置 TRUST_PROXY=1（remote.env.example 已默认写好）
    TRUST_PROXY: env.TRUST_PROXY || 'false',
    CORS_ORIGINS: env.CORS_ORIGINS || '',
    LOCK_DRIVER: env.LOCK_DRIVER || 'db',
    REDIS_URL: env.REDIS_URL || 'redis://localhost:6379',
    LOG_DIR: env.LOG_DIR || 'logs',
    LOG_KEEP_DAYS: env.LOG_KEEP_DAYS || '30',
    LOG_LEVEL: env.LOG_LEVEL || ((env.NODE_ENV || NodeEnv.Development) === NodeEnv.Production ? 'info' : 'debug'),
    THROTTLE_TTL: env.THROTTLE_TTL || '60',
    THROTTLE_LIMIT: env.THROTTLE_LIMIT || '100',
    THROTTLE_LOGIN_LIMIT: env.THROTTLE_LOGIN_LIMIT || '5',
    BODY_LIMIT: env.BODY_LIMIT || '1mb',
    PERMISSION_CACHE_TTL: env.PERMISSION_CACHE_TTL ?? '30',
    JWT_SECRET: env.JWT_SECRET,
  };
  return merged;
}
