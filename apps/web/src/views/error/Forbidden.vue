<template>
  <div class="nf">
    <div class="code">403</div>
    <div class="txt">没有访问该页面的权限</div>
    <div v-if="from" class="sub">请求地址：{{ from }}，如需开通请联系管理员分配角色</div>
    <el-button type="primary" @click="$router.replace('/dashboard')">回首页</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const from = computed(() => (typeof route.query.from === "string" ? route.query.from : ""));
</script>

<style scoped>
.nf {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.code {
  font-size: 72px;
  font-weight: 800;
  color: #e6a23c;
}
.txt {
  color: #606266;
}
.sub {
  color: #8a97a8;
  font-size: 13px;
}
</style>
