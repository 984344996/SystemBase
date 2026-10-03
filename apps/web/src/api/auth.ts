import request from "@/utils/request";

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: number; username: string; name: string };
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
  login: (data: { username: string; password: string }) =>
    request.post<never, LoginResult>("/auth/login", data),
  logout: (refreshToken: string) => request.post<never, { success: boolean }>("/auth/logout", { refreshToken }),
  profile: () => request.get<never, Profile>("/auth/profile"),
  menus: () => request.get<never, MenuNode[]>("/auth/menus"),
  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.put<never, { success: boolean }>("/auth/password", data),
  updateProfile: (data: { name?: string; phone?: string; email?: string }) =>
    request.put<never, Profile>("/auth/profile", data),
};
