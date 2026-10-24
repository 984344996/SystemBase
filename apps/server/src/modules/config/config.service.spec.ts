import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from './config.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function setup() {
  const prisma: any = {
    sysConfig: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const logger = { warn: jest.fn(), warnFields: jest.fn(), info: jest.fn(), audit: jest.fn() } as any;
  const service = new ConfigService(prisma as unknown as PrismaService, logger);
  return { service, prisma, logger };
}

describe('ConfigService 写入', () => {
  it('键重复 → 400', async () => {
    const { service, prisma } = setup();
    prisma.sysConfig.findUnique.mockResolvedValue({ key: 'a' });
    await expect(service.create({ key: 'a', value: '1', type: 'STRING', label: 'A' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('JSON 类型非法值 → 400；数值类型非法 → 400', async () => {
    const { service, prisma } = setup();
    prisma.sysConfig.findUnique.mockResolvedValue(null);
    await expect(
      service.create({ key: 'j', value: '{oops', type: 'JSON', label: 'J' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ key: 'n', value: 'abc', type: 'NUMBER', label: 'N' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sysConfig.create).not.toHaveBeenCalled();
  });

  it('更新不存在的键 → 404', async () => {
    const { service, prisma } = setup();
    prisma.sysConfig.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { value: '1' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('内置参数不允许删除', async () => {
    const { service, prisma } = setup();
    prisma.sysConfig.findUnique.mockResolvedValue({ key: 'site.name', builtin: true });
    await expect(service.remove('site.name')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.sysConfig.delete).not.toHaveBeenCalled();
  });
});

describe('ConfigService 读取与类型转换', () => {
  const withRow = (row: unknown) => {
    const { service, prisma, logger } = setup();
    prisma.sysConfig.findUnique.mockResolvedValue(row);
    return { service, logger };
  };

  it('未配置时返回默认值', async () => {
    const { service } = withRow(null);
    await expect(service.get('x', 'fallback')).resolves.toBe('fallback');
    await expect(service.getBool('x', true)).resolves.toBe(true);
    await expect(service.getNumber('x', 7)).resolves.toBe(7);
    await expect(service.getJson('x', { a: 1 })).resolves.toEqual({ a: 1 });
  });

  it('布尔值支持多种写法', async () => {
    expect(await withRow({ value: 'true' }).service.getBool('k', false)).toBe(true);
    expect(await withRow({ value: 'on' }).service.getBool('k', false)).toBe(true);
    expect(await withRow({ value: '0' }).service.getBool('k', true)).toBe(false);
  });

  it('非法值回退默认并告警（不阻断业务）', async () => {
    const { service, logger } = withRow({ value: 'maybe' });
    expect(await service.getBool('k', false)).toBe(false);
    expect(logger.warnFields).toHaveBeenCalled();

    const n = withRow({ value: 'abc' });
    expect(await n.service.getNumber('k', 3)).toBe(3);

    const j = withRow({ value: '{bad' });
    expect(await j.service.getJson('k', [])).toEqual([]);
  });

  it('JSON 合法值正常解析', async () => {
    const { service } = withRow({ value: '{"a":1}' });
    await expect(service.getJson('k', {})).resolves.toEqual({ a: 1 });
  });
});
