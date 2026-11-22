<template>
  <div class="page-card">
    <div class="toolbar">
      <span class="muted">菜单与权限点：目录 → 页面 → 按钮三级，权限码需与后端 @RequirePermissions 一致</span>
      <div class="spacer" />
      <el-button v-permission="'system:menu:create'" type="primary" plain @click="openCreate()">新增顶级</el-button>
    </div>

    <el-table v-loading="loading" :data="tree" row-key="id" border default-expand-all>
      <el-table-column prop="name" label="名称" width="200" />
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag :type="typeTag(row.type)" size="small">{{ typeName(row.type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="path" label="路由路径" width="150" />
      <el-table-column prop="component" label="组件路径" width="190" />
      <el-table-column prop="permission" label="权限码" width="190" />
      <el-table-column prop="sort" label="排序" width="70" />
      <el-table-column label="可见" width="70">
        <template #default="{ row }">{{ row.visible ? "是" : "否" }}</template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <!-- 目录下可加目录/页面，页面下加按钮权限点；按钮没有子项 -->
          <el-button v-if="row.type !== 'BUTTON'" v-permission="'system:menu:create'" link type="primary" @click="openCreate(row)">
            {{ row.type === "MENU" ? "加按钮" : "加子项" }}
          </el-button>
          <el-button v-permission="'system:menu:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确定删除该菜单吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-permission="'system:menu:delete'" link type="danger" :loading="deletingId === row.id">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑菜单' : '新增菜单'" width="520px">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="90px">
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="DIRECTORY">目录</el-radio>
            <el-radio value="MENU">页面</el-radio>
            <el-radio value="BUTTON">按钮</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="上级">
          <el-tree-select
            v-model="form.parentId"
            :data="parentOptions"
            :props="{ label: 'name', children: 'children', disabled: parentDisabled }"
            node-key="id"
            check-strictly
            default-expand-all
            :render-after-expand="false"
            style="width: 100%"
          />
          <span class="form-tip">{{ form.type === "BUTTON" ? "按钮只能挂在页面下" : "目录和页面只能挂在目录下（或顶级）" }}</span>
        </el-form-item>
        <el-form-item label="名称" prop="name"><el-input v-model="form.name" maxlength="50" /></el-form-item>
        <el-form-item v-if="form.type !== 'BUTTON'" label="路由路径" prop="path"><el-input v-model="form.path" placeholder="/system/user" maxlength="200" /></el-form-item>
        <el-form-item v-if="form.type === 'MENU'" label="组件路径" prop="component"><el-input v-model="form.component" placeholder="system/user/UserList" maxlength="200" /></el-form-item>
        <el-form-item v-if="form.type !== 'DIRECTORY'" label="权限码" prop="permission"><el-input v-model="form.permission" placeholder="system:user:list" maxlength="100" /></el-form-item>
        <el-form-item label="图标" v-if="form.type !== 'BUTTON'"><IconPicker v-model="form.icon" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="可见" v-if="form.type !== 'BUTTON'">
          <el-switch v-model="form.visible" />
          <span class="form-tip">关闭后不在侧栏显示，但页面仍可按路径访问（适合详情页、编辑页）</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { R, clearValidate, validateForm } from "@/utils/formRules";
import { menuApi } from "@/api/system";
import type { MenuNode } from "@/api/auth";

const tree = ref<MenuNode[]>([]);
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);

const emptyForm = { parentId: 0, name: "", type: "MENU", path: "", component: "", permission: "", icon: "", sort: 0, visible: true };
const form = reactive({ ...emptyForm });
const saving = ref(false);

function typeName(t: string) {
  return { DIRECTORY: "目录", MENU: "页面", BUTTON: "按钮" }[t] || t;
}
/** 菜单类型 → el-tag 颜色 */
function typeTag(t: string): "warning" | "primary" | "info" {
  return ({ DIRECTORY: "warning", MENU: "primary", BUTTON: "info" } as const)[t] ?? "info";
}

/** 菜单树加载（表格显示 loading） */
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    tree.value = await menuApi.tree();
  } finally {
    loading.value = false;
  }
}

