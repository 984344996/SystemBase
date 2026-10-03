import { Global, Module } from '@nestjs/common';
import { OperateLogInterceptor } from './operate-log.interceptor';

@Global()
@Module({
  providers: [OperateLogInterceptor],
  exports: [OperateLogInterceptor],
})
export class OperateLogModule {}
