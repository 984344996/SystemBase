import { NotFoundException } from '@nestjs/common';
import { DictService } from './dict.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { localEventBus } from '../../core/redis/testing';
import { BizCode } from '../../core/filter/business.exception';

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
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new DictService(prisma as unknown as PrismaService, localEventBus());
  return { service, prisma };
}

describe('DictService 字典类型', () => {
  it('编码重复 → 409（业务码 40901）', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'user_status' });
    await expect(service.create({ code: 'user_status', name: '状态' })).rejects.toMatchObject({ response: { bizCode: BizCode.DUPLICATE } });
  });

  it('更新/删除不存在的字典 → 404', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.update(404, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DictService 删除字典', () => {
  it('还有选项且未确认 → 409（业务码 40902，附带选项数），不删除', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'c', name: '状态' });
    prisma.dictItem.count.mockResolvedValue(3);
    await expect(service.remove(1)).rejects.toMatchObject({ status: 409, response: { bizCode: BizCode.INVALID_STATE, data: { itemCount: 3 } } });
    expect(prisma.dict.delete).not.toHaveBeenCalled();
  });

  it('force 确认后连同选项一起删除；没有选项时直接删除', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'c', name: '状态' });
    prisma.dictItem.count.mockResolvedValue(3);
    await expect(service.remove(1, true)).resolves.toEqual({ success: true });
    prisma.dictItem.count.mockResolvedValue(0);
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(prisma.dict.delete).toHaveBeenCalledTimes(2);
  });
});

describe('DictService 字典项', () => {
  it('字典不存在时新增项 → 404', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue(null);
    await expect(service.addItem(9, { label: 'a', value: 'A' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('同字典下选项值重复 → 409（业务码 40901）', async () => {
    const { service, prisma } = setup();
    prisma.dict.findUnique.mockResolvedValue({ id: 1, code: 'user_status' });
    prisma.dictItem.findUnique.mockResolvedValue({ id: 5, value: 'ENABLED' });
    await expect(service.addItem(1, { label: '启用2', value: 'ENABLED' })).rejects.toMatchObject({ response: { bizCode: BizCode.DUPLICATE } });
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

describe('DictService 缓存并发', () => {
  it('查库期间发生失效：查到的结果不写回缓存（下次重新查库，拿到新数据）', async () => {
    const { service, prisma } = setup();
    let resolveQuery: (v: unknown) => void = () => undefined;
    prisma.dict.findUnique.mockImplementationOnce(() => new Promise((r) => (resolveQuery = r)));
    const pending = service.options('c');
    (service as any).invalidate('c'); // 查询还没返回时有人改了字典
    resolveQuery({ id: 1, code: 'c', items: [{ label: '旧', value: 'old' }] });
    await expect(pending).resolves.toEqual([{ label: '旧', value: 'old' }]);
    prisma.dict.findUnique.mockResolvedValueOnce({ id: 1, code: 'c', items: [{ label: '新', value: 'new' }] });
    await expect(service.options('c')).resolves.toEqual([{ label: '新', value: 'new' }]);
  });
});
