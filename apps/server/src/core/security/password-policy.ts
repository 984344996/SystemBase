/**
 * 密码策略：强度校验规则与弱密码字典在 @sb/shared（前后端共用），这里负责读取环境变量与过期判定。
 *
 * 环境变量（默认宽松，避免升级后把管理员锁死）：
 *   PASSWORD_MIN_LENGTH     最小长度，默认 8
 *   PASSWORD_COMPLEXITY     on|off，是否要求「大小写 + 数字」组合，默认 on
 *   PASSWORD_EXPIRE_DAYS    密码有效期天数，0/空 = 不过期
 */
import { checkPasswordStrength as checkWithRules, WEAK_PASSWORDS } from '@sb/shared';

export { WEAK_PASSWORDS };

export interface PasswordPolicy {
  minLength: number;
  requireComplexity: boolean;
  expireDays: number;
}

export function readPasswordPolicy(env: Record<string, string | undefined> = process.env): PasswordPolicy {
  const min = Number(env.PASSWORD_MIN_LENGTH);
  return {
    minLength: Number.isInteger(min) && min > 0 ? min : 8,
    requireComplexity: String(env.PASSWORD_COMPLEXITY ?? 'on').toLowerCase() !== 'off',
    expireDays: Number(env.PASSWORD_EXPIRE_DAYS) || 0,
  };
}

/** 校验密码强度：返回问题列表（空数组 = 通过） */
export function checkPasswordStrength(
  password: string,
  username: string,
  policy: PasswordPolicy = readPasswordPolicy(),
): string[] {
  return checkWithRules(password, username, policy);
}

/** 密码是否过期：未配置有效期或从未改过密码时不判定过期（pwdUpdatedAt 为空视为不限） */
export function isPasswordExpired(
  pwdUpdatedAt: Date | null | undefined,
  policy: PasswordPolicy = readPasswordPolicy(),
): boolean {
  if (!policy.expireDays || !pwdUpdatedAt) return false;
  const deadline = new Date(pwdUpdatedAt).getTime() + policy.expireDays * 86_400_000;
  return Date.now() > deadline;
}
