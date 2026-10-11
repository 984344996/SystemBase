<template>
  <div class="force-page">
    <div class="force-card">
      <div class="force-title">
        <span class="dot" />
        请修改密码
      </div>
      <div class="force-sub">
        <template v-if="auth.passwordExpired">您的密码已超过有效期，请设置新密码后继续使用。</template>
        <template v-else>管理员已为您重置密码，出于安全考虑，请先设置新密码再进入系统。</template>
      </div>

      <el-form :model="form" size="large" label-width="88px" @keyup.enter="submit">
        <el-form-item label="当前密码">
          <el-input v-model="form.oldPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="form.newPassword" type="password" show-password placeholder="请输入新密码" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="form.confirm" type="password" show-password placeholder="请再次输入新密码" />
        </el-form-item>
      </el-form>

      <!-- 实时强度提示：与后端 PASSWORD_* 策略保持一致（前端仅作即时反馈，以服务端校验为准） -->
      <div class="strength">
        <div class="bars">
          <span :class="['bar', `lv-${level}`]" v-for="i in 3" :key="i" :style="{ opacity: i <= level ? 1 : 0.25 }" />
        </div>
        <span class="strength-text">{{ strengthText }}</span>
      </div>
      <ul class="rules">
        <li v-for="r in rules" :key="r.text" :class="{ ok: r.pass }">
          <el-icon><component :is="r.pass ? 'CircleCheck' : 'CircleClose'" /></el-icon>
          {{ r.text }}
        </li>
      </ul>

      <div class="actions">
        <el-button link type="primary" @click="onLogout">退出登录</el-button>
        <el-button type="primary" :loading="loading" @click="submit">确认修改</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { authApi } from "@/api/auth";

const auth = useAuthStore();
const router = useRouter();
const loading = ref(false);
const form = reactive({ oldPassword: "", newPassword: "", confirm: "" });

const MIN_LEN = Number(import.meta.env.VITE_PASSWORD_MIN_LENGTH || 8);

const rules = computed(() => [
  { text: `至少 ${MIN_LEN} 位`, pass: form.newPassword.length >= MIN_LEN },
  { text: "含字母与数字组合", pass: /[a-zA-Z]/.test(form.newPassword) && /\d/.test(form.newPassword) },
  { text: "不包含用户名", pass: !!form.newPassword && !form.newPassword.toLowerCase().includes((auth.user?.username || "___").toLowerCase()) },
  { text: "两次输入一致", pass: !!form.newPassword && form.newPassword === form.confirm },
]);
const level = computed(() => Math.min(3, rules.value.filter((r) => r.pass).length));
const strengthText = computed(() => ["太弱", "较弱", "中等", "较强"][level.value]);

async function submit() {
  if (!form.oldPassword || !form.newPassword) return ElMessage.warning("请输入当前密码与新密码");
  if (form.newPassword !== form.confirm) return ElMessage.warning("两次输入的新密码不一致");
  const failed = rules.value.find((r) => !r.pass);
  if (failed) return ElMessage.warning(`密码不符合要求：${failed.text}`);

  loading.value = true;
  try {
    await authApi.changePassword({ oldPassword: form.oldPassword, newPassword: form.newPassword });
    ElMessage.success("密码已更新，请重新登录");
    // 改密后全端下线（后端已吊销 refreshToken），回到登录页重新登录
    await auth.logout();
  } catch {
    /* 错误提示由请求拦截器统一弹出 */
  } finally {
    loading.value = false;
  }
}

function onLogout() {
  auth.logout();
  router.replace("/login");
}
</script>

<style scoped>
.force-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0a1929 0%, #12365f 55%, #1b5a8f 100%);
}
.force-card {
  width: 460px;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 12px;
  padding: 36px 36px 28px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
}
.force-title {
  font-size: 22px;
  font-weight: 700;
  color: #12365f;
  display: flex;
  align-items: center;
  gap: 10px;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(135deg, #409eff, #67c23a);
}
.force-sub {
  margin: 8px 0 22px;
  color: #8a97a8;
  font-size: 13px;
  line-height: 1.6;
}
.strength {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.bars {
  display: flex;
  gap: 6px;
  flex: 1;
}
.bar {
  height: 6px;
  flex: 1;
  border-radius: 3px;
  background: #dcdfe6;
  transition: all 0.25s;
}
.bar.lv-1 { background: #f56c6c; }
.bar.lv-2 { background: #e6a23c; }
.bar.lv-3 { background: #67c23a; }
.strength-text { font-size: 12px; color: #909399; width: 32px; }
.rules {
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  font-size: 12px;
  color: #909399;
}
.rules li { display: flex; align-items: center; gap: 4px; }
.rules li.ok { color: #67c23a; }
.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
