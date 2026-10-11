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
        <!-- 验证码：服务端 LOGIN_CAPTCHA=on 或失败多次（auto）时才会返回，否则不显示 -->
        <el-form-item v-if="captcha">
          <div class="captcha-row">
            <el-input v-model="form.captchaCode" placeholder="验证码" :prefix-icon="Key" />
            <div class="captcha-img" title="点击刷新" @click="loadCaptcha" v-html="captcha.svg" />
          </div>
        </el-form-item>
        <el-button type="primary" class="login-btn" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <div class="login-tip">默认账号 admin / admin123</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { isAxiosError } from "axios";
import { User, Lock, Key } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { authApi, type Captcha } from "@/api/auth";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const captcha = ref<Captcha | null>(null);
const form = reactive({ username: "admin", password: "", captchaCode: "" });

/** 拉取验证码：服务端未启用（或依赖缺失）时返回 null，此时不显示验证码输入 */
async function loadCaptcha() {
  try {
    captcha.value = await authApi.captcha();
  } catch {
    captcha.value = null;
  }
  form.captchaCode = "";
}
onMounted(loadCaptcha);

async function submit() {
  if (!form.username || !form.password) return ElMessage.warning("请输入用户名和密码");
  if (captcha.value && !form.captchaCode) return ElMessage.warning("请输入验证码");
  loading.value = true;
  try {
    // 个人信息/菜单/动态路由统一由路由守卫加载（含强制改密拦截）
    await auth.login({
      username: form.username,
      password: form.password,
      captchaId: captcha.value?.id,
      captchaCode: form.captchaCode || undefined,
    });
    if (auth.passwordExpired) ElMessage.warning("您的密码已超过有效期，请尽快修改");
    router.push((route.query.redirect as string) || "/dashboard");
  } catch (e) {
    // 401（用户名或密码错误）请求拦截器不弹提示，由登录页展示；其余错误拦截器已提示
    if (isAxiosError(e) && e.response?.status === 401) {
      ElMessage.error((e.response.data as { message?: string })?.message || "用户名或密码错误");
    }
    // 412：服务端要求验证码（失败次数过多或强制开启）→ 刷新一张
    if (isAxiosError(e) && e.response?.status === 412) await loadCaptcha();
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
.captcha-row {
  display: flex;
  gap: 10px;
  width: 100%;
}
.captcha-img {
  flex: 0 0 120px;
  height: 40px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: #f5f7fa;
}
.captcha-img :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
.login-tip {
  margin-top: 18px;
  text-align: center;
  color: #aab4c0;
  font-size: 12px;
}
</style>
