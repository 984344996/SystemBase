import { checkPasswordStrength, DEFAULT_PASSWORD_RULES, type PasswordRules } from "@sb/shared";

/**
 * 前端密码规则：与后端同一套校验函数（@sb/shared），阈值可通过构建变量与后端 env 对齐：
 *   VITE_PASSWORD_MIN_LENGTH   对应后端 PASSWORD_MIN_LENGTH
 *   VITE_PASSWORD_COMPLEXITY   对应后端 PASSWORD_COMPLEXITY（on|off）
 * 前端校验只是即时提示，最终以后端为准。
 */
export const PASSWORD_RULES: PasswordRules = {
  minLength: Number(import.meta.env.VITE_PASSWORD_MIN_LENGTH) || DEFAULT_PASSWORD_RULES.minLength,
  requireComplexity: String(import.meta.env.VITE_PASSWORD_COMPLEXITY ?? "on").toLowerCase() !== "off",
};

/** 返回第一条不满足的规则说明；全部满足返回 null */
export function passwordProblem(password: string, username = ""): string | null {
  return checkPasswordStrength(password, username, PASSWORD_RULES)[0] ?? null;
}

export const PASSWORD_HINT = `至少 ${PASSWORD_RULES.minLength} 位${PASSWORD_RULES.requireComplexity ? "，包含大小写字母与数字中的至少两类" : ""}`;
