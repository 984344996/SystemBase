<template>
  <el-container class="layout">
    <!-- 侧栏：可折叠（记住上次状态；窄屏默认折叠），菜单支持任意层级 -->
    <el-aside :width="collapsed ? '64px' : '220px'" class="aside">
      <div class="brand">
        <span class="brand-dot" />
        <span v-show="!collapsed">SystemBase</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        :background-color="isDark ? '#141414' : '#001529'"
        text-color="rgba(255,255,255,0.68)"
        active-text-color="#fff"
        class="menu"
      >
        <SidebarItem v-for="item in menus" :key="item.id" :item="item" />
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <span class="collapse-btn" :title="collapsed ? '展开菜单' : '收起菜单'" @click="toggleCollapse">
            <MenuIcon :name="collapsed ? 'Expand' : 'Fold'" :size="18" />
          </span>
          <!-- 面包屑：按当前页面在菜单树中的位置生成 -->
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-for="(c, i) in breadcrumb" :key="i">{{ c }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-spacer" />

        <!-- 主题切换：浅色 / 深色 / 跟随系统（选择保存在本浏览器） -->
        <el-dropdown trigger="click" @command="setThemeMode">
          <span class="header-icon" title="切换主题">
            <MenuIcon :name="themeIcon" :size="18" />
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="t in THEME_OPTIONS"
                :key="t.value"
                :command="t.value"
                :class="{ 'is-current': themeMode === t.value }"
              >
                <MenuIcon :name="t.icon" />{{ t.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- 公告中心：铃铛 + 未读红点 -->
        <el-popover placement="bottom-end" :width="380" trigger="click" @show="loadNotices">
          <template #reference>
            <span class="notice-bell">
              <el-badge :value="unread" :hidden="!unread" :max="99">
                <MenuIcon name="Bell" :size="18" />
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
            <MenuIcon name="ArrowDown" />
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
        <!-- 页面级错误边界：某个页面出错时只影响内容区，侧栏与顶栏可继续使用 -->
        <PageErrorBoundary>
          <router-view />
        </PageErrorBoundary>
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
          <el-input v-model="pwdForm.newPassword" type="password" show-password :placeholder="PASSWORD_HINT" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="pwdForm.confirm" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSaving" @click="submitPassword">确认修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import SidebarItem from "./SidebarItem.vue";
import MenuIcon from "@/components/MenuIcon.vue";
import { useAuthStore } from "@/stores/auth";
import { authApi, type MenuNode } from "@/api/auth";
import { noticeApi, type NoticeRow } from "@/api/notice";
import { formatTime } from "@/utils/datetime";
import { PASSWORD_HINT, passwordProblem } from "@/utils/password";
import { isDark, setThemeMode, themeMode, type ThemeMode } from "@/utils/theme";

const router = useRouter();
const auth = useAuthStore();

// ---------- 主题切换 ----------
const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "浅色", icon: "Sunny" },
  { value: "dark", label: "深色", icon: "Moon" },
  { value: "system", label: "跟随系统", icon: "Monitor" },
];
/** 顶栏按钮显示当前选择对应的图标 */
const themeIcon = computed(() => THEME_OPTIONS.find((t) => t.value === themeMode.value)?.icon ?? "Monitor");

/**
 * 侧栏菜单：后端返回的是「有权访问」的全部菜单（含 visible=false 的隐藏页，它们只注册路由不显示），
 * 这里递归去掉隐藏节点，并去掉子节点全被隐藏后变空的目录
 */
function visibleTree(nodes: MenuNode[]): MenuNode[] {
  return nodes
    .filter((n) => n.visible !== false)
    .map((n) => ({ ...n, children: n.children?.length ? visibleTree(n.children) : n.children }))
    .filter((n) => n.type !== "DIRECTORY" || (n.children?.length ?? 0) > 0);
}
const menus = computed(() => visibleTree(auth.menus));

// ---------- 侧栏折叠：记住用户选择；首次访问时窄屏（< 992px）默认折叠 ----------
const COLLAPSE_KEY = "sb_sidebar_collapsed";
const saved = localStorage.getItem(COLLAPSE_KEY);
const collapsed = ref(saved === null ? window.innerWidth < 992 : saved === "1");
function toggleCollapse() {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSE_KEY, collapsed.value ? "1" : "0");
}

