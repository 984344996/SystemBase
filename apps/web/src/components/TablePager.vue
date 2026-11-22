<template>
  <div class="pager-row">
    <!-- 加载失败：表格里可能还是上一次的数据，明确提示并提供重试 -->
    <span v-if="error" class="pager-error">
      {{ error }}，<el-link type="primary" :underline="false" @click="retry">重试</el-link>
    </span>
    <el-pagination
    :current-page="query.page"
    :page-size="query.pageSize"
    :total="total"
    :page-sizes="pageSizes"
    :layout="layout"
    class="pager"
    @update:current-page="onPage"
    @update:page-size="onSize"
    />
  </div>
</template>

<script setup lang="ts">
/* eslint-disable vue/no-mutating-props -- 设计如此：query 是 usePagedList 返回的响应式查询对象，由分页条直接改页码 */
/**
 * 列表页统一分页条（与 usePagedList 配套）：
 * 翻页直接重新加载；改 pageSize 回到第 1 页再加载（避免落在超出范围的空页）。
 */
const props = withDefaults(
  defineProps<{
    query: { page: number; pageSize: number };
    total: number;
    load: () => unknown;
    /** usePagedList 的 error：有值时在分页条左侧显示「加载失败，重试」 */
    error?: string | null;
    pageSizes?: number[];
    layout?: string;
  }>(),
  { error: null, pageSizes: () => [10, 20, 50], layout: "total, sizes, prev, pager, next" },
);

function retry() {
  Promise.resolve(props.load()).catch(() => undefined); // 错误提示由请求层弹出
}

function onPage(page: number) {
  props.query.page = page;
  props.load();
}

function onSize(size: number) {
  props.query.pageSize = size;
  props.query.page = 1;
  props.load();
}
</script>

<style scoped>
.pager-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.pager-error {
  margin-top: 12px;
  font-size: 13px;
  color: var(--el-color-danger);
}
</style>
