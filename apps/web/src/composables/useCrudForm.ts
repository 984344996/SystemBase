import { computed, nextTick, reactive, ref, type UnwrapRef } from "vue";
import { ElMessage, type FormInstance } from "element-plus";

export interface CrudFormOptions<F extends object, Row> {
  /** 新增时的表单初始值（每次打开都重新生成一份，避免上次的输入残留） */
  empty: () => F;
  /**
   * 编辑时从列表行回填：只挑表单需要的字段。
   * 不要直接 Object.assign(form, row)——row 里的 id/createdAt 等字段会被一起提交，后端白名单校验会拒绝（400）
   */
  fromRow: (row: Row) => Partial<F>;
  /** 新增接口 */
  create: (payload: any) => Promise<unknown>;
  /** 编辑接口 */
  update: (id: number, payload: any) => Promise<unknown>;
  /** 提交前转换（可选）：如 trim、空串转 null、拆分字段；默认原样提交表单 */
  toPayload?: (form: F, isEdit: boolean) => unknown;
  /** 保存成功后（可选）：通常是刷新列表 */
  onSaved?: () => unknown;
  /** 成功提示，默认「保存成功」；传 false 不提示 */
  successMessage?: string | false;
}

/**
 * 弹窗 / 抽屉表单通用逻辑：打开新增 / 打开编辑 / 校验 / 提交（防重复）/ 关闭。
 *
 * 用法：
 *   const crud = useCrudForm({
 *     empty: () => ({ name: "", status: "ENABLED" }),
 *     fromRow: (r: Row) => ({ name: r.name, status: r.status }),
 *     create: api.create,
 *     update: api.update,
 *     onSaved: load,
 *   });
 *   模板：<el-dialog v-model="crud.visible.value" :title="crud.isEdit.value ? '编辑' : '新增'">
 *           <el-form :ref="crud.bindForm" :model="crud.form" :rules="rules">…</el-form>
 *           <el-button type="primary" :loading="crud.saving.value" @click="crud.submit">保存</el-button>
 *   或解构后在模板中直接用：const { visible, form, saving, isEdit, openCreate, openEdit, submit, formRef } = useCrudForm(...)
 *         <el-form ref="formRef" …>
 */
export function useCrudForm<F extends object, Row extends { id: number } = { id: number }>(opts: CrudFormOptions<F, Row>) {
  const visible = ref(false);
  const saving = ref(false);
  const editingId = ref<number>();
  const formRef = ref<FormInstance>();
  const form = reactive(opts.empty()) as UnwrapRef<F>;
  const isEdit = computed(() => editingId.value !== undefined);

  /** 用一份新值整体覆盖表单（先清掉旧字段，避免上次编辑的可选字段残留） */
  function fill(values: Partial<F>) {
    const target = form as Record<string, unknown>;
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, opts.empty(), values);
  }

  /** 打开后清掉上一次的校验提示（表单渲染后才有实例，需等下一帧） */
  function clearValidate() {
    nextTick(() => formRef.value?.clearValidate());
  }

  /** 打开新增；preset 可预填部分字段（如在某个父节点下新增） */
  function openCreate(preset: Partial<F> = {}) {
    editingId.value = undefined;
    fill(preset);
    visible.value = true;
    clearValidate();
  }

  /** 打开编辑：按 fromRow 回填 */
  function openEdit(row: Row) {
    editingId.value = row.id;
    fill(opts.fromRow(row));
    visible.value = true;
    clearValidate();
  }

  /** 保存：表单校验（绑定了 rules 时）→ 调新增或编辑接口 → 提示 → 关闭 → onSaved；保存中重复点击无效 */
  async function submit() {
    if (saving.value) return;
    if (formRef.value && !(await formRef.value.validate().catch(() => false))) return;
    saving.value = true;
    try {
      const payload = opts.toPayload ? opts.toPayload(form as F, isEdit.value) : { ...(form as F) };
      if (editingId.value !== undefined) await opts.update(editingId.value, payload);
      else await opts.create(payload);
      if (opts.successMessage !== false) ElMessage.success(opts.successMessage || "保存成功");
      visible.value = false;
      await opts.onSaved?.();
    } finally {
      saving.value = false;
    }
  }

  /** 供模板 :ref 绑定 el-form（不解构使用时） */
  function bindForm(el: unknown) {
    formRef.value = (el as FormInstance) || undefined;
  }

  return { visible, saving, editingId, isEdit, form, formRef, bindForm, openCreate, openEdit, submit };
}
