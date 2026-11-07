import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

/**
 * 前端单元测试（vitest + @vue/test-utils，jsdom 模拟浏览器环境）。
 * 复用 vite.config 的别名（@ / @sb/shared）与插件（Element Plus 按需引入）。
 * 测试文件：src/** /*.spec.ts（与被测文件放在一起）
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.spec.ts"],
      css: false,
      restoreMocks: true,
    },
  }),
);
