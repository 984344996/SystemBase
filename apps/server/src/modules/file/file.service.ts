import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AppLogger } from '../../core/logger/logger.service';
import { QueryFileDto } from './file.dto';
import { paginate } from '../../core/pagination/paginate';
import { EXT_MIME, RISKY_EXT, contentMatches } from './file-type.util';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** 默认允许的类型白名单（可用 UPLOAD_ALLOWED_MIME 覆盖，逗号分隔，* 表示不限制白名单内类型） */
const DEFAULT_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/zip'];

/** 默认上传上限 10MB（UPLOAD_MAX_SIZE 覆盖，单位字节）；FileModule 的 multer limits 也读这里 */
export function uploadMaxSize(config: ConfigService): number {
  return Number(config.get<string>('UPLOAD_MAX_SIZE') || 10 * 1024 * 1024);
}

/** 列表允许的排序字段 */
const SORTABLE = ['id', 'name', 'size', 'createdAt'];

/**
 * 文件管理：元信息入库、实体落盘（UPLOAD_DIR，默认 uploads）。
 * 下载走接口鉴权（不直接暴露静态目录），删除为软删除，实体由 system.cleanup 任务定期回收。
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
    this.maxSize = uploadMaxSize(config);
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
      sortable: SORTABLE,
    });
  }

  async upload(file: UploadedFile, uploaderId?: number) {
    const { ext, mime } = this.resolveType(file);
    const sub = new Date().toISOString().slice(0, 7).replace('-', ''); // yyyyMM
    const target = join(this.dir, sub);
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    const relPath = `${sub}/${randomUUID()}${ext}`;
    const abs = join(this.dir, relPath);

    // 异步落盘，不阻塞事件循环
    await writeFile(abs, file.buffer);

    let row;
    try {
      row = await this.prisma.file.create({
        data: {
          name: file.originalname.slice(0, 255),
          path: relPath,
          mime, // 服务端判定的类型，下载时据此输出 Content-Type（不回放客户端声明值）
          size: file.size,
          uploaderId: uploaderId ?? null,
        },
      });
    } catch (e) {
      // 入库失败：清理已落盘的实体，避免孤儿文件
      await unlink(abs).catch(() => undefined);
      throw e;
    }
    this.logger.audit(
      { event: 'file_upload', fileId: row.id, name: row.name, size: row.size, uploaderId },
      `上传文件: ${row.name}（${Math.round(row.size / 1024)}KB）`,
    );
    return row;
  }

  /** 下载：返回可读流、实际大小与元信息（控制器负责设置响应头与错误处理） */
  async open(id: number) {
    const row = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('文件不存在或已删除');
    const abs = join(this.dir, row.path);
    // 以磁盘实际大小为准（库里记录的 size 与实体不一致时，客户端会挂起或截断）
    const st = await stat(abs).catch(() => null);
    if (!st?.isFile()) throw new NotFoundException('文件实体已丢失');
    return { row, size: st.size, stream: createReadStream(abs) };
  }

  async remove(id: number) {
    const row = await this.prisma.file.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException('文件不存在');
    await this.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  }

  /** 清理任务用：物理删除软删超过 N 天的实体（默认 7 天），由 system.cleanup 每小时调用 */
  async purge(keepDays = 7): Promise<number> {
    const deadline = new Date(Date.now() - keepDays * 86_400_000);
    const rows = await this.prisma.file.findMany({ where: { deletedAt: { lt: deadline } }, take: 500 });
    let removed = 0;
    for (const r of rows) {
      try {
        await unlink(join(this.dir, r.path)).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e; // 实体已不在：照样删记录
        });
        await this.prisma.file.delete({ where: { id: r.id } });
        removed++;
      } catch (e) {
        this.logger.warnFields({ event: 'file_purge', fileId: r.id }, `清理文件失败: ${(e as Error).message}`);
      }
    }
    return removed;
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

  /**
   * 判定上传文件的真实类型：
   *   1. 高危扩展名一律拒绝（含 html/svg 等可在浏览器执行脚本的类型）
   *   2. 扩展名映射出服务端认定的 mime，必须在白名单内
   *   3. 白名单内的已知类型校验文件头魔数（防改扩展名伪装）
   * 客户端声明的 Content-Type 不参与判定。
   */
  private resolveType(file: UploadedFile): { ext: string; mime: string } {
    if (!file?.buffer) throw new BadRequestException('未收到文件内容');
    if (file.size > this.maxSize) {
      throw new BadRequestException(`文件超过大小上限 ${Math.round(this.maxSize / 1024 / 1024)}MB`);
    }
    const ext = extname(file.originalname).toLowerCase().slice(0, 20);
    if (!ext) throw new BadRequestException('文件缺少扩展名');
    if (RISKY_EXT.includes(ext)) throw new BadRequestException(`禁止上传该类型文件（${ext}）`);

    const unrestricted = this.allowed.includes('*');
    const mime = EXT_MIME[ext] ?? (unrestricted ? 'application/octet-stream' : '');
    if (!mime || (!unrestricted && !this.allowed.includes(mime))) {
      throw new BadRequestException(`不支持的文件类型（${ext}）`);
    }
    if (EXT_MIME[ext] && !contentMatches(mime, file.buffer)) {
      throw new BadRequestException(`文件内容与扩展名不符（${ext}）`);
    }
    return { ext, mime };
  }

  /** 供下载接口生成 ETag（路径含 UUID，同一记录内容不变） */
  static etagOf(size: number, path: string): string {
    return `"${createHash('md5').update(`${path}:${size}`).digest('hex')}"`;
  }
}
