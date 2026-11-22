import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FileController } from './file.controller';
import { FileService, uploadMaxSize } from './file.service';

@Module({
  imports: [
    // multer 层限制：超过上限直接中断接收（413），不会把整个大文件先读进内存
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: memoryStorage(),
        // 文件名按 UTF-8 解析：multer 2.x 默认 latin1，中文文件名入库、列表、下载时都会乱码
        defParamCharset: 'utf8',
        limits: { fileSize: uploadMaxSize(config), files: 1, fields: 10 },
      }),
    }),
  ],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
