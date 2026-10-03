<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-title">
        <span class="dot" />
        SystemBase
      </div>
      <div class="login-sub">前后端分离基础框架 · 管理端</div>
      <el-form :model="form" size="large" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" show-password :prefix-icon="Lock" />
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div class="login-tip">默认账号 admin / admin123</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { isAxiosError } from "axios";
import { User, Lock } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const form = reactive({ username: "admin", password: "" });

async function submit() {
  if (!form.username || !form.password) return ElMessage.warning("请输入用户名和密码");
  loading.value = true;
  try {
    await auth.login(form);
    // 个人信息/菜单/动态路由统一由路由守卫加载
    router.push((route.query.redirect as string) || "/dashboard");
  } catch (e) {
    // 401（用户名或密码错误）请求拦截器不弹提示，由登录页展示；其余错误拦截器已提示
    if (isAxiosError(e) && e.response?.status === 401) {
      ElMessage.error((e.response.data as { message?: string })?.message || "用户名或密码错误");
    }
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0a1929 0%, #12365f 55%, #1b5a8f 100%);
}
.login-card {
  width: 380px;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 12px;
  padding: 40px 36px 28px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}
.login-title {
  font-size: 24px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #12365f;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(135deg, #409eff, #67c23a);
}
.login-sub {
  margin: 8px 0 28px;
  color: #8a97a8;
  font-size: 13px;
}
.login-btn {
  width: 100%;
  margin-top: 4px;
}
.login-tip {
  margin-top: 18px;
  text-align: center;
  color: #aab4c0;
  font-size: 12px;
}
</style>
