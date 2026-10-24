/**
 * 密码策略（前后端共用的纯函数）：
 * 后端以环境变量为准（PASSWORD_MIN_LENGTH / PASSWORD_COMPLEXITY）；前端用同一套规则做即时提示，
 * 避免「前端提示通过、后端却拒绝」——两端规则不一致是最常见的体验问题。
 */
export interface PasswordRules {
  minLength: number;
  requireComplexity: boolean;
}

/** 默认规则：与后端 readPasswordPolicy() 的默认值一致 */
export const DEFAULT_PASSWORD_RULES: PasswordRules = { minLength: 8, requireComplexity: true };

/** 常见弱密码字典（全小写比对）：命中即拒绝 */
export const WEAK_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '123123', '111111', '000000', '654321',
  'password', 'passw0rd', 'abc123', 'a123456', 'a12345678', 'admin123', 'admin888',
  'qwerty', 'qwerty123', 'iloveyou', '1q2w3e4r', 'woaini1314', 'test123', 'root', 'toor',
];

/**
 * 校验密码强度：返回问题列表（空数组 = 通过）。
 * 规则：长度、复杂度（大小写字母与数字至少两类）、弱密码字典、不得包含用户名（正序或倒序，长度≥3 时判定）。
 */
export function checkPasswordStrength(
  password: string,
  username: string,
  rules: PasswordRules = DEFAULT_PASSWORD_RULES,
): string[] {
  const problems: string[] = [];
  const pwd = password ?? '';
  if (pwd.length < rules.minLength) {
    problems.push(`密码长度不能少于 ${rules.minLength} 位`);
  }
  if (rules.requireComplexity) {
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