// ---------- 面包屑与菜单高亮 ----------
const route = useRoute();

/** 在菜单树里找到 path 对应的节点链（根 → 当前） */
function findChain(nodes: MenuNode[], path: string, chain: MenuNode[] = []): MenuNode[] | null {
  for (const n of nodes) {
    const next = [...chain, n];
    if (n.path === path && n.type === "MENU") return next;
    if (n.children?.length) {
      const found = findChain(n.children, path, next);
      if (found) return found;
    }
  }
  return null;
}
const breadcrumb = computed(() => {
  const chain = findChain(auth.menus, route.path);
  if (chain) return chain.map((n) => n.name);
  return [(route.meta.title as string) || "首页"];
});
/** 隐藏页（visible=false，如详情页）没有侧栏项：高亮它最近的可见上级菜单 */
const activeMenu = computed(() => {
  const chain = findChain(auth.menus, route.path);
  const visible = chain?.filter((n) => n.visible !== false && n.type === "MENU").pop();
  return visible?.path || route.path;
});

const pwdVisible = ref(false);
const pwdSaving = ref(false);
const pwdForm = reactive({ oldPassword: "", newPassword: "", confirm: "" });

// ---------- 公告中心 ----------
const notices = ref<NoticeRow[]>([]);
const unread = ref(0);
const noticeDetail = ref<NoticeRow | null>(null);
const noticeVisible = ref(false);

async function loadNotices() {
  refreshUnread(); // 打开面板时顺便刷新红点
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

/** 未读数轮询：60s 一次，页面不可见时暂停，回到前台立即刷新一次 */
const POLL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | undefined;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(refreshUnread, POLL_MS);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}
function onVisibilityChange() {
  if (document.hidden) stopPolling();
  else {
    refreshUnread();
    startPolling();
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
  if (pwdSaving.value) return;
  if (!pwdForm.oldPassword) return ElMessage.warning("请填写原密码");
  const problem = passwordProblem(pwdForm.newPassword, auth.user?.username);
  if (problem) return ElMessage.warning(problem);
  if (pwdForm.newPassword !== pwdForm.confirm) return ElMessage.warning("两次输入的新密码不一致");
  pwdSaving.value = true;
  try {
    await authApi.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword });
    ElMessage.success("密码已修改，请重新登录");
    pwdVisible.value = false;
    setTimeout(() => auth.logout(), 800);
  } finally {
    pwdSaving.value = false;
  }
}

onMounted(() => {
  refreshUnread();
  startPolling();
  document.addEventListener("visibilitychange", onVisibilityChange);
});
onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<style scoped>
.layout {
  min-height: 100vh;
}
.aside {
  background: var(--sb-aside-bg);
  transition: width 0.2s;
  overflow-x: hidden;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 20px;
  white-space: nowrap;
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
  gap: 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.header-spacer {
  flex: 1;
}
.collapse-btn {
  font-size: 18px;
  cursor: pointer;
  color: var(--el-text-color-regular);
}
.collapse-btn:hover {
  color: var(--el-color-primary);
}
.header-icon {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--el-text-color-regular);
}
.header-icon:hover {
  color: var(--el-color-primary);
}
/* 主题下拉里高亮当前选项（下拉菜单渲染在 body 下，需穿透 scoped） */
:global(.el-dropdown-menu__item.is-current) {
  color: var(--el-color-primary);
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--el-text-color-primary);
}
.notice-bell {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--el-text-color-regular);
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
.notice-item:hover { background: var(--el-fill-color-light); }
.notice-item.unread .notice-item-title { font-weight: 600; }
.notice-item.unread::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-danger);
  margin-right: 6px;
  vertical-align: middle;
}
.notice-item-title {
  display: flex;
  align-items: center;
  gap: 6px;
}
.notice-item-time { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }
.notice-content { white-space: pre-wrap; line-height: 1.7; color: var(--el-text-color-primary); }
.avatar {
  background: var(--el-color-primary);
  color: #fff;
}
.main {
  padding: 16px;
}
</style>
