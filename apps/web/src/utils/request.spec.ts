import { describe, expect, it } from "vitest";
import { bizCodeOf, bizDataOf, compactParams, isSessionExpired } from "./request";

describe("compactParams（GET 查询参数去空值）", () => {
  it("去掉空字符串 / null / undefined，保留 0 与 false", () => {
    expect(compactParams({ a: "", b: null, c: undefined, d: 0, e: false, f: "x" })).toEqual({ d: 0, e: false, f: "x" });
  });

  it("非普通对象原样返回", () => {
    const sp = new URLSearchParams("a=1");
    expect(compactParams(sp)).toBe(sp);
    expect(compactParams(undefined)).toBeUndefined();
    expect(compactParams([1, 2])).toEqual([1, 2]);
  });
});

describe("bizCodeOf / bizDataOf", () => {
  it("读取接口错误上的业务码与数据；普通错误返回 undefined", () => {
    const e = Object.assign(new Error("x"), { bizCode: 42801, bizData: { needCaptcha: true } });
    expect(bizCodeOf(e)).toBe(42801);
    expect(bizDataOf<{ needCaptcha: boolean }>(e)?.needCaptcha).toBe(true);
    expect(bizCodeOf(new Error("plain"))).toBeUndefined();
    expect(bizCodeOf(null)).toBeUndefined();
  });
});

describe("isSessionExpired（路由守卫判断是否登出）", () => {
  it("401 且刷新失败原因是会话过期 → 失效", () => {
    expect(isSessionExpired({ response: { status: 401 } })).toBe(true);
    expect(isSessionExpired({ response: { status: 401 }, authRefresh: "expired" })).toBe(true);
  });

  it("刷新 token 时网络异常 / 5xx → 不算失效（保留登录态）；非 401 也不算", () => {
    expect(isSessionExpired({ response: { status: 401 }, authRefresh: "network" })).toBe(false);
    expect(isSessionExpired({ response: { status: 502 } })).toBe(false);
    expect(isSessionExpired(new Error("x"))).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });
});
