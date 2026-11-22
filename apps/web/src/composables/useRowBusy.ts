import { ref } from "vue";

/**
 * 表格行内操作的「进行中」状态（删除、启停等）：按钮显示 loading，同一时间只处理一个，防止重复点击。
 *
 *   const { busyId: deletingId, run: runDelete } = useRowBusy();
 *   <el-popconfirm @confirm="runDelete(row.id, () => remove(row))">
 *     <el-button :loading="deletingId === row.id">删除</el-button>
 */
export function useRowBusy<K extends string | number = number>() {
  const busyId = ref<K>();
  async function run<T>(id: K, fn: () => Promise<T>): Promise<T | undefined> {
    if (busyId.value !== undefined) return undefined;
    busyId.value = id;
    try {
      return await fn();
    } finally {
      busyId.value = undefined;
    }
  }
  return { busyId, run };
}
