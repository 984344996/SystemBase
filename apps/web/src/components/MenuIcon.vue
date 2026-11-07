<template>
  <el-icon v-if="comp" :size="size"><component :is="comp" /></el-icon>
</template>

<script setup lang="ts">
/**
 * 按名称渲染 Element Plus 图标（菜单、图标选择器等「图标名存在数据库里」的场景用）。
 *
 * 为什么不全局注册全部图标：300 多个图标组件会全部打进首屏主包。这里改为按需异步加载整套图标
 * （单独一个 chunk，首次用到时下载一次，之后走缓存），首屏体积更小。
 * 代码里写死的图标也用它（<MenuIcon name="Bell" />），不要 import { Bell } from "@element-plus/icons-vue"：
 * 该包是单个文件，任何静态引用都会把全部图标拉回首屏主包。
 *
 * 用法：<MenuIcon name="Setting" />；名称不存在时不渲染
 */
import { computed } from "vue";
import { useIconSet } from "@/composables/useIconSet";

const props = defineProps<{ name?: string | null; size?: number | string }>();
const icons = useIconSet();
const comp = computed(() => (props.name && icons.value ? icons.value[props.name] : undefined));
</script>
