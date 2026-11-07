/** 通用状态 */
export const Status = {
  ENABLED: "ENABLED",
  DISABLED: "DISABLED",
} as const;

/** 统一响应 code：0 成功，非 0 为错误（见 docs/architecture.md 错误码段） */
export const ApiCode = {
  OK: 0,
} as const;

/**
 * 统一响应结构（后端 TransformInterceptor 包装成功结果、AllExceptionsFilter 包装错误，前后端同构）：
 *   成功 { code: 0, data, message: "ok", traceId }
 *   失败 { code: 业务码或 HTTP 状态, data: 附加信息或 null, message: 提示, traceId }
 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
  traceId: string;
}

/** 内置超级管理员角色编码（拥有全部权限，不受授权范围限制） */
export const SUPER_ROLE = "SUPER_ADMIN";

/**
 * 业务错误码：与 HTTP 状态解耦，前端可凭 code 区分「同是 4xx 的不同业务错误」。
 * 规则：前三位对齐 HTTP 语义，后两位为序号；新增码集中在这里登记（前后端共用这一份）。
 */
export const BizCode = {
  /** 提交的数据不合法（如字段超长、关联的数据不存在，HTTP 400） */
  INVALID_DATA: 40001,
  /** 必须先修改密码（管理员重置过密码，HTTP 403；前端据此跳改密页） */
  PASSWORD_CHANGE_REQUIRED: 40301,
  /** 授出的角色/权限超出操作者自身范围（HTTP 403） */
  PRIVILEGE_ESCALATION: 40302,
  /** 记录不存在或已删除（HTTP 404） */
  NOT_FOUND: 40401,
  /** 资源已存在（唯一约束冲突/预检重复，HTTP 409） */
  DUPLICATE: 40901,
  /** 当前状态不允许该操作（如内置数据被删改、被其他数据引用无法删除，HTTP 409） */
  INVALID_STATE: 40902,
  /** 登录需要验证码（HTTP 412，前端据此展示验证码输入框） */
  NEED_CAPTCHA: 42801,
  /** 连续登录失败被锁定（HTTP 429，message 含剩余分钟） */
  LOGIN_LOCKED: 42901,
} as const;

/** 业务错误码取值类型 */
export type BizCode = (typeof BizCode)[keyof typeof BizCode];
