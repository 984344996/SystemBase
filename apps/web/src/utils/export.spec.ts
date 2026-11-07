import { describe, expect, it, vi } from "vitest";
import { exportPaged, toCsv } from "./export";

describe("toCsv", () => {
  const cols = [
    { title: "名称", value: (r: { name: string; n?: number }) => r.name },
    { title: "数量", value: (r: { name: string; n?: number }) => r.n },
  ];

  it("带 UTF-8 BOM（Excel 打开中文不乱码），CRLF 换行", () => {
    const csv = toCsv([{ name: "张三", n: 1 }], cols);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.slice(1)).toBe("名称,数量\r\n张三,1");
  });

  it("逗号、引号、换行要加引号并转义；空值输出空", () => {
    const csv = toCsv([{ name: 'a,"b"\nc' }], cols).slice(1);
    expect(csv.split("\r\n")[1]).toBe('"a,""b""\nc",');
  });

  it("以 = + - @ 开头的值加单引号，防止被 Excel 当公式执行", () => {
    const csv = toCsv([{ name: "=HYPERLINK(\"x\")" }, { name: "-1" }], cols).slice(1).split("\r\n");
    expect(csv[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(csv[2]).toBe("'-1,");
  });
});

describe("exportPaged", () => {
  it("逐页拉取直到取完，然后下载", async () => {
    const urls: string[] = [];
    vi.stubGlobal("URL", { createObjectURL: () => (urls.push("blob:1"), "blob:1"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const all = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    const fetchPage = vi.fn(async (q: { page: number; pageSize: number }) => ({
      list: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: all.length,
      page: q.page,
      pageSize: q.pageSize,
    }));
    const count = await exportPaged(fetchPage, { keyword: "k" }, [{ title: "ID", value: (r) => r.id }], "a.csv");
    expect(count).toBe(150);
    expect(fetchPage).toHaveBeenCalledTimes(2); // 每页 100 条
    expect(fetchPage.mock.calls[0][0]).toMatchObject({ keyword: "k", page: 1, pageSize: 100 });
    expect(click).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
