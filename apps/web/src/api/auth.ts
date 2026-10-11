import request from "@/utils/request";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; name: string };
  /** 管理员重置过密码，登录后必须先改密 */
  mustChangePassword?: boolean;
  /** 密码已超过 PASSWORD_EXPIRE_DAYS（不阻断，提示尽快修改） */
  passwordExpired?: boolean;
}
export interface Captcha {
  id: string;
  svg: string;
}
export interface Profile {
  id: number;
  username: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  roles: string[];
  roleCodes: string[];
  permissions: string[];
  mustChangePassword?: boolean;
  passwordExpired?: boolean;
}
export interface MenuNode {
  id: number;
  parentId: number | null;
  name: string;
  type: string;
  path?: string | null;
  component?: string | null;
  permission?: string | null;
  icon?: string | null;
  sort: number;
  visible?: boolean;
  status?: string;
  children?: MenuNode[];
}

export const authApi = {
  login: (data: { username: string; password: string; captchaId?: string; captchaCode?: string }) =>
    request.post<never, LoginResult>("/auth/login", data),
  /** 登录验证码（服务端未启用或未安装依赖时返回 null） */
  captcha: () => request.get<never, Captcha | null>("/auth/captcha"),
  logout: (refreshToken: string) => request.post<never, { success: boolean }>("/auth/logout", { refreshToken }),
  profile: () => request.get<never, Profile>("/auth/profile"),
  menus: () => request.get<never, MenuNode[]>("/auth/menus"),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.put<never, { success: boolean }>("/auth/password", data),
  updateProfile: (data: { name?: string; phone?: string; email?: string }) =>
    request.put<never, Profile>("/auth/profile", data),
};
