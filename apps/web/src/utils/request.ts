import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { ElMessage } from "element-plus";
import { setLastTraceId } from "./clientLog";

export const TOKEN_KEY = "sb_access_token";
export const REFRESH_TOKEN_KEY = "sb_refresh_token";

declare module "axios" {
  interface AxiosRequestConfig {
    /** 不弹出通用错误提示（调用方自行处理） */
    silent?: boolean;
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
function describe(status: number | undefined, serverMsg: string | undefined, traceId: string, code?: string) {
  const trace = traceId ? `（追踪码 ${traceId.slice(0, 12)}）` : "";
  if (!status) {
    if (code === "ECONNABORTED" || code === "ETIMEDOUT") return { level: "error" as Level, text: `请求超时，请稍后重试${trace}` };
    return { level: "error" as Level, text: "网络异常，请检查网络连接" };
  }
  if (status >= 500) return { level: "error" as Level, text: `服务器繁忙，请稍后重试${trace}` };
  if (status === 403) return { level: "warning" as Level, text: serverMsg ? `无权限：${serverMsg}` : "无权限执行该操作" };
  if (status === 429) return { level: "warning" as Level, text: "操作过于频繁，请稍后再试" };
  return { level: "warning" as Level, text: serverMsg || "请求参数有误" };
}

/** blob 下载接口出错时响应体也是 Blob，需要转回 JSON 才能拿到 message */
async function readErrorBody(data: unknown): Promise<{ message?: string; traceId?: string } | undefined> {
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text());
    } catch {
      return undefined;
    }
  }
  return data as { message?: string; traceId?: string } | undefined;
}

// ---------------- axios 实例 ----------------
// baseURL 跟随 vite base（根路径部署 = "/api"；子路径部署如 /systembase-pre = "/systembase-pre/api"）
const service = axios.create({
  baseURL: `${import.meta.env.BASE_URL}api`,
  timeout: 20000,
});

service.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (!config.headers["X-Trace-Id"]) config.headers["X-Trace-Id"] = newTraceId();
  return config;
});

/** 单飞刷新：并发 401 时只发起一次 refresh，其余请求等待复用结果 */
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  try {
    // 用裸 axios，避免经过本拦截器形成循环
    const { data } = await axios.post(`${import.meta.env.BASE_URL}api/auth/refresh`, { refreshToken });
    const payload = data?.data || {};
    if (!payload.accessToken) return null;
    localStorage.setItem(TOKEN_KEY, payload.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
    return payload.accessToken as string;
  } catch {
    return null;
  }
}

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

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
      return Promise.reject(new Error(body.message));
    }
    return body;
  },
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url || "";
    const status = error.response?.status;
    const isAuthApi = url.includes("/auth/login") || url.includes("/auth/refresh");

    // 401：静默刷新后重放原请求；刷新失败才踢回登录页
    if (status === 401 && config && !config._retried && !isAuthApi) {
      if (!refreshing) {
        refreshing = doRefresh().finally(() => {
          refreshing = null;
        });
      }
      const token = await refreshing;
      if (token) {
        config._retried = true;
        config.headers.Authorization = `Bearer ${token}`;
        return service(config);
      }
      clearAuth();
      // 子路径部署时这里是 /systembase-pre/login，不能硬编码 "/login"
      if (!window.location.pathname.startsWith(`${import.meta.env.BASE_URL}login`)) {
        notify("warning", "登录已过期，请重新登录");
        window.location.href = `${import.meta.env.BASE_URL}login`;
      }
      return Promise.reject(error);
    }

    // 登录接口 401（用户名或密码错误）由登录页自行提示
    if (config?.silent || (status === 401 && isAuthApi)) return Promise.reject(error);

    const body = await readErrorBody(error.response?.data);
    const traceId =
      body?.traceId || (error.response?.headers?.["x-trace-id"] as string) || (config?.headers?.["X-Trace-Id"] as string) || "";
    const { level, text } = describe(status, body?.message, traceId, error.code);
    notify(level, text);
    if (status && status >= 500) console.error(`[api] ${config?.method?.toUpperCase()} ${url} ${status} traceId=${traceId}`);
    return Promise.reject(error);
  },
);

export default service;
