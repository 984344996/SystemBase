import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiCode, type ApiResponse } from '@sb/shared';
import { getTraceId } from '../logger/trace.context';

/** 统一响应结构定义在 @sb/shared（前后端同构），这里再导出一次保持原有引用路径 */
export type { ApiResponse };

/** 所有接口统一返回 { code:0, data, message:'ok', traceId } */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T | null>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T | null>> {
    return next.handle().pipe(
      map((data) => ({
        code: ApiCode.OK,
        data: data === undefined ? null : data,
        message: 'ok',
        traceId: getTraceId() || '',
      })),
    );
  }
}
