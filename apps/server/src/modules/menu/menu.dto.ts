import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Status } from '@sb/shared';

export class MenuDto {
  @IsInt() @Min(0)
  parentId: number; // 顶级传 0

  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsIn(['DIRECTORY', 'MENU', 'BUTTON'])
  type: string;

  @IsOptional() @IsString() @MaxLength(200)
  path?: string;

  @IsOptional() @IsString() @MaxLength(200)
  component?: string;

  @IsOptional() @IsString() @MaxLength(100)
  permission?: string;

  @IsOptional() @IsString() @MaxLength(100)
  icon?: string;

  @IsInt() @Min(0)
  sort: number;

  @IsOptional() @IsBoolean()
  visible?: boolean;

  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;
}
