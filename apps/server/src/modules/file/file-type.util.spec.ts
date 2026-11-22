import { EXT_MIME, RISKY_EXT, contentMatches } from './file-type.util';

/** 文件类型识别是安全相关逻辑：扩展名白名单 + 文件头魔数双重校验，防止伪装扩展名上传脚本 */
describe('file-type.util', () => {
  const bytes = (...b: number[]) => Buffer.from(b);

  it('图片 / PDF：文件头魔数必须与声明的类型一致', () => {
    expect(contentMatches('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(true);
    expect(contentMatches('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(contentMatches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    // 扩展名是 .png，内容却是 HTML / 脚本 → 拒绝
    expect(contentMatches('image/png', Buffer.from('<script>alert(1)</script>'))).toBe(false);
    expect(contentMatches('image/jpeg', Buffer.from('<?php echo 1; ?>'))).toBe(false);
  });

  it('WebP 需同时匹配 RIFF 头与 WEBP 标记', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WEBP')]);
    expect(contentMatches('image/webp', webp)).toBe(true);
    expect(contentMatches('image/webp', Buffer.concat([Buffer.from('RIFF'), bytes(0, 0, 0, 0), Buffer.from('WAVE')]))).toBe(false);
  });

  it('Office 文档按 zip 头识别；文本类型不能含二进制 0 字节', () => {
    expect(contentMatches(EXT_MIME['.docx'], bytes(0x50, 0x4b, 0x03, 0x04, 1, 2))).toBe(true);
    expect(contentMatches(EXT_MIME['.xlsx'], Buffer.from('not zip'))).toBe(false);
    expect(contentMatches('text/plain', Buffer.from('普通文本'))).toBe(true);
    expect(contentMatches('text/plain', bytes(0x4d, 0x5a, 0x00, 0x00))).toBe(false); // 伪装成 txt 的可执行文件
  });

  it('未知类型一律不通过', () => {
    expect(contentMatches('application/x-unknown', Buffer.from('x'))).toBe(false);
  });

  it('高危扩展名覆盖可执行文件、服务端脚本与浏览器可执行文档', () => {
    for (const ext of ['.exe', '.sh', '.php', '.phar', '.jsp', '.html', '.shtml', '.svg', '.mht', '.hta', '.jar', '.lnk']) {
      expect(RISKY_EXT).toContain(ext);
    }
    // 白名单里的类型不能同时出现在黑名单里
    for (const ext of Object.keys(EXT_MIME)) expect(RISKY_EXT).not.toContain(ext);
  });
});
