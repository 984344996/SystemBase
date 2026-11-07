<template>
  <el-popover v-model:visible="open" placement="bottom-start" :width="420" trigger="click">
    <template #reference>
      <el-input :model-value="modelValue" placeholder="点击选择图标" readonly clearable @clear="pick('')">
        <template #prefix><MenuIcon :name="modelValue" /></template>
      </el-input>
    </template>
    <el-input v-model="keyword" placeholder="搜索图标名，如 user" clearable size="small" class="icon-search" />
    <div v-if="!icons" class="icon-empty">图标加载中…</div>
    <div v-else class="icon-grid">
      <div
        v-for="name in filtered"
        :key="name"
        :class="['icon-cell', { active: name === modelValue }]"
        :title="name"
        @click="pick(name)"
      >
        <MenuIcon :name="name" :size="18" />
      </div>
      <div v-if="!filtered.length" class="icon-empty">没有匹配的图标</div>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
/**
 * 图标选择器：点击输入框弹出全部 Element Plus 图标，可按名称搜索；v-model 绑定图标名（字符串）。
 * 用法：<IconPicker v-model="form.icon" />
 */
import { computed, ref } from "vue";
import MenuIcon from "./MenuIcon.vue";
import { iconNames, useIconSet } from "@/composables/useIconSet";

defineProps<{ modelValue?: string | null }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const open = ref(false);
const keyword = ref("");
const icons = useIconSet();
/** 按关键字过滤（不区分大小写），最多显示 240 个，避免一次渲染过多 */
const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return iconNames(icons.value)
    .filter((n) => !k || n.toLowerCase().includes(k))
    .slice(0, 240);
});

/** 选中后关闭弹层 */
function pick(name: string) {
  emit("update:modelValue", name);
  open.value = false;
}
</script>

<style scoped>
.icon-search {
  margin-bottom: 8px;
}
.icon-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
  max-height: 260px;
  overflow-y: auto;
}
.icon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--el-text-color-regular);
}
.icon-cell:hover {
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}
.icon-cell.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.icon-empty {
  grid-column: 1 / -1;
  padding: 16px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}
</style>
