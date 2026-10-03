<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <span class="brand-dot" />
        SystemBase
      </div>
      <el-menu
        :default-active="$route.path"
        router
        background-color="#001529"
        text-color="rgba(255,255,255,0.68)"
        active-text-color="#fff"
        class="menu"
      >
        <template v-for="item in menus" :key="item.id">
          <el-sub-menu v-if="item.children?.length" :index="item.path || `dir-${item.id}`">
            <template #title>
              <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
              <span>{{ item.name }}</span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.id" :index="child.path || ''">
              {{ child.name }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path || ''">
            <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
            <span>{{ item.name }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-title">{{ ($route.meta.title as string) || "仪表盘" }}</div>
        <el-dropdown @command="onCommand">
          <span class="user-chip">
            <el-avatar :size="26" class="avatar">{{ auth.user?.name?.charAt(0) }}</el-avatar>
            {{ auth.user?.name }}
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">个人中心</el-dropdown-item>
              <el-dropdown-item command="password">修改密码</el-dropdown-item>
              <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 修改密码弹窗 -->
    <el-dialog v-model="pwdVisible" title="修改密码" width="420px" append-to-body>
      <el-form label-width="80px">
        <el-form-item label="原密码">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPassword">确认修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { authApi } from "@/api/auth";

const router = useRouter();
const auth = useAuthStore();
const menus = computed(() => auth.menus);

const pwdVisible = ref(false);
const pwdForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });

function onCommand(cmd: string) {
  if (cmd === "logout") auth.logout();
  if (cmd === "profile") router.push("/profile");
  if (cmd === "password") {
    pwdForm.oldPassword = "";
    pwdForm.newPassword = "";
    pwdForm.confirm = "";
    pwdVisible.value = true;
  }
}

async function submitPassword() {
  if (!pwdForm.oldPassword || pwdForm.newPassword.length < 6) return ElMessage.warning("请填写完整，新密码至少 6 位");
  if (pwdForm.newPassword !== pwdForm.confirm) return ElMessage.warning("两次输入的新密码不一致");
  await authApi.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
  ElMessage.success("密码已修改，请重新登录");
  pwdVisible.value = false;
  setTimeout(() => auth.logout(), 800);
}
</script>

<style scoped>
.layout {
  min-height: 100vh;
}
.aside {
  background: #001529;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(135deg, #409eff, #67c23a);
}
.menu {
  border-right: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.header-title {
  font-size: 16px;
  font-weight: 600;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: #333;
}
.avatar {
  background: #409eff;
  color: #fff;
}
.main {
  padding: 16px;
}
</style>
