import { SetMetadata } from '@nestjs/common';

export const OPERATE_LOG_KEY = 'operateLog';

export interface OperateLogOptions {
  module: string;
  action: string;
  /** 不记录请求体中的这些字段（如系统参数的 value 可能是 webhook 密钥），只记路径参数与其余字段 */
  omitParams?: string[];
}

/** 操作审计：@OperateLog({ module:'用户管理', action:'创建用户' }) */
export const OperateLog = (options: OperateLogOptions) => SetMetadata(OPERATE_LOG_KEY, options);
