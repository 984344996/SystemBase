import { AppLogger } from '../../core/logger/logger.service';

/** 任务执行上下文 */
export interface JobContext {
  jobId: number;
  jobName: string;
  /** 日志：用 logger.job / jobWarn / jobError 输出，写入当日日志文件 category=job */
  logger: AppLogger;
  /** 任务的 params 字段(创建任务时配置的 JSON) */
  params: unknown;
}

/** 任务处理器接口：实现 run 并返回执行结果摘要 */
export interface JobHandler {
  run(ctx: JobContext): Promise<string | void>;
}

/**
 * 处理器注册表：@JobHandler('key') 在类定义时自动注册。
 * cron 存 DB、代码只注册 handler —— 修改执行时间/参数不用发版；
 * 新增任务类型只需部署一次带 @JobHandler 的代码。
 */
export const JOB_HANDLERS = new Map<string, Function>();

export const JOB_HANDLER_KEY = 'sb:jobHandlerKey';

export function JobHandler(key: string): ClassDecorator {
  // biome-ignore lint: ClassDecorator 签名要求
  return (target: Function) => {
    if (JOB_HANDLERS.has(key)) {
      throw new Error(`@JobHandler key 重复注册: ${key}`);
    }
    JOB_HANDLERS.set(key, target);
    Reflect.defineMetadata(JOB_HANDLER_KEY, key, target);
  };
}

/** 已注册的 handler key 列表（前端创建任务时的下拉选择） */
export function listHandlerKeys(): { key: string }[] {
  return [...JOB_HANDLERS.keys()].map((key) => ({ key }));
}
