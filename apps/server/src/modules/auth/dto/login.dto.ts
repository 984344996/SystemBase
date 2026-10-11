import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @ApiProperty()
  @IsString() @IsNotEmpty() @MinLength(6) @MaxLength(50)
  password: string;

  /** 验证码 id（LOGIN_CAPTCHA=auto|on 且服务端要求验证码时必填） */
  @ApiPropertyOptional({ description: '验证码 id，来自 GET /api/auth/captcha' })
  @IsOptional() @IsString() @MaxLength(64)
  captchaId?: string;

  @ApiPropertyOptional({ description: '验证码文本' })
  @IsOptional() @IsString() @MaxLength(10)
  captchaCode?: string;
}
