import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AppLogger } from './core/logger/logger.service';
import { configureApp } from './core/bootstrap/configure-app';
import { setupSwagger } from './core/swagger';

async function bootstrap() {
  // bodyParser 关闭默认实现，configureApp 里按 BODY_LIMIT 显式注册（默认 100kb 对导入类接口偏小，且上限应可配）
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });

  // 优雅退出：SIGTERM 时执行各模块 onModuleDestroy（等待执行中的任务、断开数据库/Redis），进程停止不丢现场
  app.enableShutdownHooks();

  // 框架内部日志统一走 pino(按天滚动文件)
  app.useLogger(app.get(AppLogger));

  // HTTP 层配置（代理 / 安全头 / 请求体上限 / 前缀 / CORS / 全局校验）：与 E2E 测试共用同一份
  configureApp(app);

  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';
  // API 文档（可选，依赖 @nestjs/swagger）：/api/docs
  const logger = app.get(AppLogger);
  setupSwagger(app, isProd, logger);

  const port = Number(config.get('PORT')) || 3000;
  await app.listen(port);
  logger.info({ port, env: config.get('NODE_ENV') }, `SystemBase 后端已启动`);
}
bootstrap();
