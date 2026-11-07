import { HttpException, HttpStatus } from '@nestjs/common';
import { BizCode } from '@sb/shared';

/**
 * 业务错误码定义在 @sb/shared（前后端共用一份），这里再导出一次，保持原有引用路径可用：
 *   import { BizCode, BusinessException } from '../filter/business.exception';
 */
export { BizCode };

/** 资源重复（HTTP 409 + 业务码 40901）：预检发现重复与并发撞唯一约束统一用它，前端按 code 识别 */
export function duplicate(message: string): BusinessException {
  return new BusinessException(BizCode.DUPLICATE, message, HttpStatus.CONFLICT);
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
