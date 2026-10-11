import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { registerDynamicRoutes } from "@/stores/permission";
import { doneProgress, startProgress } from "@/utils/progress";

declare module "vue-router" {
  interface RouteMeta {
    /** 页面标题 */
    title?: string;
    /** 无需登录即可访问 */
    public?: boolean;
    /** 访问该页所需权限码（满足任一即可）；动态路由取菜单的 permission 字段 */
    permission?: string | string[];
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/login", name: "login", component: () => import("@/views/login/Login.vue"), meta: { public: true, title: "登录" } },
  // 强制改密：登录态下可访问，登录成功且 mustChangePassword 时由守卫拦截到此页
  { path: "/change-password", name: "change-password", component: () => import("@/views/profile/ForceChangePwd.vue"), meta: { title: "修改密码" } },
  { path: "/404", name: "not-found", component: () => import("@/views/error/NotFound.vue"), meta: { public: true, title: "页面不存在" } },
  { path: "/403", name: "forbidden", component: () => import("@/views/error/Forbidden.vue"), meta: { public: true, title: "无权限" } },
  {
    path: "/",
    name: "layout",
    component: () => import("@/layouts/AdminLayout.vue"),
    redirect: "/dashboard",
    children: [
      // 个人中心不属于菜单（登录即可访问），直接静态注册
      { path: "profile", name: "profile", component: () => import("@/views/profile/Profile.vue"), meta: { title: "个人中心" } },
      // 其余页面为动态路由，运行时通过 addRoute("layout", ...) 挂载
    ],
  },
];

// ★ base 必须显式传入：createWebHistory() 不传时默认取站点根路径 "/"，子路径部署
//   （vite base = /systembase-pre/，如 https://域名/systembase-pre/）下跳转会跳出子路径
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
});

router.beforeEach(async (to) => {
  startProgress();
  const auth = useAuthStore();

  // 未登录：一律去登录页
  if (!auth.isLoggedIn) {
    return to.meta.public ? true : { path: "/login", query: { redirect: to.fullPath } };
  }

  // 已登录访问登录页：回首页
  if (to.path === "/login") return { path: "/dashboard" };

  // 首次进入(或刷新后)：加载个人信息 + 菜单 + 动态路由
  if (!auth.routesLoaded) {
    try {
      await auth.loadUserContext();
      registerDynamicRoutes(auth.menus);
      auth.routesLoaded = true;
      return { ...to, replace: true }; // 重新进入以命中刚注册的路由
    } catch {
      await auth.logout();
      return { path: "/login" };
    }
  }

  // 管理员重置过密码：登录成功但还没改密 → 只允许改密页（登出也有出口）
  if (auth.mustChangePassword && to.path !== "/change-password") {
    return { path: "/change-password", replace: true };
  }

  // 路由级权限：页面声明了 meta.permission 且当前用户不具备 → 403
  const perm = to.meta.permission;
  if (perm && !auth.hasAnyPerm(Array.isArray(perm) ? perm : [perm])) {
    return { path: "/403", query: { from: to.fullPath }, replace: true };
  }
  return true;
});

router.afterEach((to) => {
  doneProgress();
  document.title = `${to.meta.title || "SystemBase"} · SystemBase`;
});

/**
 * 发版后旧页面仍引用已被替换的 chunk（文件名带 hash），懒加载会失败。
 * 此时整页刷新到目标地址即可拿到新资源清单；用 sessionStorage 防止反复刷新。
 */
router.onError((err, to) => {
  doneProgress();
  const chunkFailed = /Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(
    String(err?.message || err),
  );
  const key = "sb_chunk_reload";
  if (chunkFailed && sessionStorage.getItem(key) !== to.fullPath) {
    sessionStorage.setItem(key, to.fullPath);
    // to.fullPath 不含 base，子路径部署时要自己拼上（BASE_URL 带尾斜杠）
    window.location.assign(`${import.meta.env.BASE_URL}${to.fullPath.replace(/^\//, "")}`);
  }
});

export default router;
