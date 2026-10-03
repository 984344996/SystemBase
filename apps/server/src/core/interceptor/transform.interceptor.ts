import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ApiCode } from '@sb/shared';
import { getTraceId } from '../logger/trace.context';

/** 统一成功响应结构 */
export interface ApiResponse<T> {
  code: number;
  data: T | null;
  message: string;
  traceId: string;
}

/** 所有接口统一返回 { code:0, data, message:'ok', traceId } */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
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
