<template>
  <div class="page-card">
    <div class="toolbar">
      <span class="muted">菜单与权限点：目录 → 页面 → 按钮三级，权限码需与后端 @RequirePermissions 一致</span>
      <div class="spacer" />
      <el-button v-if="auth.hasPerm('system:menu:create')" type="primary" plain @click="openCreate(0)">新增顶级</el-button>
    </div>

    <el-table :data="tree" row-key="id" border default-expand-all>
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
          <el-button v-if="auth.hasPerm('system:menu:create') && row.type === 'DIRECTORY'" link type="primary" @click="openCreate(row.id)">加子项</el-button>
          <el-button v-if="auth.hasPerm('system:menu:update')" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确定删除该菜单吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-if="auth.hasPerm('system:menu:delete')" link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑菜单' : '新增菜单'" width="520px">
      <el-form label-width="90px">
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="DIRECTORY">目录</el-radio>
            <el-radio value="MENU">页面</el-radio>
            <el-radio value="BUTTON">按钮</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="路由路径" v-if="form.type !== 'BUTTON'"><el-input v-model="form.path" placeholder="/system/user" /></el-form-item>
        <el-form-item label="组件路径" v-if="form.type === 'MENU'"><el-input v-model="form.component" placeholder="system/user/UserList" /></el-form-item>
        <el-form-item label="权限码" v-if="form.type !== 'DIRECTORY'"><el-input v-model="form.permission" placeholder="system:user:list" /></el-form-item>
        <el-form-item label="图标" v-if="form.type !== 'BUTTON'"><el-input v-model="form.icon" placeholder="Element Plus 图标名，如 Setting" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="可见" v-if="form.type !== 'BUTTON'">
          <el-switch v-model="form.visible" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { menuApi } from "@/api/system";
import type { MenuNode } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const tree = ref<MenuNode[]>([]);
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);

const emptyForm = { parentId: 0, name: "", type: "MENU", path: "", component: "", permission: "", icon: "", sort: 0, visible: true };
const form = reactive({ ...emptyForm });

function typeName(t: string) {
  return { DIRECTORY: "目录", MENU: "页面", BUTTON: "按钮" }[t] || t;
}
function typeTag(t: string) {
  return ({ DIRECTORY: "warning", MENU: "primary", BUTTON: "info" }[t] || "info") as any;
}

async function load() {
  tree.value = await menuApi.tree();
}

function openCreate(parentId: number) {
  Object.assign(form, emptyForm, { parentId });
  editingId.value = null;
  dialogVisible.value = true;
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
}

async function submit() {
  if (!form.name) return ElMessage.warning("请填写菜单名称");
  const data = {
    ...form,
    path: form.path || undefined,
    component: form.component || undefined,
    permission: form.permission || undefined,
    icon: form.icon || undefined,
  };
  if (editingId.value) await menuApi.update(editingId.value, data);
  else await menuApi.create(data);
  ElMessage.success("保存成功（重新登录或刷新后生效）");
  dialogVisible.value = false;
  load();
}

async function remove(row: MenuNode) {
  await menuApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

onMounted(load);
</script>

<style scoped>
.muted {
  color: #8a97a8;
  font-size: 13px;
}
</style>
