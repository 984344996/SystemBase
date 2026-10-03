import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { LogReaderService } from './log-reader.service';

@Global()
@Module({
  providers: [AppLogger, LogReaderService],
  exports: [AppLogger, LogReaderService],
})
export class LoggerModule {}
