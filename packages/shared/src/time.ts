/** "HH:mm" -> 分钟数 */
export function timeToMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 分钟数 -> "HH:mm" */
export function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Date -> "YYYY-MM-DD"（本地时区） */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface Interval {
  start: number;
  end: number;
}

/** 区间 [a.start,a.end) 与 [b.start,b.end) 是否重叠 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 批量检测一组区间的首个冲突。
 * 返回冲突对；无冲突返回 null。
 */
export function findFirstConflict(items: (Interval & { key?: string })[]): {
  a: Interval & { key?: string };
  b: Interval & { key?: string };
} | null {
  const sorted = [...items].sort((x, y) => x.start - y.start);
  for (let i = 1; i < sorted.length; i++) {
    if (overlaps(sorted[i - 1], sorted[i])) {
      return { a: sorted[i - 1], b: sorted[i] };
    }
  }
  return null;
}

/** 日期字符串是否早于今天（本地时区），仅支持 YYYY-MM-DD */
export function isPastDate(dateStr: string): boolean {
  return dateStr < toDateStr(new Date());
}
