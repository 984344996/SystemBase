<template>
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
</template>

<script setup lang="ts">
/**
 * 列表页统一分页条（与 usePagedList 配套）：
 * 翻页直接重新加载；改 pageSize 回到第 1 页再加载（避免落在超出范围的空页）。
 */
const props = withDefaults(
  defineProps<{
    query: { page: number; pageSize: number };
    total: number;
    load: () => unknown;
    pageSizes?: number[];
    layout?: string;
  }>(),
  { pageSizes: () => [10, 20, 50], layout: "total, sizes, prev, pager, next" },
);

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
