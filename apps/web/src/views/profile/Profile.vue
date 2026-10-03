<template>
  <div class="page-card">
    <h3>个人中心</h3>
    <el-form label-width="90px" class="profile-form">
      <el-form-item label="用户名">
        <el-input :model-value="auth.user?.username" disabled />
      </el-form-item>
      <el-form-item label="角色">
        <el-tag v-for="r in auth.user?.roles || []" :key="r" size="small" class="role-tag">{{ r }}</el-tag>
        <span v-if="!auth.user?.roles?.length" class="muted">无</span>
      </el-form-item>
      <el-form-item label="姓名"><el-input v-model="form.name" placeholder="真实姓名" /></el-form-item>
      <el-form-item label="手机号"><el-input v-model="form.phone" placeholder="可留空" /></el-form-item>
      <el-form-item label="邮箱"><el-input v-model="form.email" placeholder="可留空" /></el-form-item>
      <el-form-item>
        <el-button type="primary" @click="save">保存</el-button>
      </el-form-item>
    </el-form>
    <div class="muted tip">用户名与角色由管理员在「用户管理」中维护，本人不可修改。</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const form = reactive({ name: "", phone: "", email: "" });

onMounted(() => {
  form.name = auth.user?.name || "";
  form.phone = auth.user?.phone || "";
  form.email = auth.user?.email || "";
});

async function save() {
  if (!form.name.trim()) return ElMessage.warning("姓名不能为空");
  await authApi.updateProfile({ name: form.name.trim(), phone: form.phone, email: form.email });
  await auth.loadUserContext(); // 顶部栏显示的是缓存的用户信息，改完重新拉取
  ElMessage.success("资料已更新");
}
</script>

<style scoped>
h3 {
  margin: 0 0 16px;
}
.profile-form {
  max-width: 480px;
}
.role-tag {
  margin-right: 6px;
}
.muted {
  color: #8a97a8;
  font-size: 13px;
}
.tip {
  margin-top: 8px;
}
</style>