// ---------- 上级选择：层级规则与后端 MenuService.assertParent 一致 ----------
type ParentOption = { id: number; name: string; type: string; children: ParentOption[] };
/** 可选上级：顶级 + 全部目录/页面（排除按钮，编辑时排除自己及子孙，避免选出循环） */
const parentOptions = computed<ParentOption[]>(() => {
  const prune = (nodes: MenuNode[]): ParentOption[] =>
    nodes
      .filter((n) => n.type !== "BUTTON" && n.id !== editingId.value)
      .map((n) => ({ id: n.id, name: n.name, type: n.type, children: prune(n.children ?? []) }));
  return [{ id: 0, name: "顶级", type: "DIRECTORY", children: prune(tree.value) }];
});
/** 按当前类型禁用不合法的上级：按钮 → 只能选页面；目录/页面 → 只能选目录或顶级 */
function parentDisabled(n: ParentOption) {
  return form.type === "BUTTON" ? n.type !== "MENU" : n.type !== "DIRECTORY";
}

/** 新增：在目录下默认建页面，在页面下默认建按钮 */
function openCreate(parent?: MenuNode) {
  Object.assign(form, emptyForm, {
    parentId: parent?.id ?? 0,
    type: parent?.type === "MENU" ? "BUTTON" : "MENU",
  });
  editingId.value = null;
  dialogVisible.value = true;
  nextTick(() => clearValidate(formRef));
}

function openEdit(row: MenuNode) {
  Object.assign(form, {
    parentId: row.parentId || 0,
    name: row.name,
    type: row.type,
    path: row.path || "",
    component: row.component || "",
    permission: row.permission || "",
    icon: row.icon || "",
    sort: row.sort,
    visible: row.visible,
  });
  editingId.value = row.id;
  dialogVisible.value = true;
  nextTick(() => clearValidate(formRef));
}

// ---------- 表单校验（与后端 MenuService.assertMenuShape 一致：页面必须有路由与组件，按钮必须有权限码） ----------
const formRef = ref<FormInstance>();
const formRules: FormRules = {
  name: [R.required("菜单名称"), R.max(50)],
  path: [R.check((v) => (form.type === "MENU" && !String(v ?? "").trim() ? "页面必须填写路由路径" : null))],
  component: [R.check((v) => (form.type === "MENU" && !String(v ?? "").trim() ? "页面必须填写组件路径" : null))],
  permission: [R.check((v) => (form.type === "BUTTON" && !String(v ?? "").trim() ? "按钮必须填写权限码" : null))],
};

async function submit() {
  if (saving.value || !(await validateForm(formRef))) return;
  // 只提交当前类型用得到的字段（切换类型后被隐藏的输入框里还留着旧值）；清空的输入框传 null 表示清空
  const t = form.type;
  const data = {
    parentId: form.parentId,
    name: form.name.trim(),
    type: t,
    sort: form.sort,
    visible: form.visible,
    path: t !== "BUTTON" ? form.path.trim() || null : null,
    component: t === "MENU" ? form.component.trim() || null : null,
    permission: t !== "DIRECTORY" ? form.permission.trim() || null : null,
    icon: t !== "BUTTON" ? form.icon || null : null,
  };
  saving.value = true;
  try {
    if (editingId.value) await menuApi.update(editingId.value, data);
    else await menuApi.create(data);
    ElMessage.success("保存成功（重新登录或刷新后生效）");
    dialogVisible.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

/** 删除：按钮显示 loading，防止重复点击 */
const deletingId = ref<number>();
async function remove(row: MenuNode) {
  deletingId.value = row.id;
  try {
    await menuApi.remove(row.id);
    ElMessage.success("已删除");
    load();
  } finally {
    deletingId.value = undefined;
  }
}

onMounted(load);
</script>

<style scoped>
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
