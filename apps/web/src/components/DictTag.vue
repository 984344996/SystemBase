<template>
  <el-tag v-if="value !== null && value !== undefined && value !== ''" :type="tagType" size="small">{{ text }}</el-tag>
</template>

<script setup lang="ts">
/**
 * 字典标签：把字典值显示成文案（如 ENABLED → 启用），字典在「系统管理 → 数据字典」维护。
 * 用法：<DictTag code="common_status" :value="row.status" />
 *       颜色可选：:types="{ ENABLED: 'success', DISABLED: 'danger' }"（未配置的值为灰色）
 */
import { computed, onMounted } from "vue";
import { useDictStore } from "@/stores/dict";

type TagType = "success" | "danger" | "warning" | "info" | "primary";
const props = defineProps<{ code: string; value?: string | null; types?: Record<string, TagType> }>();

const dict = useDictStore();
onMounted(() => dict.load(props.code).catch(() => undefined));
const text = computed(() => dict.label(props.code, props.value));
const tagType = computed<TagType>(() => (props.value && props.types?.[props.value]) || "info");
</script>
