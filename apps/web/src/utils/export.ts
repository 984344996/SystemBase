import type { PageResult } from "@sb/shared";
import { MAX_PAGE_SIZE } from "@sb/shared";

/** 导出列定义：title 为表头；value 取单元格值（可做格式化，如时间、字典文案） */
export interface ExportColumn<T> {
  title: string;
  value: (row: T) => unknown;
}

/** 单次导出的最大行数（防止误导出几十万行把浏览器卡死；需要更多请做后端导出） */
export const EXPORT_MAX_ROWS = 10_000;

/** CSV 单元格转义：含逗号/引号/换行时用双引号包起来；以 = + - @ 开头的加单引号，防止被 Excel 当成公式执行 */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 生成 CSV 文本（UTF-8 BOM：Excel 直接打开中文不乱码） */
export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.title)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","));
  return "\uFEFF" + lines.join("\r\n");
}

/** 触发浏览器下载 */
export function downloadText(content: string, filename: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 按当前查询条件逐页拉取全部数据并导出 CSV（Excel 可直接打开）。
 * @param fetchPage 列表接口（与 usePagedList 的 fetcher 相同）
 * @param query     当前查询条件（page/pageSize 会被覆盖）
 * @returns 导出的行数；超过 EXPORT_MAX_ROWS 时只导出前 EXPORT_MAX_ROWS 行
 *
 * 用法：
 *   await exportPaged((q) => userApi.list(q), query, [
 *     { title: "用户名", value: (r) => r.username },
 *     { title: "创建时间", value: (r) => formatTime(r.createdAt) },
 *   ], "用户列表.csv");
 */
export async function exportPaged<Q extends object, T>(
  fetchPage: (q: Q & { page: number; pageSize: number }) => Promise<PageResult<T>>,
  query: Q,
  columns: ExportColumn<T>[],
  filename: string,
): Promise<number> {
  const all: T[] = [];
  for (let page = 1; all.length < EXPORT_MAX_ROWS; page++) {
    const res = await fetchPage({ ...query, page, pageSize: MAX_PAGE_SIZE });
    all.push(...res.list);
    if (res.list.length < MAX_PAGE_SIZE || all.length >= res.total) break;
  }
  const rows = all.slice(0, EXPORT_MAX_ROWS);
  downloadText(toCsv(rows, columns), filename);
  return rows.length;
}
