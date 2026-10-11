<template>
  <el-tag :type="meta.type">{{ meta.label }}</el-tag>
</template>

<script setup lang="ts">
import { computed } from "vue";

/** 状态统一展示：后端枚举值 → 颜色与中文文案；未知值原样灰色显示 */
const props = defineProps<{ status: string }>();

const STATUS_MAP: Record<string, { type: "success" | "danger" | "warning" | "info" | "primary"; label: string }> = {
  ENABLED: { type: "success", label: "启用" },
  DISABLED: { type: "danger", label: "禁用" },
  DRAFT: { type: "info", label: "草稿" },
  PUBLISHED: { type: "success", label: "已发布" },
  OFFLINE: { type: "warning", label: "已下线" },
};

const meta = computed(() => STATUS_MAP[props.status] ?? { type: "info" as const, label: props.status });
</script>
