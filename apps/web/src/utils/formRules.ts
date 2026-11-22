import type { FormInstance, FormItemRule } from "element-plus";
import type { Ref } from "vue";

/**
 * 表单校验规则（与后端 DTO 的约束保持一致：必填 / 长度 / 格式），供各页面 el-form :rules 复用。
 * 前端校验只是体验优化（提交前就能看到哪个字段有问题），后端仍会完整校验。
 *
 *   const rules: FormRules = {
 *     name: [R.required("姓名"), R.max(50)],
 *     email: [R.email, R.max(100)],
 *   };
 *   <el-form ref="formRef" :model="form" :rules="rules"> <el-form-item label="姓名" prop="name"> ...
 *   if (!(await validateForm(formRef))) return;
 */
export const R = {
  /** 必填（纯空格也算没填） */
  required: (label: string, trigger: "blur" | "change" = "blur"): FormItemRule => ({
    required: true,
    whitespace: true,
    message: `请填写${label}`,
    trigger,
  }),
  /** 必选（下拉 / 单选等） */
  requiredSelect: (label: string): FormItemRule => ({ required: true, message: `请选择${label}`, trigger: "change" }),
  /** 最大长度（与后端 @MaxLength 一致） */
  max: (n: number): FormItemRule => ({ max: n, message: `最多 ${n} 个字符`, trigger: "blur" }),
  /** 邮箱（留空不校验） */
  email: { type: "email", message: "邮箱格式不正确", trigger: "blur" } as FormItemRule,
  /** 手机 / 电话（留空不校验）：数字、+、-、空格，5~20 位 */
  phone: { pattern: /^[0-9+\-\s]{5,20}$/, message: "手机号格式不正确", trigger: "blur" } as FormItemRule,
  /** 自定义校验：返回错误文案（字符串）表示不通过，返回 null / undefined 表示通过 */
  check: (fn: (value: unknown) => string | null | undefined, trigger: "blur" | "change" = "blur"): FormItemRule => ({
    trigger,
    validator: (_rule, value, callback) => {
      const msg = fn(value);
      if (msg) callback(new Error(msg));
      else callback();
    },
  }),
};

/** 触发整表校验：通过返回 true；不通过时 Element Plus 会在对应字段下方显示错误 */
export async function validateForm(formRef: Ref<FormInstance | undefined>): Promise<boolean> {
  if (!formRef.value) return true;
  return formRef.value.validate().then(
    () => true,
    () => false,
  );
}

/** 打开弹窗时清掉上一次留下的校验错误（弹窗不销毁，错误提示会残留） */
export function clearValidate(formRef: Ref<FormInstance | undefined>) {
  formRef.value?.clearValidate();
}
