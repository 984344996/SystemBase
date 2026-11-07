import type { Directive, DirectiveBinding } from "vue";
import { useAuthStore } from "@/stores/auth";

/**
 * 按钮级权限指令：无权限时把元素从 DOM 移除（而非隐藏，避免脚本仍可触发点击）。
 *
 * 用法：
 *   <el-button v-permission="'system:user:create'">新增</el-button>
 *   <el-button v-permission="['system:user:update', 'system:user:resetPwd']">编辑</el-button>  满足任一即可
 *
 * 权限变化时（绑定值变化、或重新登录后权限数据刷新导致组件更新）会重新判断：
 * 移除时在原位置留一个注释占位，恢复权限后放回原处。
 * 模板里需要更复杂的判断时，仍可用 auth.hasPerm(code)，两者底层同一套权限数据。
 */
type Holder = HTMLElement & { __permAnchor?: Comment };

/** 按当前权限决定元素在不在 DOM 中 */
function apply(el: Holder, binding: DirectiveBinding<string | string[]>) {
  const codes = (Array.isArray(binding.value) ? binding.value : [binding.value]).filter(Boolean);
  const allowed = !codes.length || useAuthStore().hasAnyPerm(codes); // 未传权限码：不做限制
  if (!allowed && el.parentNode) {
    // 移除：留注释占位，记住原位置
    el.__permAnchor ??= document.createComment("v-permission");
    el.parentNode.replaceChild(el.__permAnchor, el);
  } else if (allowed && el.__permAnchor?.parentNode) {
    // 恢复：放回占位处
    el.__permAnchor.parentNode.replaceChild(el, el.__permAnchor);
  }
}

export const permission: Directive<Holder, string | string[]> = {
  mounted: apply,
  updated: apply,
  unmounted(el) {
    el.__permAnchor?.remove();
  },
};
