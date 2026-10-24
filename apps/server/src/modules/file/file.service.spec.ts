import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileService } from './file.service';
import { PrismaService } from '../../core/prisma/prisma.service';

const dir = mkdtempSync(join(tmpdir(), 'sb-upload-'));

function setup(env: Record<string, string> = {}) {
  const prisma: any = {
    file: {
      findFirst: jest.fn(),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const logger = { warn: jest.fn(), warnFields: jest.fn(), info: jest.fn(), audit: jest.fn() } as any;
  const service = new FileService(
    prisma as unknown as PrismaService,
    new ConfigService({ UPLOAD_DIR: dir, ...env }),
    logger,
  );
  return { service, prisma };
}

const file = (over: Record<string, unknown> = {}) =>
  ({
    originalname: 'a.txt',
    mimetype: 'text/plain',
    size: 10,
    buffer: Buffer.from('hello'),
    ...over,
  }) as never;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('FileService.upload 校验', () => {
  it('超过大小上限 → 400', async () => {
    const { service } = setup({ UPLOAD_MAX_SIZE: '5' });
    await expect(service.upload(file({ size: 100 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('类型不在白名单 → 400', async () => {
    const { service } = setup({ UPLOAD_ALLOWED_MIME: 'image/png' });
    await expect(service.upload(file({ mimetype: 'text/plain' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('可执行/可运行脚本的扩展名一律拒绝（含 html/svg，不只看 mime）', async () => {
    const { service } = setup({ UPLOAD_ALLOWED_MIME: '*' });
    for (const name of ['x.sh', 'x.exe', 'x.html', 'x.svg', 'x.php']) {
      await expect(service.upload(file({ originalname: name }))).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('不信任客户端 mime：.txt 声明成 image/png 也按扩展名判定为 text/plain', async () => {
    const { service } = setup();
    const row = await service.upload(file({ mimetype: 'image/png' }));
    expect(row.mime).toBe('text/plain');
  });

  it('魔数校验：改扩展名伪装（文本内容命名为 .png）→ 400', async () => {
    const { service } = setup();
    await expect(service.upload(file({ originalname: 'fake.png', mimetype: 'image/png' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('魔数校验：真实 PNG 文件头通过', async () => {
    const { service } = setup();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const row = await service.upload(file({ originalname: 'ok.png', buffer: png, size: png.length }));
    expect(row.mime).toBe('image/png');
  });

  it('空内容 → 400', async () => {
    const { service } = setup();
    await expect(service.upload({} as never)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FileService.upload 落盘', () => {
  it('写入文件并返回元信息（按 yyyyMM 分目录）', async () => {
    const { service, prisma } = setup();
    const row = await service.upload(file({ originalname: 'note.txt' }), 7);
    expect(row.name).toBe('note.txt');
    expect(row.uploaderId).toBe(7);
    expect(row.path).toMatch(/^\d{6}\//);
    const abs = join(dir, row.path);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, 'utf8')).toBe('hello');
    expect(prisma.file.create).toHaveBeenCalled();
  });

  it('入库失败：已落盘的实体被清理，不留孤儿文件', async () => {
    const { service, prisma } = setup();
    let written = '';
    prisma.file.create.mockImplementation(({ data }: any) => {
      written = join(dir, data.path);
      return Promise.reject(new Error('db down'));
    });
    await expect(service.upload(file())).rejects.toThrow('db down');
    expect(existsSync(written)).toBe(false);
  });
});

describe('FileService.purge（由 system.cleanup 定期调用）', () => {
  it('物理删除软删超期的实体与记录，实体已不存在也删记录', async () => {
    const { service, prisma } = setup();
    const row = await service.upload(file({ originalname: 'old.txt' }));
    const abs = join(dir, row.path);
    prisma.file.findMany.mockResolvedValue([
      { id: 1, path: row.path },
      { id: 2, path: '202001/missing.txt' },
    ]);
    await expect(service.purge(7)).resolves.toBe(2);
    expect(existsSync(abs)).toBe(false);
    expect(prisma.file.delete).toHaveBeenCalledTimes(2);
  });
});

describe('FileService 下载与删除', () => {
  it('文件不存在 → 404', async () => {
    const { service, prisma } = setup();
    prisma.file.findFirst.mockResolvedValue(null);
    await expect(service.open(404)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('记录存在但实体丢失 → 404', async () => {
    const { service, prisma } = setup();
    prisma.file.findFirst.mockResolvedValue({ id: 1, path: '202610/gone.txt', name: 'gone.txt', size: 1 });
    await expect(service.open(1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('删除为软删除（不物理删除）', async () => {
    const { service, prisma } = setup();
    prisma.file.findFirst.mockResolvedValue({ id: 1, deletedAt: null });
    await expect(service.remove(1)).resolves.toEqual({ success: true });
    expect(prisma.file.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { deletedAt: expect.any(Date) } });
  });
});
