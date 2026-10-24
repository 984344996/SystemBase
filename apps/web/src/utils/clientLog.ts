import { isAxiosError } from "axios";
import request from "@/utils/request";

/**
 * 前端日志采集与上报（写到后端 web.YYYY-MM-DD.log，与后端日志分开存放）
 *
 * 设计要点：
 * - 只上报 error / warn（info 默认丢弃，量大且价值低）
 * - 同类错误去重：同一 msg+stack 在窗口内只报一次，避免一个 bug 刷爆日志
 * - 节流：单页每分钟最多上报 N 条
 * - 上报失败静默（silent: true），绝不影响用户操作
 * - 带上最近一次请求的 traceId：后端日志里 grep 同一个 ID 即可拼出完整链路
 */

export interface ClientLogPayload {
  msg: string;
  level?: "error" | "warn" | "info";
  stack?: string;
  url?: string;
  ua?: string;
  traceId?: string;
  release?: string;
  kind?: "error" | "unhandledrejection" | "manual";
}

const MAX_PER_MINUTE = 10; // 节流上限
const DEDUP_WINDOW_MS = 60_000; // 同类错误去重窗口

let lastTraceId = "";
const recent = new Map<string, number>(); // 去重：签名 -> 上次上报时间
let sentInWindow = 0;
let windowStart = Date.now();

/** 记录最近一次请求的 traceId（由 request.ts 的响应头回填） */
export function setLastTraceId(traceId: string): void {
  if (traceId) lastTraceId = traceId;
}

function signature(p: ClientLogPayload): string {
  return `${p.level || "error"}|${p.msg}|${(p.stack || "").slice(0, 200)}`;
}

function allow(p: ClientLogPayload): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  if (sentInWindow >= MAX_PER_MINUTE) return false;

  const sig = signature(p);
  const last = recent.get(sig) || 0;
  if (now - last < DEDUP_WINDOW_MS) return false;
  recent.set(sig, now);
  // 去重表可能无限增长，定期清理过期项
  if (recent.size > 200) {
    for (const [k, t] of recent) if (now - t > DEDUP_WINDOW_MS) recent.delete(k);
  }
  sentInWindow++;
  return true;
}

/** 主动上报（业务代码里 try/catch 到的重要错误可以手动调用） */
export function reportClientLog(p: ClientLogPayload): void {
  try {
    if (p.level === "info") return; // info 不上报
    if (!allow(p)) return;
    void request
      .post<never, unknown>(
        "/logs/client",
        {
          ...p,
          url: p.url || location.href,
          ua: navigator.userAgent,
          traceId: p.traceId || lastTraceId,
        },
        // skipAuthRefresh：token 过期时不能让一条错误上报触发刷新甚至把用户踢回登录页
        { silent: true, skipAuthRefresh: true },
      )
      .catch(() => undefined);
  } catch {
    /* 上报本身不能再抛错 */
  }
}

/**
 * 「不是 bug」的 Promise 拒绝：不上报，否则前端日志全是噪音，真正的问题被淹没。
 * - 弹框取消/关闭（ElMessageBox 以 "cancel"/"close" reject）
 * - 接口错误（AxiosError / 拦截器抛出的业务错误）：拦截器已提示用户，后端也有 traceId 可查
 */
function isNoise(reason: unknown): boolean {
  if (reason === "cancel" || reason === "close") return true;
  if (isAxiosError(reason)) return true;
  // 拦截器对 code !== 0 的业务响应 reject 的是普通 Error，带后端 message
  return reason instanceof Error && (reason as Error & { __api?: boolean }).__api === true;
}

/** 安装全局捕获：window.onerror + unhandledrejection */
export function setupClientLog(release?: string): void {
  const common = { release } as Pick<ClientLogPayload, "release">;

  window.addEventListener("error", (e: ErrorEvent) => {
    // 资源加载失败（img/script）的 ErrorEvent 没有 error 对象，单独识别
    const isResource = !e.error && e.target && e.target !== window;
    reportClientLog({
      ...common,
      level: "error",
      kind: "error",
      msg: isResource ? `资源加载失败: ${(e.target as { src?: string })?.src || e.message}` : e.message || "未知错误",
      stack: e.error?.stack,
      url: location.href,
    });
  }, true); // 捕获阶段：才能拿到资源加载错误

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    if (isNoise(reason)) return;
    reportClientLog({
      ...common,
      level: "error",
      kind: "unhandledrejection",
      msg: reason instanceof Error ? reason.message : `未处理的 Promise 拒绝: ${String(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
      url: location.href,
    });
  });
}
