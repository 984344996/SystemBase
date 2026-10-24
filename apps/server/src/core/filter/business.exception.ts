import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 业务错误码：与 HTTP 状态解耦，前端可凭 code 区分「同是 400 的不同业务错误」。
 * 规则：前三位对齐 HTTP 语义（4xx 客户端错误），后两位为序号；新增码集中在这里登记。
 */
export enum BizCode {
  /** 必须先修改密码（管理员重置过密码，HTTP 403；前端据此跳改密页） */
  PASSWORD_CHANGE_REQUIRED = 40301,
  /** 授出的角色/权限超出操作者自身范围（HTTP 403） */
  PRIVILEGE_ESCALATION = 40302,
  /** 资源已存在（唯一约束冲突/预检重复） */
  DUPLICATE = 40901,
  /** 当前状态不允许该操作（如内置数据被删改） */
  INVALID_STATE = 40902,
  /** 登录需要验证码（HTTP 412，前端据此展示验证码输入框） */
  NEED_CAPTCHA = 42801,
}

/**
 * 业务异常：携带独立的业务错误码与可选数据。
 *
 * 响应结构不变（{ code, data, message, traceId }），区别在于：
 * - code 输出业务码（而非 HTTP status）
 * - data 透传附加信息（如 needCaptcha 标记）
 *
 * 渐进迁移：存量 BadRequestException 保持不动（HTTP 语义已足够），
 * 需要前端精确区分的场景才升级为 BusinessException。
 */
export class BusinessException extends HttpException {
  constructor(
    bizCode: BizCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    data: unknown = null,
  ) {
    super({ bizCode, message, data }, status);
  }
}
