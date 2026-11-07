<template>
  <el-result v-if="error" icon="error" title="页面出错了" :sub-title="message">
    <template #extra>
      <el-button type="primary" @click="retry">重新加载本页</el-button>
      <el-button @click="goHome">返回首页</el-button>
    </template>
  </el-result>
  <!-- key 变化 = 整个页面重新创建（重试时用）；display: contents 不影响页面布局 -->
  <div v-else :key="renderKey" class="page-boundary"><slot /></div>
</template>

<script setup lang="ts">
/**
 * 页面级错误边界：子页面渲染/生命周期里抛出未处理的异常时，显示错误提示而不是整块白屏，
 * 侧栏与顶栏仍可正常使用。切换到其他页面时自动恢复。
 * 错误本身仍会继续上报（app.config.errorHandler → 前端日志），便于排查。
 */
import { computed, onErrorCaptured, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

const error = ref<unknown>(null);
const renderKey = ref(0);
const route = useRoute();
const router = useRouter();
const message = computed(() => (error.value instanceof Error ? error.value.message : String(error.value ?? "")).slice(0, 200));

onErrorCaptured((err) => {
  error.value = err;
  return true; // 继续向上传递 → 全局 errorHandler 负责上报
});

// 换页面后清除错误状态
watch(
  () => route.fullPath,
  () => (error.value = null),
);

/** 重新渲染当前页面：清除错误并重建页面组件 */
function retry() {
  error.value = null;
  renderKey.value++;
}

function goHome() {
  error.value = null;
  router.push("/dashboard");
}
</script>

<style scoped>
.page-boundary {
  display: contents;
}
</style>
