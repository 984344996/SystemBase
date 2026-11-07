import { describe, expect, it, vi } from "vitest";
import { usePagedList } from "./usePagedList";

/** 可手动控制完成时机的 Promise */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const page = (list: string[], total = list.length) => ({ list, total, page: 1, pageSize: 10 });

describe("usePagedList", () => {
  it("load：写入列表与总数，期间 loading 为 true", async () => {
    const d = deferred<ReturnType<typeof page>>();
    const list = usePagedList({ page: 1, pageSize: 10 }, () => d.promise);
    const p = list.load();
    expect(list.loading.value).toBe(true);
    d.resolve(page(["a", "b"], 12));
    await p;
    expect(list.rows.value).toEqual(["a", "b"]);
    expect(list.total.value).toBe(12);
    expect(list.loading.value).toBe(false);
  });

  it("search：回到第 1 页再加载", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([]));
    const list = usePagedList({ page: 1, pageSize: 10, keyword: "" }, fetcher);
    list.query.page = 5;
    list.query.keyword = "x";
    await list.search();
    expect(fetcher).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, keyword: "x" }), expect.anything());
  });

  it("reset：恢复初始查询条件", async () => {
    const fetcher = vi.fn().mockResolvedValue(page([]));
    const list = usePagedList({ page: 1, pageSize: 20, keyword: "" }, fetcher);
    Object.assign(list.query, { page: 3, keyword: "abc" });
    await list.reset();
    expect(list.query).toMatchObject({ page: 1, pageSize: 20, keyword: "" });
  });

  it("并发：先发后到的旧响应被丢弃，只采用最后一次请求的结果；旧请求被取消", async () => {
    const first = deferred<ReturnType<typeof page>>();
    const second = deferred<ReturnType<typeof page>>();
    const signals: AbortSignal[] = [];
    const calls = [first, second];
    const list = usePagedList({ page: 1, pageSize: 10 }, (_q, { signal }) => {
      signals.push(signal);
      return calls.shift()!.promise;
    });
    const p1 = list.load();
    const p2 = list.load();
    expect(signals[0].aborted).toBe(true); // 第一次请求已被取消
    second.resolve(page(["new"]));
    await p2;
    first.resolve(page(["old"])); // 旧响应晚到
    await p1;
    expect(list.rows.value).toEqual(["new"]);
    expect(list.loading.value).toBe(false);
  });

  it("被取消的请求不抛错；其他错误照常抛出", async () => {
    const list = usePagedList({ page: 1, pageSize: 10 }, () =>
      Promise.reject(Object.assign(new Error("canceled"), { name: "CanceledError" })),
    );
    await expect(list.load()).resolves.toBeUndefined();

    const failing = usePagedList({ page: 1, pageSize: 10 }, () => Promise.reject(new Error("500")));
    await expect(failing.load()).rejects.toThrow("500");
    expect(failing.loading.value).toBe(false);
  });
});
