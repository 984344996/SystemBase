/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/** 全套图标的 CJS 构建（useIconSet 按需加载用，类型同默认入口） */
declare module "@element-plus/icons-vue/dist/index.cjs" {
  const icons: Record<string, import("vue").Component>;
  export default icons;
}
