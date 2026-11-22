import { describe, expect, it } from "vitest";
import { useRowBusy } from "./useRowBusy";

describe("useRowBusy", () => {
  it("执行期间 busyId 为当前行，结束后清空；同时只处理一个（重复点击被忽略）", async () => {
    const { busyId, run } = useRowBusy();
    let resolve: () => void = () => undefined;
    let calls = 0;
    const p = run(1, () => {
      calls++;
      return new Promise<void>((r) => (resolve = r));
    });
    expect(busyId.value).toBe(1);
    await run(2, async () => void calls++); // 忽略
    resolve();
    await p;
    expect(calls).toBe(1);
    expect(busyId.value).toBeUndefined();
  });

  it("失败也会清空 busyId，错误继续抛给调用方", async () => {
    const { busyId, run } = useRowBusy();
    await expect(run(1, () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(busyId.value).toBeUndefined();
  });
});
