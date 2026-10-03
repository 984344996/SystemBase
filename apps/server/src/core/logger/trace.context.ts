import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceStore {
  traceId: string;
}

/** 请求级 traceId 上下文：贯穿 日志/响应头/操作审计/任务执行 */
export const traceStorage = new AsyncLocalStorage<TraceStore>();

export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}

export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn);
}
