import { Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { RequirePermissions } from '../../core/security/permissions.decorator';
import { OperateLog } from '../../core/operate-log/operate-log.decorator';
import { CurrentUser } from '../../core/security/current-user.decorator';
import { AuthUser } from '../../core/security/jwt.strategy';
import { FileService } from './file.service';
import { QueryFileDto } from './file.dto';

@ApiTags('文件管理')
@ApiBearerAuth('accessToken')
@Controller('files')
export class FileController {
  constructor(private readonly service: FileService) {}

  @Get()
  @RequirePermissions('system:file:list')
  @ApiOperation({ summary: '文件列表（分页）' })
  list(@Query() query: QueryFileDto) {
    return this.service.list(query);
  }

  /** 上传：类型/大小白名单校验，实体落 UPLOAD_DIR，元信息入库 */
  @Post('upload')
  @RequirePermissions('system:file:upload')
  @OperateLog({ module: '文件管理', action: '上传文件' })
  @ApiOperation({ summary: '上传文件（大小上限 UPLOAD_MAX_SIZE，默认 10MB）' })
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthUser) {
    return this.service.upload(file, user.id);
  }

  /** 下载：走接口鉴权（不直接暴露静态目录）；带 ETag 支持客户端缓存协商 */
  @Get(':id/download')
  @RequirePermissions('system:file:download')
  @ApiOperation({ summary: '下载文件（需登录与权限）' })
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const { row, stream } = await this.service.open(id);
    res.set({
      'Content-Type': row.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Content-Length': String(row.size),
      ETag: FileService.etagOf(row.size, row.path),
    });
    stream.pipe(res);
  }

  @Delete(':id')
  @RequirePermissions('system:file:delete')
  @OperateLog({ module: '文件管理', action: '删除文件' })
  @ApiOperation({ summary: '删除文件（软删除，实体由清理任务回收）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
