/**
 * 主题（浅色 / 深色 / 跟随系统）
 *
 * 原理：Element Plus 的暗色主题是一套 CSS 变量（main.ts 引入 theme-chalk/dark/css-vars.css），
 * 只要 <html> 上有 class="dark" 就生效；项目自己的样式也统一用 var(--el-xxx) 变量，所以会一起变色。
 *
 * - 用户选择存在 localStorage（sb_theme），换浏览器/清缓存后恢复默认「跟随系统」
 * - index.html 里有一段同样逻辑的内联脚本，在页面渲染前先加上 dark，避免刷新时先白屏再变黑
 * - 「跟随系统」时监听系统外观变化，系统切到深色时页面实时跟着切换
 */
import { computed, ref } from "vue";

export type ThemeMode = "light" | "dark" | "system";

/** localStorage 键名（index.html 内联脚本里写死了同一个名字，改这里要同步改那边） */
export const THEME_KEY = "sb_theme";

/** 读取保存的选择；没有或非法值时按「跟随系统」 */
function loadMode(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** 系统外观查询（浏览器不支持 matchMedia 时为 null，按浅色处理） */
const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

/** 当前选择（浅色 / 深色 / 跟随系统） */
export const themeMode = ref<ThemeMode>(loadMode());
/** 系统当前是否深色（跟随系统模式下用） */
const systemDark = ref(media?.matches ?? false);
/** 最终是否深色：组件里需要按主题取具体颜色值时用（例如 el-menu 的 background-color 属性） */
export const isDark = computed(() => (themeMode.value === "system" ? systemDark.value : themeMode.value === "dark"));

/** 把结果写到 <html>：class="dark" 驱动 Element Plus 变量；color-scheme 让滚动条、原生输入框也跟着变 */
function apply() {
  const root = document.documentElement;
  root.classList.toggle("dark", isDark.value);
  root.style.colorScheme = isDark.value ? "dark" : "light";
}

/** 切换主题并保存 */
export function setThemeMode(mode: ThemeMode) {
  themeMode.value = mode;
  localStorage.setItem(THEME_KEY, mode);
  apply();
}

/** 启动时调用一次：应用当前主题，并监听系统外观变化 */
export function setupTheme() {
  apply();
  media?.addEventListener("change", (e) => {
    systemDark.value = e.matches;
    apply();
  });
  // 其他标签页切换了主题：本页同步
  window.addEventListener("storage", (e) => {
    if (e.key !== THEME_KEY) return;
    themeMode.value = loadMode();
    apply();
  });
}
