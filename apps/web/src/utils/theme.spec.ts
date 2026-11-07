import { beforeEach, describe, expect, it, vi } from "vitest";

/** 模拟系统外观；每个用例重新导入模块，让模块级状态（读取 localStorage、matchMedia）重新初始化 */
function mockSystemDark(dark: boolean) {
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  const mql = {
    matches: dark,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return (next: boolean) => listeners.forEach((fn) => fn({ matches: next }));
}

async function load() {
  vi.resetModules();
  return import("./theme");
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("默认跟随系统：系统深色时加 dark，系统切换时实时跟随", async () => {
    const emit = mockSystemDark(true);
    const t = await load();
    t.setupTheme();
    expect(t.themeMode.value).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    emit(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(t.isDark.value).toBe(false);
  });

  it("手动选择会保存，并且不再受系统外观影响", async () => {
    const emit = mockSystemDark(false);
    const t = await load();
    t.setupTheme();
    t.setThemeMode("dark");
    expect(localStorage.getItem(t.THEME_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    emit(false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    t.setThemeMode("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("读取已保存的选择；非法值按跟随系统处理", async () => {
    mockSystemDark(false);
    localStorage.setItem("sb_theme", "dark");
    expect((await load()).themeMode.value).toBe("dark");
    localStorage.setItem("sb_theme", "purple");
    expect((await load()).themeMode.value).toBe("system");
  });
});
