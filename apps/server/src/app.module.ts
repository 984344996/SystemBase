import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './core/config/env.validation';
import { LoggerModule } from './core/logger/logger.module';
import { AppLogger } from './core/logger/logger.service';
import { TraceMiddleware } from './core/logger/trace.middleware';
import { PrismaModule } from './core/prisma/prisma.module';
import { LockModule } from './core/lock/lock.module';
import { SecurityModule } from './core/security/security.module';
import { JwtAuthGuard } from './core/security/jwt-auth.guard';
import { PermissionsGuard } from './core/security/permissions.guard';
import { IpFilterMiddleware } from './core/security/ip-filter.middleware';
import { MetricsMiddleware } from './core/metrics/metrics.middleware';
import { MetricsModule } from './core/metrics/metrics.module';
import { LogAlertJob } from './core/monitor/log-alert.job';
import { TransformInterceptor } from './core/interceptor/transform.interceptor';
import { AllExceptionsFilter } from './core/filter/all-exceptions.filter';
import { OperateLogModule } from './core/operate-log/operate-log.module';
import { OperateLogInterceptor } from './core/operate-log/operate-log.interceptor';
import { HealthController } from './core/health/health.controller';
import { ClientLogController } from './core/logger/client-log.controller';
import { ClientLogService } from './core/logger/client-log.service';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { MenuModule } from './modules/menu/menu.module';
import { JobModule } from './modules/job/job.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { ConfigModule as SysConfigModule } from './modules/config/config.module';
import { DictModule } from './modules/dict/dict.module';
import { FileModule } from './modules/file/file.module';
import { NoticeModule } from './modules/notice/notice.module';
import { ExampleModule } from './modules/example/example.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: Number(config.get('THROTTLE_TTL')) * 1000,
          limit: Number(config.get('THROTTLE_LIMIT')),
        },
      ],
    }),
    // ---- core ----
    LoggerModule,
    PrismaModule,
    LockModule,
    SecurityModule,
    OperateLogModule,
    MetricsModule,
    // ---- modules ----
    AuthModule,
    UserModule,
    RoleModule,
    MenuModule,
    JobModule,
    MonitorModule,
    SysConfigModule,
    DictModule,
    FileModule,
    NoticeModule,
    ExampleModule,
  ],
  controllers: [HealthController, ClientLogController],
  providers: [
    LogAlertJob, // 日志告警任务（@JobHandler('system.logAlert')），默认关闭，需在任务页启用
    ClientLogService, // 前端日志上报（写 web.YYYY-MM-DD.log，与后端日志分离）
    // 全局守卫链：限流 → JWT 认证 → 权限校验
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // 全局拦截器：操作审计 + 统一响应包裹
    { provide: APP_INTERCEPTOR, useClass: OperateLogInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    // 全局异常过滤器：统一错误结构
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceMiddleware).forRoutes('*');
    // HTTP 指标采集（/api/metrics 关闭时数据仍在内存累计，开销可忽略）
    consumer.apply(MetricsMiddleware).forRoutes('*');
    // IP 白/黑名单：未配置 IP_WHITELIST / IP_BLACKLIST 时中间件内部直接放行
    consumer.apply(IpFilterMiddleware).forRoutes('*');
  }
}
