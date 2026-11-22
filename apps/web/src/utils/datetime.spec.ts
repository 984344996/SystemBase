import { beforeAll, describe, expect, it } from "vitest";
import { formatSize, formatTime } from "./datetime";

// 固定按北京时间断言（Node 支持运行时修改 TZ）
beforeAll(() => {
  process.env.TZ = "Asia/Shanghai";
});

describe("formatTime", () => {
  it("UTC ISO 串（接口里的 createdAt 等）换算成本地时间", () => {
    expect(formatTime("2026-11-22T02:03:04.567Z")).toBe("2026-11-22 10:03:04");
    expect(formatTime("2026-11-21T20:00:00Z")).toBe("2026-11-22 04:00:00"); // 跨天
    expect(formatTime("2026-11-22T10:03:04+08:00")).toBe("2026-11-22 10:03:04");
  });

  it("不带时区的本地时间串（日志 time / 任务执行 startedAt）只截取，不换算", () => {
    expect(formatTime("2026-11-22 10:03:04.567")).toBe("2026-11-22 10:03:04");
    expect(formatTime("2026-11-22T10:03:04")).toBe("2026-11-22 10:03:04");
  });

  it("Date 对象按本地时间格式化；空值显示 -；非法值原样返回", () => {
    expect(formatTime(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02 11:04:05");
    expect(formatTime(null)).toBe("-");
    expect(formatTime("")).toBe("-");
    expect(formatTime("not-a-dateZ")).toBe("not-a-dateZ");
  });
});

describe("formatSize", () => {
  it("B / KB / MB", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
