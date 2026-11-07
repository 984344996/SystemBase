import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { ElMessage } from "element-plus";
import { BizCode } from "@sb/shared";
import { setLastTraceId } from "./clientLog";

export const TOKEN_KEY = "sb_access_token";
export const REFRESH_TOKEN_KEY = "sb_refresh_token";

declare module "axios" {
  interface AxiosRequestConfig {
    /** 不弹出通用错误提示（调用方自行处理） */
    silent?: boolean;
    /** 401 时不尝试刷新 token（前端日志上报、登出等「附属请求」用，避免它们触发刷新/踢登录） */
    skipAuthRefresh?: boolean;
  }
}

/** 登录态清理与跳转（避免循环依赖，直接操作 localStorage） */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * 前端生成 traceId 随请求发出（后端透传，响应头同值）：
 * 即使请求超时/断网拿不到响应，报障时也能凭这个 ID 去日志里查。
 * 不用 crypto.randomUUID：它只在 HTTPS/localhost 下可用。
 */
function newTraceId(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

// ---------------- 错误提示分级 ----------------
type Level = "error" | "warning";
let lastMsg = "";
let lastAt = 0;

/** 同一提示 1.5s 内只弹一次（并发请求同时失败时避免刷屏） */
function notify(level: Level, message: string) {
  const now = Date.now();
  if (message === lastMsg && now - lastAt < 1500) return;
  lastMsg = message;
  lastAt = now;
  ElMessage({ type: level, message, grouping: true, duration: level === "error" ? 5000 : 3000 });
}

/**
 * 分级规则：
 * - 断网/超时：error（带追踪码）
 * - 5xx：error，不展示后端内部信息，只给追踪码（去日志查 traceId）
 * - 403 / 429 / 其余 4xx：warning，展示后端给的业务提示
 */
function describe(status: number | undefined, serverMsg: string | undefined, traceId: string, code?: string, bizCode?: number) {
  const trace = traceId ? `（追踪码 ${traceId.slice(0, 12)}）` : "";
  if (!status) {
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") return { level: "error" as Level, text: `请求超时，请稍后重试${trace}` };
    return { level: "error" as Level, text: "网络异常，请检查网络连接" };
  }
  if (status >= 500) return { level: "error" as Level, text: `服务器繁忙，请稍后重试${trace}` };
  if (status === 403) return { level: "warning" as Level, text: serverMsg ? `无权限：${serverMsg}` : "无权限执行该操作" };
  // 登录锁定（业务码 42901）的提示里有剩余分钟数，要展示原文；限流的 429 才用通用文案
  if (status === 429) return { level: "warning" as Level, text: bizCode === BIZ_LOGIN_LOCKED && serverMsg ? serverMsg : "操作过于频繁，请稍后再试" };
  return { level: "warning" as Level, text: serverMsg || "请求参数有误" };
}

/** blob 下载接口出错时响应体也是 Blob，需要转回 JSON 才能拿到 message */
async function readErrorBody(data: unknown): Promise<{ code?: number; message?: string; traceId?: string } | undefined> {
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text());
    } catch {
      return undefined;
    }
  }
  return data as { code?: number; message?: string; traceId?: string } | undefined;
}

// ---------------- 登录态失效与强制改密 ----------------
/** 业务码与后端共用 @sb/shared 的 BizCode：必须先改密 / 登录被锁定 */
const BIZ_PASSWORD_CHANGE_REQUIRED = BizCode.PASSWORD_CHANGE_REQUIRED;
const BIZ_LOGIN_LOCKED = BizCode.LOGIN_LOCKED;

/**
 * 取接口错误的业务码（后端响应体里的 code，如 40901 重复、42801 需要验证码）：
 * 调用方 catch 后可据此分支处理；不是接口错误（如前端代码异常）返回 undefined
 */
export function bizCodeOf(e: unknown): number | undefined {
  return (e as { bizCode?: number } | null)?.bizCode;
}

