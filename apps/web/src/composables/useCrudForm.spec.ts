import { describe, expect, it, vi } from "vitest";

vi.mock("element-plus", () => ({ ElMessage: { success: vi.fn() } }));

import { ElMessage } from "element-plus";
import { useCrudForm } from "./useCrudForm";

interface Row {
  id: number;
  name: string;
  code: string | null;
  createdAt: string;
}

function setup(overrides: Partial<Parameters<typeof useCrudForm<{ name: string; code: string }, Row>>[0]> = {}) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const onSaved = vi.fn();
  const crud = useCrudForm({
    empty: () => ({ name: "", code: "" }),
    fromRow: (r: Row) => ({ name: r.name, code: r.code ?? "" }),
    create,
    update,
    onSaved,
    ...overrides,
  });
  return { crud, create, update, onSaved };
}

const row: Row = { id: 7, name: "旧名", code: null, createdAt: "2026-01-01" };

describe("useCrudForm", () => {
  it("openCreate：重置为初始值（不残留上次编辑的内容），可预填", () => {
    const { crud } = setup();
    crud.openEdit(row);
    crud.openCreate({ code: "P1" });
    expect(crud.isEdit.value).toBe(false);
    expect({ ...crud.form }).toEqual({ name: "", code: "P1" });
    expect(crud.visible.value).toBe(true);
  });

  it("openEdit：只回填 fromRow 挑出的字段（不带 id / createdAt）", () => {
    const { crud } = setup();
    crud.openEdit(row);
    expect(crud.isEdit.value).toBe(true);
    expect(crud.editingId.value).toBe(7);
    expect({ ...crud.form }).toEqual({ name: "旧名", code: "" });
  });

  it("submit：新增调 create，编辑调 update(id, ...)；成功后提示、关闭、回调", async () => {
    const { crud, create, update, onSaved } = setup();
    crud.openCreate();
    crud.form.name = "新";
    await crud.submit();
    expect(create).toHaveBeenCalledWith({ name: "新", code: "" });
    expect(ElMessage.success).toHaveBeenCalledWith("保存成功");
    expect(crud.visible.value).toBe(false);
    expect(onSaved).toHaveBeenCalled();

    crud.openEdit(row);
    await crud.submit();
    expect(update).toHaveBeenCalledWith(7, { name: "旧名", code: "" });
  });

  it("toPayload：提交前转换", async () => {
    const { crud, create } = setup({ toPayload: (f) => ({ name: f.name.trim(), code: f.code || null }) });
    crud.openCreate();
    crud.form.name = "  a  ";
    await crud.submit();
    expect(create).toHaveBeenCalledWith({ name: "a", code: null });
  });

  it("保存失败：不关闭弹窗、不回调，saving 复位", async () => {
    const { crud, onSaved } = setup({ create: vi.fn().mockRejectedValue(new Error("409")) });
    crud.openCreate();
    await expect(crud.submit()).rejects.toThrow("409");
    expect(crud.visible.value).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(crud.saving.value).toBe(false);
  });

  it("表单校验不通过时不提交；保存中重复点击无效", async () => {
    const { crud, create } = setup();
    crud.openCreate();
    crud.formRef.value = { validate: () => Promise.reject(new Error("invalid")), clearValidate: vi.fn() } as never;
    await crud.submit();
    expect(create).not.toHaveBeenCalled();

    crud.formRef.value = undefined;
    crud.saving.value = true;
    await crud.submit();
    expect(create).not.toHaveBeenCalled();
  });
});
