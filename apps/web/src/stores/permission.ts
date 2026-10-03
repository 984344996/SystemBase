import router from "@/router";
import type { MenuNode } from "@/api/auth";

/** 视图组件池：后端菜单 component 字段(如 system/user/UserList) -> src/views 下的 .vue */
const viewModules = import.meta.glob("../views/**/*.vue");

function resolveComponent(component?: string | null) {
  if (!component) return undefined;
  const path = `../views/${component.replace(/^\//, "")}.vue`;
  const mod = viewModules[path];
  if (!mod) {
    console.warn(`[router] 菜单组件不存在: ${path}`);
    return () => import("../views/error/NotFound.vue");
  }
  return mod as any;
}

/** 动态注册的路由名登记表：登出/切换账号时据此清理，防止旧账号路由残留可访问 */
const dynamicRouteNames: string[] = [];
const CATCH_ALL_NAME = "sb-catch-all";

/** 菜单树 -> 动态路由（挂到 Layout 下），并注册 404 兜底 */
export function registerDynamicRoutes(menus: MenuNode[]) {
  resetDynamicRoutes();
  const walk = (nodes: MenuNode[]) => {
    for (const node of nodes) {
      if (node.type === "MENU" && node.path && node.component) {
        const name = `menu-${node.id}`;
        router.addRoute("layout", {
          path: node.path,
          name,
          component: resolveComponent(node.component),
          // 菜单本身已按授权过滤，这里再声明页面权限码，作为路由守卫的第二道校验
          meta: { title: node.name, ...(node.permission ? { permission: node.permission } : {}) },
        });
        dynamicRouteNames.push(name);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(menus);
  // 注意：不能复用静态 /404 路由的 name("not-found")，否则 addRoute 会顶掉静态路由，
  // 导致 /404 命中 catch-all → 重定向 /404 → 死循环
  router.addRoute({ path: "/:pathMatch(.*)*", name: CATCH_ALL_NAME, redirect: "/404" });
  dynamicRouteNames.push(CATCH_ALL_NAME);
}

/** 清理全部动态路由（登出/切换账号时调用） */
export function resetDynamicRoutes() {
  for (const name of dynamicRouteNames.splice(0)) {
    if (router.hasRoute(name)) router.removeRoute(name);
  }
}
