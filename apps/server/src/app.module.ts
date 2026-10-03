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
import { TransformInterceptor } from './core/interceptor/transform.interceptor';
import { AllExceptionsFilter } from './core/filter/all-exceptions.filter';
import { OperateLogModule } from './core/operate-log/operate-log.module';
import { OperateLogInterceptor } from './core/operate-log/operate-log.interceptor';
import { HealthController } from './core/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { MenuModule } from './modules/menu/menu.module';
import { JobModule } from './modules/job/job.module';
import { MonitorModule } from './modules/monitor/monitor.module';
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
    // ---- modules ----
    AuthModule,
    UserModule,
    RoleModule,
    MenuModule,
    JobModule,
    MonitorModule,
    ExampleModule,
  ],
  controllers: [HealthController],
  providers: [
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
  }
}
