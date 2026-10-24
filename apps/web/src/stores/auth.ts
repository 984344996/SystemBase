import { defineStore } from "pinia";
import { authApi, type LoginResult, type MenuNode, type Profile } from "@/api/auth";
import { resetDynamicRoutes } from "@/stores/permission";
import { TOKEN_KEY, REFRESH_TOKEN_KEY, clearAuth } from "@/utils/request";

/** 登录态唯一数据源：localStorage 读写只发生在这里 */
export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as Profile | null,
    menus: [] as MenuNode[],
    routesLoaded: false,
    /** 管理员重置过密码：登录后必须先改密（路由守卫据此拦截） */
    mustChangePassword: false,
    /** 密码已过期：不阻断访问，仅提示 */
    passwordExpired: false,
    // localStorage 的响应式镜像：getter 不能直接读 localStorage（非响应式，computed 会永久缓存旧值，
    // 登录成功后 isLoggedIn 仍是 false，路由守卫会把用户弹回登录页）
    token: localStorage.getItem(TOKEN_KEY) as string | null,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    isSuper: (s) => s.user?.roleCodes?.includes("SUPER_ADMIN") ?? false,
  },
  actions: {
    async login(payload: {
      username: string;
      password: string;
      captchaId?: string;
      captchaCode?: string;
    }): Promise<LoginResult> {
      const result = await authApi.login(payload);
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
      this.token = result.accessToken;
      this.mustChangePassword = !!result.mustChangePassword;
      this.passwordExpired = !!result.passwordExpired;
      return result;
    },
    /** 拉取个人信息与可见菜单（登录后/刷新页面时调用） */
    async loadUserContext() {
      const [profile, menus] = await Promise.all([authApi.profile(), authApi.menus()]);
      this.user = profile;
      this.menus = menus;
      // profile 是权威来源：刷新页面后仍能保持「必须改密」的拦截状态
      this.mustChangePassword = !!profile.mustChangePassword;
      this.passwordExpired = !!profile.passwordExpired;
    },
    /** 按钮级权限：超管为 * 全放行 */
    hasPerm(code?: string) {
      if (!code) return true;
      if (!this.user) return false;
      return this.user.permissions.includes("*") || this.user.permissions.includes(code);
    },
    /** 满足其中任一权限码即放行（v-permission 指令用） */
    hasAnyPerm(codes: string[]) {
      if (!codes.length) return true;
      if (!this.user) return false;
      if (this.user.permissions.includes("*")) return true;
      return codes.some((c) => this.user!.permissions.includes(c));
    },
    async logout() {
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      // 先清本地再通知后端：即使接口失败/超时，本地登录态也已清除，不等网络才跳转
      clearAuth();
      resetDynamicRoutes(); // 清掉上一个账号注册的动态路由，防止换账号后旧路由仍可访问
      this.$reset();
      if (refreshToken) await authApi.logout(refreshToken).catch(() => undefined);
      // 子路径部署时跟随 vite base（如 /systembase-pre/login）
      window.location.href = `${import.meta.env.BASE_URL}login`;
    },
  },
});
