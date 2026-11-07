import { shallowRef, type Component, type ShallowRef } from "vue";

/** 图标名 → 组件 */
export type IconSet = Record<string, Component>;

/** 全局只加载一次，所有使用方共享同一份 */
const iconSet: ShallowRef<IconSet | null> = shallowRef(null);
let loading: Promise<void> | null = null;

/**
 * 按需加载 Element Plus 全部图标（动态 import，构建时单独拆成一个 chunk，不进首屏主包）。
 * 返回响应式引用：加载完成前为 null，完成后为「图标名 → 组件」映射。
 */
export function useIconSet(): ShallowRef<IconSet | null> {
  if (!iconSet.value && !loading) {
    // 注意加载的是包里的 CJS 版本（index.cjs）而不是默认入口：Element Plus 组件内部静态引用了默认入口，
    // 动态 import 同一个模块时打包器无法拆分，会把全部图标留在首屏主包；换成另一个文件就能独立成 chunk
    loading = import("@element-plus/icons-vue/dist/index.cjs")
      .then((m: Record<string, unknown>) => {
        iconSet.value = ((m.default as IconSet | undefined) ?? m) as IconSet;
      })
      .catch(() => {
        loading = null; // 加载失败（如断网）允许下次重试
      });
  }
  return iconSet;
}

/** 全部图标名（图标选择器用；未加载完成时为空数组） */
export function iconNames(set: IconSet | null): string[] {
  return set ? Object.keys(set).filter((k) => /^[A-Z]/.test(k)) : [];
}
