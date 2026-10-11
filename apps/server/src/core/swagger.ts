import type { INestApplication } from '@nestjs/common';
import type { AppLogger } from './logger/logger.service';

/**
 * API 文档（Swagger）：可选能力，依赖 @nestjs/swagger。
 *
 * - 开关 SWAGGER_ENABLED=on|off；未配置时：生产默认 off，其他环境 on
 * - 依赖未安装时仅告警并跳过（require 而非 import，避免未安装即编译失败）
 * - 文档地址：/api/docs（JSON 原始描述：/api/docs-json）
 */
/** 是否启用 API 文档：SWAGGER_ENABLED 未配置时，生产关闭、其他环境开启 */
export function shouldEnableSwagger(isProd: boolean): boolean {
  const raw = (process.env.SWAGGER_ENABLED || '').trim().toLowerCase();
  if (!raw) return !isProd;
  return raw === 'on' || raw === 'true' || raw === '1';
}

export function setupSwagger(app: INestApplication, isProd: boolean, logger: AppLogger): boolean {
  if (!shouldEnableSwagger(isProd)) return false;

  let swagger: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    swagger = require('@nestjs/swagger');
  } catch {
    logger.warn({}, 'SWAGGER_ENABLED 已开启，但未安装 @nestjs/swagger，跳过 API 文档（pnpm --filter @sb/server add @nestjs/swagger）');
    return false;
  }

  const version = process.env.npm_package_version || '0.2.0';
  const builder = new swagger.DocumentBuilder()
    .setTitle('SystemBase API')
    .setDescription('前后端分离基础框架接口文档（携带 accessToken 后可用 Try it out）')
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'accessToken')
    .build();
  const doc = swagger.SwaggerModule.createDocument(app, builder);
  swagger.SwaggerModule.setup('api/docs', app, doc, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
    customSiteTitle: 'SystemBase API 文档',
  });
  logger.info({}, 'API 文档已启用: /api/docs');
  return true;
}
