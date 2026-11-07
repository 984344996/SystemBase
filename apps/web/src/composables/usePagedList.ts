import { onBeforeUnmount, reactive, ref, type Ref } from "vue";
import type { PageResult } from "@sb/shared";

/** fetcher 的第二个参数：把 signal 传给请求，切换条件/离开页面时取消上一次请求 */
export interface FetchOptions {
  signal: AbortSignal;
}

/**
 * 列表页通用逻辑：查询条件 + 分页 + 加载状态。
 *
 * 约定：
 *  - 查询按钮绑 search()（先回到第 1 页再加载，避免第 N 页改条件后拿到空页）
 *  - 分页条用 <TablePager>（翻页直接 load，改 pageSize 自动回第 1 页）
 *  - 表格绑 v-loading="loading"
 *  - 查询条件里的空字符串不用手动转 undefined：请求层会自动去掉空参数
 *
 * 并发安全：快速连续查询时，只采用最后一次请求的结果（先发后到的旧响应会被丢弃）；
 * 若 fetcher 把 opts.signal 传给了请求（request.get(url, { params, signal })），旧请求还会被直接取消。
 * 组件卸载时取消进行中的请求。
 */
export function usePagedList<Q extends { page: number; pageSize: number }, T>(
  defaultQuery: Q,
  fetcher: (query: Q, opts: FetchOptions) => Promise<PageResult<T>>,
) {
  const query = reactive({ ...defaultQuery }) as Q;
  const rows = ref([]) as Ref<T[]>;
  const total = ref(0);
  const loading = ref(false);

  let seq = 0; // 请求序号：只有最新一次的响应才写入列表
  let controller: AbortController | null = null;

  async function load() {
    const mySeq = ++seq;
    controller?.abort(); // 取消上一次还没回来的请求
    controller = new AbortController();
    loading.value = true;
    try {
      const res = await fetcher(query, { signal: controller.signal });
      if (mySeq !== seq) return; // 已有更新的请求，丢弃旧结果
      rows.value = res.list;
      total.value = res.total;
    } catch (e) {
      // 被取消的请求静默忽略；其他错误交给请求层提示后继续抛出
      if (mySeq !== seq || isAbort(e)) return;
      throw e;
    } finally {
      if (mySeq === seq) loading.value = false;
    }
  }

  /** 查询条件变化：回到第 1 页再加载 */
  function search() {
    query.page = 1;
    return load();
  }

  /** 重置查询条件为初始值并回到第 1 页 */
  function reset() {
    Object.assign(query, { ...defaultQuery });
    return load();
  }

  // 在组件 setup 中使用时：离开页面取消进行中的请求
  try {
    onBeforeUnmount(() => {
      seq++;
      controller?.abort();
    });
  } catch {
    /* 不在组件 setup 中调用（如单测）时忽略 */
  }

  return { query, rows, total, loading, load, search, reset };
}

/** 是否为取消请求导致的错误（axios 的 CanceledError / 原生 AbortError） */
function isAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name;
  return name === "CanceledError" || name === "AbortError" || (e as { code?: string } | null)?.code === "ERR_CANCELED";
}