/** 取接口错误附带的数据（后端 BusinessException 的 data，如 { needCaptcha: true }） */
export function bizDataOf<T = unknown>(e: unknown): T | undefined {
  return (e as { bizData?: T } | null)?.bizData;
}

const base = import.meta.env.BASE_URL;

function kickToLogin(message = "登录已过期，请重新登录") {
  clearAuth();
  // 子路径部署时这里是 /systembase-pre/login，不能硬编码 "/login"
  if (!window.location.pathname.startsWith(`${base}login`)) {
    notify("warning", message);
    // 带上当前页面（去掉 base 前缀，与路由 path 对齐），重新登录后回到原页面
    const here = window.location.pathname.slice(base.length - 1) + window.location.search;
    window.location.href = `${base}login?redirect=${encodeURIComponent(here)}`;
  }
}

// ---------------- axios 实例 ----------------
// baseURL 跟随 vite base（根路径部署 = "/api"；子路径部署如 /systembase-pre = "/systembase-pre/api"）
const service = axios.create({
  baseURL: `${base}api`,
  timeout: 20000,
});

/**
 * 去掉查询参数里的空值（'' / null / undefined）：查询栏清空后是空字符串，
 * 后端 @IsOptional 只跳过 null/undefined，空串会被 @IsIn/@IsInt 等校验拒绝（400）。
 * 只处理 URL 查询参数（params），请求体（data）原样发送——编辑时用 null 清空字段的语义要保留
 */
export function compactParams(params: unknown): unknown {
  if (!params || typeof params !== "object" || params instanceof URLSearchParams || Array.isArray(params)) return params;
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined));
}

service.interceptors.request.use((config) => {
  config.params = compactParams(config.params);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (!config.headers["X-Trace-Id"]) config.headers["X-Trace-Id"] = newTraceId();
  return config;
});

// ---------------- 刷新 accessToken（跨标签页安全） ----------------
type RefreshResult = { ok: true; token: string } | { ok: false; reason: "expired" | "network" };

/**
 * 跨标签页互斥执行：后端是「轮换 + 重放检测」，两个标签页拿同一个 refreshToken 同时刷新，
 * 第二个会被当成重放。用 Web Locks 让所有标签页串行刷新；不支持时退化为本标签页单飞。
 */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return locks ? (locks.request("sb-token-refresh", fn) as Promise<T>) : fn();
}

/**
 * @param usedToken 失败请求当时携带的 accessToken。拿到锁后若 localStorage 里已是别的 token，
 *                  说明其他请求/标签页已经刷新过，直接复用，不再发起刷新。
 */
