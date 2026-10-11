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

        <!-- 公告中心：铃铛 + 未读红点 -->
        <el-popover placement="bottom-end" :width="380" trigger="click" @show="loadNotices">
          <template #reference>
            <span class="notice-bell">
              <el-badge :value="unread" :hidden="!unread" :max="99">
                <el-icon :size="18"><Bell /></el-icon>
              </el-badge>
            </span>
          </template>
          <div class="notice-panel">
            <div class="notice-panel-title">公告 / 消息</div>
            <el-empty v-if="!notices.length" description="暂无公告" :image-size="60" />
            <div
              v-for="n in notices"
              :key="n.id"
              :class="['notice-item', { unread: !n.read }]"
              @click="openNotice(n)"
            >
              <div class="notice-item-title">
                <el-tag v-if="n.top" size="small" type="danger">置顶</el-tag>
                {{ n.title }}
              </div>
              <div class="notice-item-time">{{ n.createdAt ? formatTime(n.createdAt).slice(0, 16) : "" }}</div>
            </div>
          </div>
        </el-popover>

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

    <!-- 公告详情 -->
    <el-dialog v-model="noticeVisible" :title="noticeDetail?.title" width="520px" append-to-body>
      <div class="notice-content">{{ noticeDetail?.content }}</div>
      <template #footer>
        <el-button type="primary" @click="noticeVisible = false">知道了</el-button>
      </template>
    </el-dialog>

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
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Bell } from "@element-plus/icons-vue";
import { useAuthStore } from "@/stores/auth";
import { authApi } from "@/api/auth";
import { noticeApi, type NoticeRow } from "@/api/notice";
import { formatTime } from "@/utils/datetime";

const router = useRouter();
const auth = useAuthStore();
const menus = computed(() => auth.menus);

const pwdVisible = ref(false);
const pwdForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });

// ---------- 公告中心 ----------
const notices = ref<NoticeRow[]>([]);
const unread = ref(0);
const noticeDetail = ref<NoticeRow | null>(null);
const noticeVisible = ref(false);

async function loadNotices() {
  try {
    notices.value = await noticeApi.mine();
  } catch {
    notices.value = [];
  }
}

async function refreshUnread() {
  try {
    unread.value = await noticeApi.unreadCount();
  } catch {
    unread.value = 0;
  }
}

async function openNotice(n: NoticeRow) {
  noticeDetail.value = n;
  noticeVisible.value = true;
  if (!n.read) {
    try {
      await noticeApi.read(n.id);
      n.read = true;
      unread.value = Math.max(0, unread.value - 1);
    } catch {
      /* 标记失败不影响阅读 */
    }
  }
}

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

onMounted(refreshUnread);
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
.notice-bell {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #606266;
  margin-right: 4px;
}
.notice-panel-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.notice-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.notice-item:hover { background: #f5f7fa; }
.notice-item.unread .notice-item-title { font-weight: 600; }
.notice-item.unread::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f56c6c;
  margin-right: 6px;
  vertical-align: middle;
}
.notice-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.notice-item-time { color: #909399; font-size: 12px; margin-top: 2px; }
.notice-content { white-space: pre-wrap; line-height: 1.7; color: #303133; }
.avatar {
  background: #409eff;
  color: #fff;
}
.main {
  padding: 16px;
}
</style>
