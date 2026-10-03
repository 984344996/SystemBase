const pad = (n: number) => String(n).padStart(2, "0");

/** Date / ISO / 日志 time 字符串 -> "YYYY-MM-DD HH:mm:ss" */
export function formatTime(v?: string | Date | null): string {
  if (!v) return "-";
  const s = typeof v === "string" ? v : v.toISOString();
  return s.replace("T", " ").slice(0, 19);
}

/** 今天的本地日期 "YYYY-MM-DD"（日志按天查询的默认值） */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 字节数 -> 可读大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
