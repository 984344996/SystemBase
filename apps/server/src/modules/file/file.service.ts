import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, createReadStream, unlinkSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AppLogger } from '../../core/logger/logger.service';
import { QueryFileDto } from './file.dto';
import { paginate } from '../../core/pagination/paginate';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** 默认允许的类型白名单（可用 UPLOAD_ALLOWED_MIME 覆盖，逗号分隔，* 表示不限制） */
const DEFAULT_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/zip'];

/**
 * 文件管理：元信息入库、实体落盘（UPLOAD_DIR，默认 uploads）。
 * 下载走接口鉴权（不直接暴露静态目录），删除为软删除。
 */
@Injectable()
export class FileService {
  private readonly dir: string;
  private readonly maxSize: number;
  private readonly allowed: string[];

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.dir = config.get<string>('UPLOAD_DIR') || 'uploads';
    this.maxSize = Number(config.get<string>('UPLOAD_MAX_SIZE') || 10 * 1024 * 1024); // 默认 10MB
    const raw = (config.get<string>('UPLOAD_ALLOWED_MIME') || '').trim();
    this.allowed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_MIME;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  async list(query: QueryFileDto) {
    return paginate(this.prisma, this.prisma.file, {
      where: {
        deletedAt: null,
        ...(query.keyword ? { name: { contains: query.keyword } } : {}),
      },
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort || 'createdAt:desc',
    });
  }

  async upload(file: UploadedFile, uploaderId?: number) {
    this.assertAllowed(file);
    const ext = extname(file.originalname).slice(0, 20);
    const sub = new Date().toISOString().slice(0, 7).replace('-', ''); // yyyyMM
    const target = join(this.dir, sub);
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    const stored = `${randomUUID()}${ext}`;
    const relPath = `${sub}/${stored}`;

    writeFileSync(join(this.dir, relPath), file.buffer);

    const row = await this.prisma.file.create({
      data: {
        name: file.originalname.slice(0, 255),
        path: relPath,
        mime: file.mimetype.slice(0, 100),
        size: file.size,
        uploaderId: uploaderId ?? null,
      },
    });
    this.logger.audit(
      { event: 'file_upload', fileId: row.id, name: row.name, size: row.size, uploaderId },
      `上传文件: ${row.name}（${Math.round(row.size / 1024)}KB）`,
    );
    return row;
  }

  /** 下载：返回可读流与元信息（控制器负责设置响应头） */
  async open(id: number) {
    const row = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('文件不存在或已删除');
    const abs = join(this.dir, row.path);
    if (!existsSync(abs)) throw new NotFoundException('文件实体已丢失');
    return { row, stream: createReadStream(abs) };
  }

  async remove(id: number) {
    const row = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('文件不存在');
    await this.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** 清理任务用：物理删除软删超过 N 天的实体（默认 7 天） */
  async purge(keepDays = 7): Promise<string> {
    const deadline = new Date(Date.now() - keepDays * 86_400_000);
    const rows = await this.prisma.file.findMany({ where: { deletedAt: { lt: deadline } } });
    let removed = 0;
    for (const r of rows) {
      try {
        const abs = join(this.dir, r.path);
        if (existsSync(abs)) unlinkSync(abs);
        await this.prisma.file.delete({ where: { id: r.id } });
        removed++;
      } catch {
        // 单个失败不影响整体（文件被占用/已删）
      }
    }
    return `清理已删除文件 ${removed} 个`;
  }

  /** 体检/统计用：已用空间 */
  usage(): { dir: string; bytes: number } {
    let bytes = 0;
    try {
      const walk = (d: string) => {
        for (const name of readdirSync(d)) {
          const abs = join(d, name);
          const st = statSync(abs);
          if (st.isDirectory()) walk(abs);
          else bytes += st.size;
        }
      };
      if (existsSync(this.dir)) walk(this.dir);
    } catch {
      // 忽略统计失败
    }
    return { dir: this.dir, bytes };
  }

  private assertAllowed(file: UploadedFile): void {
    if (!file?.buffer) throw new BadRequestException('未收到文件内容');
    if (file.size > this.maxSize) {
      throw new BadRequestException(`文件超过大小上限 ${Math.round(this.maxSize / 1024 / 1024)}MB`);
    }
    if (this.allowed.length && !this.allowed.includes('*') && !this.allowed.includes(file.mimetype)) {
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype}`);
    }
    // 二次校验扩展名，避免仅靠前端 mime 判断
    const ext = extname(file.originalname).toLowerCase();
    const risky = ['.exe', '.sh', '.bat', '.php', '.jsp', '.js'];
    if (risky.includes(ext)) throw new BadRequestException(`禁止上传可执行文件（${ext}）`);
  }

  /** 供下载接口生成 etag（内容哈希，便于浏览器缓存） */
  static etagOf(size: number, path: string): string {
    return createHash('md5').update(`${path}:${size}`).digest('hex');
  }
}
