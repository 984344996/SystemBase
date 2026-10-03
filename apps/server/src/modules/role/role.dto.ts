import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Status } from '@sb/shared';
import { PaginationDto } from '../../core/pagination/pagination.dto';

export class QueryRoleDto extends PaginationDto {
  @IsOptional() @IsString() @MaxLength(50)
  keyword?: string;
}

export class CreateRoleDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  code: string;

  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  menuIds?: number[];
}

export class UpdateRoleDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  name: string;

  @IsOptional() @IsString() @MaxLength(255)
  remark?: string;

  @IsOptional() @IsIn([Status.ENABLED, Status.DISABLED])
  status?: string;

  @IsOptional() @IsArray() @IsInt({ each: true }) @Type(() => Number)
  menuIds?: number[];
}
