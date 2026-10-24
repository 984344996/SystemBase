/**
 * 上传文件类型判定：不信任客户端声明的 Content-Type，按「扩展名白名单 + 文件头魔数」双重校验，
 * 并由服务端决定落库 mime（下载时据此输出 Content-Type）。
 */

/** 允许的扩展名 → 服务端认定的 mime */
export const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** UPLOAD_ALLOWED_MIME=* 时仍然拒绝的高危扩展名（可执行 / 可在浏览器里运行脚本） */
export const RISKY_EXT = [
  '.exe', '.dll', '.bat', '.cmd', '.com', '.msi', '.sh', '.ps1', '.vbs',
  '.php', '.phtml', '.jsp', '.asp', '.aspx', '.cgi', '.py', '.pl', '.rb',
  '.js', '.mjs', '.cjs', '.html', '.htm', '.xhtml', '.svg', '.xml',
];

const TEXT_MIME = new Set(['text/plain', 'text/csv', 'text/markdown']);
const ZIP_BASED = new Set([
  'application/zip',
  EXT_MIME['.docx'],
  EXT_MIME['.xlsx'],
  EXT_MIME['.pptx'],
]);

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/** 文件内容是否与认定的 mime 一致（魔数校验；文本类要求不含 NUL 字节） */
export function contentMatches(mime: string, buf: Buffer): boolean {
  if (TEXT_MIME.has(mime)) return !buf.subarray(0, 8192).includes(0);
  if (ZIP_BASED.has(mime)) return startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buf, [0x50, 0x4b, 0x05, 0x06]);
  switch (mime) {
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case 'application/pdf':
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    default:
      return false;
  }
}
