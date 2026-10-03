import { SetMetadata } from '@nestjs/common';

export const OPERATE_LOG_KEY = 'operateLog';

export interface OperateLogOptions {
  module: string;
  action: string;
}

/** 操作审计：@OperateLog({ module:'用户管理', action:'创建用户' }) */
export const OperateLog = (options: OperateLogOptions) => SetMetadata(OPERATE_LOG_KEY, options);
