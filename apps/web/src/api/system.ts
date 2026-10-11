import request from "@/utils/request";
import type { MenuNode } from "./auth";
import type { PageResult } from "@sb/shared";

/** 删除类接口的统一返回 */
export type DeleteResult = { success: boolean };

// ---------- 用户 ----------
export interface UserRow {
  id: number;
  username: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  status: string;
  remark?: string | null;
  createdAt: string;
  roles: { role: { id: number; code: string; name: string } }[];
}

export const userApi = {
  list: (params: Record<string, unknown>) => request.get<never, PageResult<UserRow>>("/users", { params }),
  create: (data: Partial<UserRow> & { password: string; roleIds?: number[] }) =>
    request.post<never, UserRow>("/users", data),
  update: (id: number, data: Partial<UserRow> & { password?: string; roleIds?: number[] }) =>
    request.put<never, UserRow>(`/users/${id}`, data),
  remove: (id: number) => request.delete<never, DeleteResult>(`/users/${id}`),
  resetPassword: (id: number, newPassword: string) =>
    request.put<never, DeleteResult>(`/users/${id}/password`, { newPassword }),
};

// ---------- 角色 ----------
export interface RoleRow {
  id: number;
  code: string;
  name: string;
  status: string;
  remark?: string | null;
  _count?: { users: number; menus: number };
  menuIds?: number[];
}

export const roleApi = {
  list: (params: Record<string, unknown>) => request.get<never, PageResult<RoleRow>>("/roles", { params }),
  all: () => request.get<never, { id: number; code: string; name: string }[]>("/roles/all"),
  detail: (id: number) => request.get<never, RoleRow>(`/roles/${id}`),
  menuTree: () => request.get<never, MenuNode[]>("/roles/menu-tree"),
  create: (data: Partial<RoleRow>) => request.post<never, RoleRow>("/roles", data),
  update: (id: number, data: Partial<RoleRow>) => request.put<never, RoleRow>(`/roles/${id}`, data),
  remove: (id: number) => request.delete<never, DeleteResult>(`/roles/${id}`),
};

// ---------- 菜单 ----------
export const menuApi = {
  tree: () => request.get<never, MenuNode[]>("/menus"),
  create: (data: Partial<MenuNode>) => request.post<never, MenuNode>("/menus", data),
  update: (id: number, data: Partial<MenuNode>) => request.put<never, MenuNode>(`/menus/${id}`, data),
  remove: (id: number) => request.delete<never, DeleteResult>(`/menus/${id}`),
};

// ---------- 日志（来自日志文件，只读；后端 app.YYYY-MM-DD.log / 前端 web.YYYY-MM-DD.log） ----------
/** 日志来源：server=后端日志 / client=前端（浏览器）日志，两者分开存放 */
export type LogSource = "server" | "client";
/** 日志文件中的一行：固定字段 + 各分类的业务字段 */
export interface LogEntry {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL" | string;
  time: string; // YYYY-MM-DD HH:mm:ss.SSS（服务器本地时间）
  category?: "app" | "access" | "audit" | "job" | string;
  traceId?: string;
  msg?: string;
  [key: string]: unknown;
}

export interface LoginLogRow extends LogEntry {
  userId?: number;
  username: string;
  success: boolean;
  reason?: string;
  ip?: string;
  ua?: string;
}

export interface OperateLogRow extends LogEntry {
  userId?: number;
  username?: string;
  module?: string;
  action?: string;
  method?: string;
  path?: string;
  params?: unknown;
  ip?: string;
  costMs?: number;
  success: boolean;
  error?: string;
}

/** 日志分页：truncated=true 表示命中过多、仅保留了最新的一部分 */
export type LogPage<T> = PageResult<T> & { date: string; truncated: boolean };

export const monitorApi = {
  dates: () => request.get<never, { date: string; size: number }[]>("/monitor/logs/dates"),
  logs: (params: Record<string, unknown>) => request.get<never, LogPage<LogEntry>>("/monitor/logs", { params }),
  download: (date: string, source: LogSource = "server") =>
    request.get<never, Blob>("/monitor/logs/download", {
      params: { date, source },
      responseType: "blob",
      timeout: 120000,
    }),
  loginLogs: (params: Record<string, unknown>) =>
    request.get<never, LogPage<LoginLogRow>>("/monitor/login-logs", { params }),
  operateLogs: (params: Record<string, unknown>) =>
    request.get<never, LogPage<OperateLogRow>>("/monitor/operate-logs", { params }),
};

// ---------- 定时任务 ----------
export interface JobRow {
  id: number;
  name: string;
  handlerKey: string;
  cronExpr: string;
  params?: unknown;
  status: string;
  misfirePolicy: string;
  timeoutSec: number;
  remark?: string | null;
  prevRunAt?: string | null;
  nextRunAt?: string | null;
  handlerExists?: boolean;
}

/** 任务执行记录（日志文件 category=job event=run） */
export interface JobLogRow extends LogEntry {
  jobId: number;
  jobName?: string;
  handlerKey?: string;
  trigger?: "cron" | "manual";
  status: string;
  result?: string | null;
  error?: string | null;
  startedAt?: string;
  costMs?: number;
}

export const jobApi = {
  list: () => request.get<never, JobRow[]>("/jobs"),
  handlers: () => request.get<never, { key: string }[]>("/jobs/handlers"),
  logs: (params: Record<string, unknown>) => request.get<never, LogPage<JobLogRow>>("/jobs/logs", { params }),
  create: (data: Partial<JobRow> & { params?: string }) => request.post<never, JobRow>("/jobs", data),
  update: (id: number, data: Partial<JobRow> & { params?: string }) => request.put<never, JobRow>(`/jobs/${id}`, data),
  toggle: (id: number) => request.put<never, JobRow>(`/jobs/${id}/toggle`),
  remove: (id: number) => request.delete<never, DeleteResult>(`/jobs/${id}`),
  run: (id: number) => request.post<never, { status: string; result?: string; error?: string }>(`/jobs/${id}/run`),
};
