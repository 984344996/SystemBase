import { reactive, ref, type Ref } from "vue";
import type { PageResult } from "@sb/shared";

/**
 * 列表页通用逻辑：查询条件 + 分页 + 加载状态。
 *
 * 约定：
 *  - 查询按钮绑 search()（先回到第 1 页再加载，避免第 N 页改条件后拿到空页）
 *  - 分页条用 <TablePager>（翻页直接 load，改 pageSize 自动回第 1 页）
 */
export function usePagedList<Q extends { page: number; pageSize: number }, T>(
  defaultQuery: Q,
  fetcher: (query: Q) => Promise<PageResult<T>>,
) {
  const query = reactive({ ...defaultQuery }) as Q;
  const rows = ref([]) as Ref<T[]>;
  const total = ref(0);
  const loading = ref(false);

  async function load() {
    loading.value = true;
    try {
      const res = await fetcher(query);
      rows.value = res.list;
      total.value = res.total;
    } finally {
      loading.value = false;
    }
  }

  /** 查询条件变化：回到第 1 页再加载 */
  function search() {
    query.page = 1;
    return load();
  }

  return { query, rows, total, loading, load, search };
}