async function doRefresh(usedToken: string | null): Promise<RefreshResult> {
  return withRefreshLock(async () => {
    const latest = localStorage.getItem(TOKEN_KEY);
    if (latest && latest !== usedToken) return { ok: true, token: latest };

    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return { ok: false, reason: "expired" };
    try {
      // 用裸 axios，避免经过本拦截器形成循环；必须有超时，否则卡住时所有等待的请求一起卡住
      const { data } = await axios.post(`${base}api/auth/refresh`, { refreshToken }, { timeout: 10_000 });
      const payload = data?.data || {};
      if (!payload.accessToken || !payload.refreshToken) return { ok: false, reason: "expired" };
      localStorage.setItem(TOKEN_KEY, payload.accessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
      return { ok: true, token: payload.accessToken as string };
    } catch (e) {
      const status = (e as AxiosError).response?.status;
      // 只有服务端明确拒绝（401/403）才算会话失效；断网/超时/5xx（如后端发版重启）保留登录态
      return { ok: false, reason: status === 401 || status === 403 ? "expired" : "network" };
    }
  });
}

/** 本标签页单飞：同一时刻多个 401 只走一次 doRefresh */
let refreshing: Promise<RefreshResult> | null = null;

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

const bearer = (h: unknown) => (typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : null);

service.interceptors.response.use(
  (response) => {
    // 记住最近一次请求的 traceId：前端报错上报时带上，后端日志里 grep 同一个 ID 即可串起整条链路
    const tid = response.headers?.["x-trace-id"] as string | undefined;
    if (tid) setLastTraceId(tid);
    const body = response.data;
    // 统一响应结构：{ code, data, message, traceId }
    if (body && typeof body === "object" && !(body instanceof Blob) && "code" in body) {
      if (body.code === 0) return body.data;
      if (!response.config.silent) notify("warning", body.message || "请求失败");
      // 标记为接口错误：已提示过用户，未捕获时不当作前端 bug 上报（见 clientLog.isNoise）
      return Promise.reject(Object.assign(new Error(body.message), { __api: true, bizCode: body.code, bizData: body.data }));
    }
    return body;
  },
  async (error: AxiosError) => {
    // 主动取消的请求（切换查询条件、离开页面）：不提示、不重试，原样交给调用方忽略
    if (axios.isCancel(error)) return Promise.reject(error);
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url || "";
    const status = error.response?.status;
    const isAuthApi = /\/auth\/(login|refresh|logout)/.test(url);

    // 401：静默刷新后重放原请求；只有会话确实失效才踢回登录页
    if (status === 401 && config && !config._retried && !isAuthApi && !config.skipAuthRefresh) {
      const usedToken = bearer(config.headers?.Authorization);
      if (!refreshing) {
        refreshing = doRefresh(usedToken).finally(() => {
          refreshing = null;
        });
      }
      const result = await refreshing;
      if (result.ok) {
        config._retried = true;
        config.headers.Authorization = `Bearer ${result.token}`;
        return service(config);
      }
      if (result.reason === "expired") kickToLogin();
      else notify("error", "网络异常，登录状态校验失败，请稍后重试");
      return Promise.reject(error);
    }

    // 登录接口 401（用户名或密码错误）由登录页自行提示
    if (config?.silent || (status === 401 && isAuthApi)) return Promise.reject(error);

    const body = await readErrorBody(error.response?.data);
    // 业务码挂到错误对象上，调用方用 bizCodeOf(e) / bizDataOf(e) 读取
    Object.assign(error, { bizCode: body?.code, bizData: (body as { data?: unknown } | undefined)?.data });

    // 服务端强制改密：只有改密/个人信息接口可用，其余请求统一引导到改密页
    if (status === 403 && body?.code === BIZ_PASSWORD_CHANGE_REQUIRED) {
      if (!window.location.pathname.startsWith(`${base}change-password`)) window.location.href = `${base}change-password`;
      return Promise.reject(error);
    }

    const traceId =
      body?.traceId || (error.response?.headers?.["x-trace-id"] as string) || (config?.headers?.["X-Trace-Id"] as string) || "";
    const { level, text } = describe(status, body?.message, traceId, error.code, body?.code);
    notify(level, text);
    if (status && status >= 500) console.error(`[api] ${config?.method?.toUpperCase()} ${url} ${status} traceId=${traceId}`);
    return Promise.reject(error);
  },
);

/**
 * 跨标签页登录态同步：其他标签页登出/换账号时，本标签页内存里的用户与权限已过期，
 * 而请求会带上新 token（拦截器每次读 localStorage）——界面身份与实际身份不一致。
 * 发现 token 被清空或被换成另一个账号的 token 时整页刷新，按新登录态重新加载。
 */
export function setupAuthSync(): void {
  const subjectOf = (token: string | null) => {
    try {
      return token ? JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub : null;
    } catch {
      return null;
    }
  };
  window.addEventListener("storage", (e) => {
    if (e.key !== TOKEN_KEY && e.key !== null) return;
    const before = subjectOf(e.oldValue);
    const after = subjectOf(localStorage.getItem(TOKEN_KEY));
    // 同一账号的 token 轮换（另一个标签页刷新了 token）无需处理
    if (before === after && after !== null) return;
    window.location.reload();
  });
}

export default service;
