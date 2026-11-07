// ESLint 统一配置（flat config，整个仓库一份）：pnpm lint 时各包执行 eslint
//   - 后端 / 共享包：TypeScript 推荐规则
//   - 前端：TypeScript + Vue 3 推荐规则
// 只开「能发现 bug」的规则；代码格式交给 Prettier（pnpm format），这里不管缩进、引号等风格问题
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  // ---------- 不检查的目录 ----------
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.d.ts",
      "apps/server/prisma/migrations/**",
      "backup/**",
      ".run/**",
    ],
  },

  // ---------- 通用：JS + TS 推荐规则 ----------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------- 前端：Vue 单文件组件 ----------
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["apps/web/**/*.{ts,vue}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
    },
    rules: {
      // 页面组件按目录命名（UserList、Login），不强制多单词
      "vue/multi-word-component-names": "off",
      // 模板格式交给 Prettier
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
      "vue/html-closing-bracket-newline": "off",
      "vue/attributes-order": "off",
      // v-if 与 v-permission 等指令同用是允许的
      "vue/no-v-html": "warn",
    },
  },

  // ---------- 后端 / 脚本：Node 环境 ----------
  {
    files: ["apps/server/**/*.ts", "packages/**/*.ts", "scripts/**/*.{js,mjs,cjs}", "deploy/**/*.{js,cjs}", "*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["apps/server/**/*.spec.ts", "apps/server/test/**/*.ts"],
    languageOptions: { globals: { ...globals.jest } },
  },

  // ---------- 全局规则取舍 ----------
  {
    rules: {
      // 未使用的变量：以 _ 开头的参数/变量视为有意忽略
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      // any：框架里有少量与第三方库对接处需要，先警告，逐步收敛
      "@typescript-eslint/no-explicit-any": "warn",
      // 可选依赖用 require 动态加载（svg-captcha 等）
      "@typescript-eslint/no-require-imports": "off",
      // 空 catch 用于「失败即忽略」的场景，需写注释说明
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
