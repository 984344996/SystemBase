import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import service, { REFRESH_TOKEN_KEY, TOKEN_KEY } from "./request";

/**
 * token 静默续期（框架最关键的前端逻辑之一）：
 *   - 同一时刻多个请求都 401 时只刷新一次，其余请求排队，刷新后用新 token 重放
 *   - 刷新时网络异常 / 5xx：不清登录态（后端发版重启期间不能把用户踢下线）
 * 用自定义 adapter 模拟后端：带旧 token 返回 401，带新 token 返回成功
 */
function fakeBackend(): { adapter: AxiosAdapter; seen: string[] } {
  const seen: string[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const auth = String(config.headers?.Authorization ?? "");
    seen.push(auth);
    if (auth === "Bearer new-access") {
      return { data: { code: 0, data: "ok", message: "ok" }, status: 200, statusText: "OK", headers: {}, config };
    }
    const response = { data: { code: 401, data: null, message: "登录已过期" }, status: 401, statusText: "", headers: {}, config };
    throw new AxiosError("401", "ERR_BAD_REQUEST", config, null, response);
  };
  return { adapter, seen };
}

describe("request：401 静默续期", () => {
  let original: typeof service.defaults.adapter;
  beforeEach(() => {
    original = service.defaults.adapter;
    localStorage.setItem(TOKEN_KEY, "old-access");
    localStorage.setItem(REFRESH_TOKEN_KEY, "old-refresh");
  });
  afterEach(() => {
    service.defaults.adapter = original;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("并发 3 个请求同时 401：只刷新 1 次，全部用新 token 重放成功", async () => {
    const backend = fakeBackend();
    service.defaults.adapter = backend.adapter;
    const refresh = vi.spyOn(axios, "post").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10)); // 刷新期间其他 401 陆续到达
      return { data: { code: 0, data: { accessToken: "new-access", refreshToken: "new-refresh" } } };
    });

    const results = await Promise.all([service.get("/a"), service.get("/b"), service.get("/c")]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(3);
    expect(backend.seen.filter((a) => a === "Bearer new-access")).toHaveLength(3);
    expect(localStorage.getItem(TOKEN_KEY)).toBe("new-access");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("new-refresh");
  });

  it("刷新时网络异常：请求失败并标记 authRefresh=network（路由守卫据此不登出），本地登录态保留", async () => {
    service.defaults.adapter = fakeBackend().adapter;
    vi.spyOn(axios, "post").mockRejectedValue(new AxiosError("Network Error", "ERR_NETWORK"));

    const err = await service.get("/a").catch((e) => e);

    expect(err).toMatchObject({ authRefresh: "network", response: { status: 401 } });
    expect(localStorage.getItem(TOKEN_KEY)).toBe("old-access");
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("old-refresh");
  });
});
