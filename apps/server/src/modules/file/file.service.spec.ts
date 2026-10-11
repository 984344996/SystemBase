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
  const logger = { warn: jest.fn(), info: jest.fn(), audit: jest.fn() } as any;
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

  it('可执行扩展名一律拒绝（不只看 mime）', async () => {
    const { service } = setup({ UPLOAD_ALLOWED_MIME: '*' });
    await expect(service.upload(file({ originalname: 'x.sh' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.upload(file({ originalname: 'x.exe' }))).rejects.toBeInstanceOf(BadRequestException);
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
