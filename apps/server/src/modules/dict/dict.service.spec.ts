import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DictService } from './dict.service';
import { PrismaService } from '../../core/prisma/prisma.service';

function setup() {
  const prisma: any = {
    dict: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    dictItem: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new DictService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('DictService 字典类型', () => {
  it('编码重复 → 400', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'user_status' });
    await expect(service.create({ code: 'user_status', name: '状态' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('更新/删除不存在的字典 → 404', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DictService 字典项', () => {
  it('字典不存在时新增项 → 404', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.addItem(9, { label: 'a', value: 'A' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('同字典下选项值重复 → 400', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'user_status' });
    prisma.dictItem.findUnique.mockResolvedValue({ id: 5, value: 'ENABLED' });
    await expect(service.addItem(1, { label: '启用2', value: 'ENABLED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.dictItem.create).not.toHaveBeenCalled();
  });

  it('新增成功', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'user_status' });
    prisma.dictItem.findUnique.mockResolvedValue(null);
    prisma.dictItem.create.mockResolvedValue({ id: 6, label: '待审核', value: 'PENDING' });
    await expect(service.addItem(1, { label: '待审核', value: 'PENDING' })).resolves.toMatchObject({ value: 'PENDING' });
  });
});

describe('DictService 读取', () => {
  it('options() 只返回启用项并按 sort 排序（带缓存）', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({
      code: 'user_status',
      items: [
        { label: '停用', value: 'DISABLED' },
        { label: '启用', value: 'ENABLED' },
      ],
    });
    await expect(service.options('user_status')).resolves.toEqual([
      { label: '停用', value: 'DISABLED' },
      { label: '启用', value: 'ENABLED' },
    ]);
    // 第二次走缓存：不再查库
    await service.options('user_status');
    expect(prisma.dict.findUnique).toHaveBeenCalledTimes(1);
  });

  it('字典不存在 → 404（options）', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.options('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('labelOf：找不到时回退原值，字典缺失也不抛错', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ code: 'user_status', items: [{ label: '启用', value: 'ENABLED' }] });
    await expect(service.labelOf('user_status', 'ENABLED')).resolves.toBe('启用');
    await expect(service.labelOf('user_status', 'UNKNOWN')).resolves.toBe('UNKNOWN');
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.labelOf('nope', 'X')).resolves.toBe('X');
  });
});
