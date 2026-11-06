import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRelease } from './health.controller';

describe('readRelease', () => {
  let root: string;
  let serverDir: string;

  beforeEach(() => {
    // 模拟发布目录结构：<版本目录>/RELEASE 与 <版本目录>/apps/server（进程工作目录）
    root = mkdtempSync(join(tmpdir(), 'sb-release-'));
    serverDir = join(root, 'apps', 'server');
    mkdirSync(serverDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('读取 RELEASE 中的 14 位版本号', () => {
    writeFileSync(join(root, 'RELEASE'), 'release=20261106120000\nenv=remote-pre\ncommit=abc123\n');
    expect(readRelease(serverDir)).toBe('20261106120000');
  });

  it('兼容 CRLF 换行', () => {
    writeFileSync(join(root, 'RELEASE'), 'release=20261106120000\r\nenv=remote-pre\r\n');
    expect(readRelease(serverDir)).toBe('20261106120000');
  });

  it('没有 RELEASE 文件（本地开发）返回 undefined', () => {
    expect(readRelease(serverDir)).toBeUndefined();
  });

  it('格式不对返回 undefined', () => {
    writeFileSync(join(root, 'RELEASE'), 'release=abc\n');
    expect(readRelease(serverDir)).toBeUndefined();
  });
});
