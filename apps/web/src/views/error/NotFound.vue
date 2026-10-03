<template>
  <div class="nf">
    <div class="code">404</div>
    <div class="txt">页面不存在，或未分配该页面的菜单权限</div>
    <el-button type="primary" @click="$router.replace('/dashboard')">回首页</el-button>
  </div>
</template>

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
  color: #409eff;
}
.txt {
  color: #8a97a8;
}
</style>
