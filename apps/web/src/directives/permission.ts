import type { Directive } from "vue";
import { useAuthStore } from "@/stores/auth";

/**
 * 按钮级权限指令：无权限时直接把元素从 DOM 移除（而非隐藏，避免脚本仍可触发点击）。
 *
 * 用法：
 *   <el-button v-permission="'system:user:create'">新增</el-button>
 *   <el-button v-permission="['system:user:update', 'system:user:resetPwd']">编辑</el-button>
 *
 * 说明：模板里需要更复杂的判断时，仍可用 auth.hasPerm(code)，两者底层同一套权限数据。
 */
export const permission: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    const codes = Array.isArray(binding.value) ? binding.value : [binding.value];
    if (!codes.filter(Boolean).length) return; // 未传权限码：不做限制
    if (!useAuthStore().hasAnyPerm(codes)) el.remove();
  },
};
