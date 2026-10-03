/** 通用状态 */
export const Status = {
  ENABLED: "ENABLED",
  DISABLED: "DISABLED",
} as const;

/** 统一响应 code：0 成功，非 0 为错误（见 docs/architecture.md 错误码段） */
export const ApiCode = {
  OK: 0,
} as const;
