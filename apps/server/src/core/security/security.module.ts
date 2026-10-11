import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { PermissionCacheService } from './permission-cache.service';
import { LoginGuardService } from './login-guard.service';

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '2h' },
      }),
    }),
  ],
  providers: [JwtStrategy, PermissionCacheService, LoginGuardService],
  exports: [JwtModule, JwtStrategy, PermissionCacheService, LoginGuardService],
})
export class SecurityModule {}
