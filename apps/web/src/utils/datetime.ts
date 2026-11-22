const pad = (n: number) => String(n).padStart(2, "0");

/** 结尾带时区（Z 或 ±hh:mm / ±hhmm）的时间串：表示一个绝对时刻，需要换算成本地时间 */
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Date 按浏览器本地时区格式化为 "YYYY-MM-DD HH:mm:ss" */
function localString(d: Date): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 时间显示为 "YYYY-MM-DD HH:mm:ss"（本地时区）
 *   - 接口里的实体时间（createdAt 等）是 UTC ISO 串（带 Z）：换算成本地时间
 *     （原来只把 T 换成空格再截断，全站时间比北京时间慢 8 小时）
 *   - 不带时区的串（日志的 time、任务执行记录的 startedAt）本身就是服务器本地时间：只做截取
 */
export function formatTime(v?: string | Date | null): string {
  if (!v) return "-";
  if (typeof v === "string" && !HAS_TZ.test(v)) return v.replace("T", " ").slice(0, 19);
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? String(v) : localString(d);
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
