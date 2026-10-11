/**
 * 密码策略（纯函数，便于单测）：强度校验 + 过期判定。
 *
 * 环境变量（默认宽松，避免升级后把管理员锁死）：
 *   PASSWORD_MIN_LENGTH     最小长度，默认 8
 *   PASSWORD_COMPLEXITY     on|off，是否要求「大小写 + 数字」组合，默认 on
 *   PASSWORD_EXPIRE_DAYS    密码有效期天数，0/空 = 不过期
 */
export interface PasswordPolicy {
  minLength: number;
  requireComplexity: boolean;
  expireDays: number;
}

/** 常见弱密码字典（全小写比对）：命中即拒绝 */
export const WEAK_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '123123', '111111', '000000', '654321',
  'password', 'passw0rd', 'abc123', 'a123456', 'a12345678', 'admin123', 'admin888',
  'qwerty', 'qwerty123', 'iloveyou', '1q2w3e4r', 'woaini1314', 'test123', 'root', 'toor',
];

export function readPasswordPolicy(env: Record<string, string | undefined> = process.env): PasswordPolicy {
  const min = Number(env.PASSWORD_MIN_LENGTH);
  return {
    minLength: Number.isInteger(min) && min > 0 ? min : 8,
    requireComplexity: String(env.PASSWORD_COMPLEXITY ?? 'on').toLowerCase() !== 'off',
    expireDays: Number(env.PASSWORD_EXPIRE_DAYS) || 0,
  };
}

/**
 * 校验密码强度：返回问题列表（空数组 = 通过）。
 * 规则：长度、复杂度、弱密码字典、不得包含用户名（正序或倒序，长度≥3 时判定）。
 */
export function checkPasswordStrength(
  password: string,
  username: string,
  policy: PasswordPolicy = readPasswordPolicy(),
): string[] {
  const problems: string[] = [];
  const pwd = password ?? '';
  if (pwd.length < policy.minLength) {
    problems.push(`密码长度不能少于 ${policy.minLength} 位`);
  }
  if (policy.requireComplexity) {
    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((re) => re.test(pwd)).length;
    if (classes < 2) problems.push('密码需包含大小写字母与数字中的至少两类');
  }
  if (WEAK_PASSWORDS.includes(pwd.toLowerCase())) {
    problems.push('密码过于简单（命中常见弱密码字典），请更换');
  }
  const u = (username ?? '').trim().toLowerCase();
  if (u.length >= 3 && (pwd.toLowerCase().includes(u) || pwd.toLowerCase().includes([...u].reverse().join('')))) {
    problems.push('密码不能包含用户名');
  }
  return problems;
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
