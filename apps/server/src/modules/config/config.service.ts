import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { AppLogger } from '../../core/logger/logger.service';
import { CreateConfigDto, QueryConfigDto, UpdateConfigDto } from './config.dto';

export type ConfigType = 'STRING' | 'NUMBER' | 'BOOL' | 'JSON';

/** 缓存：配置读多写少，进程内缓存 60s（变更时立即失效） */
const CACHE_TTL_MS = 60_000;

/**
 * 系统参数：运行时可改的配置（不必改 env 重启）。
 * 类型安全：取值时按 type 转换（BOOL/NUMBER/JSON），非法值回退默认并记录 WARN。
 */
@Injectable()
export class ConfigService {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLogger,
  ) {}

  async list(query: QueryConfigDto) {
    const rows = await this.prisma.sysConfig.findMany({
      where: {
        ...(query.group ? { group: query.group } : {}),
        ...(query.keyword ? { OR: [{ key: { contains: query.keyword } }, { label: { contains: query.keyword } }] } : {}),
      },
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });
    return rows;
  }

  /** 全部参数（前端一次性拉取做缓存用） */
  all() {
    return this.prisma.sysConfig.findMany({ orderBy: [{ group: 'asc' }, { key: 'asc' }] });
  }

  async create(dto: CreateConfigDto) {
    const exists = await this.prisma.sysConfig.findUnique({ where: { key: dto.key } });
    if (exists) throw new BadRequestException(`参数键「${dto.key}」已存在`);
    this.assertValue(dto.value, dto.type);
    const created = await withUniqueViolation(
      () => this.prisma.sysConfig.create({ data: dto }),
      `参数键「${dto.key}」已存在`,
    );
    this.invalidate(dto.key);
    return created;
  }

  async update(key: string, dto: UpdateConfigDto) {
    const row = await this.prisma.sysConfig.findUnique({ where: { key } });
    if (!row) throw new NotFoundException('参数不存在');
    if (dto.value !== undefined) this.assertValue(dto.value, dto.type ?? (row.type as ConfigType));
    const updated = await this.prisma.sysConfig.update({ where: { key }, data: { ...dto } });
    this.invalidate(key);
    return updated;
  }

  async remove(key: string) {
    const row = await this.prisma.sysConfig.findUnique({ where: { key } });
    if (!row) throw new NotFoundException('参数不存在');
    if (row.builtin) throw new BadRequestException('内置参数不允许删除');
    await this.prisma.sysConfig.delete({ where: { key } });
    this.invalidate(key);
    return { success: true };
  }

  // ---------- 读取（业务代码用） ----------

  /** 字符串值（走 60s 进程内缓存；写操作在变更时立即失效） */
  async get(key: string, fallback = ''): Promise<string> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value as string;
    const row = await this.prisma.sysConfig.findUnique({ where: { key } });
    const value = row?.value ?? fallback;
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  /** 布尔值：非法值回退默认并告警（不阻断业务） */
  async getBool(key: string, fallback: boolean): Promise<boolean> {
    const v = await this.get(key, '');
    if (v === '') return fallback;
    const b = this.toBool(v);
    if (b === undefined) {
      this.logger.warn({ event: 'config_invalid', key, value: v }, `系统参数 ${key} 不是合法布尔值，使用默认值`);
      return fallback;
    }
    return b;
  }

  /** 数值：非法值回退默认并告警 */
  async getNumber(key: string, fallback: number): Promise<number> {
    const v = await this.get(key, '');
    if (v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      this.logger.warn({ event: 'config_invalid', key, value: v }, `系统参数 ${key} 不是合法数值，使用默认值`);
      return fallback;
    }
    return n;
  }

  /** JSON 值：解析失败回退默认并告警 */
  async getJson<T>(key: string, fallback: T): Promise<T> {
    const v = await this.get(key, '');
    if (v === '') return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      this.logger.warn({ event: 'config_invalid', key }, `系统参数 ${key} 不是合法 JSON，使用默认值`);
      return fallback;
    }
  }

  private invalidate(key: string): void {
    this.cache.delete(key);
  }

  private toBool(v: string): boolean | undefined {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'on', 'yes'].includes(s)) return true;
    if (['false', '0', 'off', 'no'].includes(s)) return false;
    return undefined;
  }

  /** 写入前校验：JSON 类型必须是合法 JSON，NUMBER 必须是数字 */
  private assertValue(value: string, type?: string): void {
    if (type === 'JSON') {
      try {
        JSON.parse(value);
      } catch {
        throw new BadRequestException('JSON 类型参数的值不是合法 JSON');
      }
    }
    if (type === 'NUMBER' && !Number.isFinite(Number(value))) {
      throw new BadRequestException('数值类型参数的值不是合法数字');
    }
  }
}
