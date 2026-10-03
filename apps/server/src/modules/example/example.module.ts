import { Module } from '@nestjs/common';
import { ExampleController } from './example.controller';
import { HelloJob, SystemCleanupJob } from './example.jobs';

@Module({
  controllers: [ExampleController],
  providers: [HelloJob, SystemCleanupJob],
})
export class ExampleModule {}
