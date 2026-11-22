import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withUniqueViolation } from '../../core/prisma/prisma-error.util';
import { EventBusService } from '../../core/redis/event-bus.service';
import { CreateDictDto, CreateDictItemDto, QueryDictDto, UpdateDictDto, UpdateDictItemDto } from './dict.dto';
import { BizCode, BusinessException, duplicate } from '../../core/filter/business.exception';

/** 字典缓存失效事件主题 */
const TOPIC = 'dict:invalidate';

export interface DictOption {
  label: string;
  value: string;
}

/**
 * 数据字典：下拉选项的统一来源（避免各页面硬编码枚举）。
 * 读多写少 → 进程内缓存（60s），写操作经事件广播让所有实例立即失效。
 * 缓存按编码记版本号：查库期间发生过失效时，查到的（可能是旧的）结果不写回缓存，
 * 否则并发下旧数据会在缓存里再留 60 秒。
 */
@Injectable()
export class DictService {
  private cache = new Map<string, { options: DictOption[]; expiresAt: number }>();
  /** 每个字典编码的失效次数（版本号） */
  private versions = new Map<string, number>();
  private readonly ttlMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBusService,
  ) {
    // 本实例与其他实例的失效事件都在这里处理（payload 为字典编码）
    this.bus.subscribe(TOPIC, (code) => {
      this.cache.delete(code);
      this.versions.set(code, (this.versions.get(code) ?? 0) + 1);
    });
  }

  // ---------- 字典类型 ----------
  async list(query: QueryDictDto) {
    return this.prisma.dict.findMany({
      where: query.keyword
        ? { OR: [{ code: { contains: query.keyword } }, { name: { contains: query.keyword } }] }
        : {},
      orderBy: [{ id: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
  }

  async create(dto: CreateDictDto) {
    const exists = await this.prisma.dict.findUnique({ where: { code: dto.code } });
    if (exists) throw duplicate(`字典编码「${dto.code}」已存在`);
    return withUniqueViolation(() => this.prisma.dict.create({ data: dto }), `字典编码「${dto.code}」已存在`);
  }

  async update(id: number, dto: UpdateDictDto) {
    const dict = await this.prisma.dict.findUnique({ where: { id } });
    if (!dict) throw new NotFoundException('字典不存在');
    const updated = await this.prisma.dict.update({ where: { id }, data: dto });
    this.invalidate(dict.code);
    return updated;
  }

  /**
   * 删除字典：字典项随字典级联删除（schema onDelete: Cascade）
   *   还有字典项时必须显式 force 确认：误删会把全部选项一起删掉，业务表里按值引用的数据随之变成无法翻译的原始值
   */
  async remove(id: number, force = false) {
    const dict = await this.prisma.dict.findUnique({ where: { id } });
    if (!dict) throw new NotFoundException('字典不存在');
    const itemCount = await this.prisma.dictItem.count({ where: { dictId: id } });
    if (itemCount > 0 && !force) {
      throw new BusinessException(
        BizCode.INVALID_STATE,
        `字典「${dict.name}」下还有 ${itemCount} 个选项，确认一并删除请再次确认`,
        HttpStatus.CONFLICT,
        { itemCount },
      );
    }
    await this.prisma.dict.delete({ where: { id } });
    this.invalidate(dict.code);
    return { success: true };
  }

  // ---------- 字典项 ----------
  items(dictId: number) {
    return this.prisma.dictItem.findMany({
      where: { dictId },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
  }

  async addItem(dictId: number, dto: CreateDictItemDto) {
    const dict = await this.prisma.dict.findUnique({ where: { id: dictId } });
    if (!dict) throw new NotFoundException('字典不存在');
    const exists = await this.prisma.dictItem.findUnique({
      where: { dictId_value: { dictId, value: dto.value } },
    });
    if (exists) throw duplicate(`该字典下已存在选项值「${dto.value}」`);
    // 预检后并发写入同一个值：唯一约束兜底，返回同样的业务码
    const item = await withUniqueViolation(
      () => this.prisma.dictItem.create({ data: { ...dto, dictId } }),
      `该字典下已存在选项值「${dto.value}」`,
    );
    this.invalidate(dict.code);
    return item;
  }

  async updateItem(id: number, dto: UpdateDictItemDto) {
    const item = await this.prisma.dictItem.findUnique({ where: { id }, include: { dict: true } });
    if (!item) throw new NotFoundException('字典项不存在');
    const updated = await withUniqueViolation(
      () => this.prisma.dictItem.update({ where: { id }, data: dto }),
      `该字典下已存在选项值「${dto.value ?? item.value}」`,
    );
    this.invalidate(item.dict.code);
    return updated;
  }

  async removeItem(id: number) {
    const item = await this.prisma.dictItem.findUnique({ where: { id }, include: { dict: true } });
    if (!item) throw new NotFoundException('字典项不存在');
    await this.prisma.dictItem.delete({ where: { id } });
    this.invalidate(item.dict.code);
    return { success: true };
  }

  // ---------- 读取（业务代码 / 前端下拉用） ----------

  /** 按字典编码取启用中的选项（带缓存） */
  async options(code: string): Promise<DictOption[]> {
    const cached = this.cache.get(code);
    if (cached && cached.expiresAt > Date.now()) return cached.options;
    const version = this.versions.get(code) ?? 0;
    const dict = await this.prisma.dict.findUnique({
      where: { code },
      include: {
        items: {
          where: { status: 'ENABLED' },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          select: { label: true, value: true },
        },
      },
    });
    if (!dict) throw new NotFoundException(`字典 ${code} 不存在`);
    // 查库期间被失效过（有人改了字典）：结果可能是旧的，只返回不缓存
    if ((this.versions.get(code) ?? 0) === version) {
      this.cache.set(code, { options: dict.items, expiresAt: Date.now() + this.ttlMs });
    }
    return dict.items;
  }

  /** 取 label（用于列表页把 value 转可读文案）；字典或值缺失时返回原值 */
  async labelOf(code: string, value: string): Promise<string> {
    try {
      const options = await this.options(code);
      return options.find((o) => o.value === value)?.label ?? value;
    } catch {
      return value;
    }
  }

  /** 失效某个字典的缓存：本实例立即生效，并广播给其他实例 */
  private invalidate(code: string): void {
    this.bus.publish(TOPIC, code);
  }
}
