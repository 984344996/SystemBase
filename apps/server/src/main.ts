import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './core/logger/logger.service';
import { bodyParserErrorHandler } from './core/filter/body-parser-error.handler';
import { setupSwagger, shouldEnableSwagger } from './core/swagger';

/**
 * TRUST_PROXY 解析：
 * - 数字 = 信任的代理跳数（Nginx 单层反代配 1）
 * - true = 信任所有（仅本机调试用，存在伪造 X-Forwarded-For 风险）
 * - false = 不信任（默认；服务直连暴露、无反代时必须用它）
 */
function parseTrustProxy(v: string | undefined): boolean | number {
  if (v === undefined || v === '' || v === 'false') return false;
  if (v === 'true') return true;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : false;
}

async function bootstrap() {
  // bodyParser 关闭默认实现，下面按 BODY_LIMIT 显式注册（默认 100kb 对导入类接口偏小，且上限应可配）
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });

  // 优雅退出：SIGTERM 时执行各模块 onModuleDestroy（断开数据库/Redis），进程停止不丢现场
  app.enableShutdownHooks();

  // 框架内部日志统一走 pino(按天滚动文件)
  app.useLogger(app.get(AppLogger));

  const config = app.get(ConfigService);
  const isProd = config.get('NODE_ENV') === 'production';
  // API 文档开启时 CSP 需放宽（Swagger UI 要加载自身脚本/样式），生产默认关闭故仍是最严策略
  const swaggerOn = shouldEnableSwagger(isProd);

  // 反向代理场景必须开启：否则 req.ip 永远取到的是代理 IP，
  // 全局限流会变成全站共享额度、登录/审计日志记录的 IP 全部失真
  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  // 安全响应头：纯 JSON API，CSP 收紧为不允许加载任何资源；HSTS 仅在生产开启（需 HTTPS 前置）
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: swaggerOn
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", "'unsafe-inline'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              frameAncestors: ["'none'"],
            },
          }
        : { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  // 请求体大小上限：超出直接 413（由全局异常过滤器统一结构）；文件上传请用 multipart 单独限制
  const bodyLimit = config.get<string>('BODY_LIMIT') || '1mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });
  app.use(bodyParserErrorHandler(app.get(AppLogger), bodyLimit));

  app.setGlobalPrefix('api');

  // CORS：白名单制；开发环境默认放行 localhost
  const origins = (config.get<string>('CORS_ORIGINS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length ? origins : isProd ? false : [/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
    credentials: true,
  });

  // 全局 DTO 校验：未声明的字段直接拒绝，防参数污染
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // API 文档（可选，依赖 @nestjs/swagger）：/api/docs
  const logger = app.get(AppLogger);
  setupSwagger(app, isProd, logger);

  const port = Number(config.get('PORT')) || 3000;
  await app.listen(port);
  logger.info({ port, env: config.get('NODE_ENV') }, `SystemBase 后端已启动`);
}
bootstrap();
