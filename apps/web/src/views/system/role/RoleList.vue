<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="角色编码/名称" clearable style="width: 200px" @keyup.enter="load" />
      <el-button type="primary" @click="load">查询</el-button>
      <div class="spacer" />
      <el-button v-if="auth.hasPerm('system:role:create')" type="primary" plain @click="openCreate">新增角色</el-button>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column prop="code" label="角色编码" width="160" />
      <el-table-column prop="name" label="角色名称" width="160" />
      <el-table-column label="用户数" width="90">
        <template #default="{ row }">{{ row._count?.users ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'ENABLED' ? 'success' : 'danger'">{{ row.status === 'ENABLED' ? '启用' : '禁用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" />
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.hasPerm('system:role:update')" link type="primary" @click="openEdit(row)">编辑权限</el-button>
          <el-popconfirm title="确定删除该角色吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-if="auth.hasPerm('system:role:delete')" link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      style="margin-top: 12px; justify-content: flex-end"
      @change="load"
    />

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑角色' : '新增角色'" width="520px">
      <el-form label-width="80px">
        <el-form-item label="角色编码" v-if="!editingId">
          <el-input v-model="form.code" placeholder="如 OPERATOR" />
        </el-form-item>
        <el-form-item label="角色名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="状态" v-if="editingId">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="菜单权限">
          <el-tree
            ref="menuTreeRef"
            :data="menuTree"
            node-key="id"
            show-checkbox
            default-expand-all
            :props="{ label: 'name', children: 'children' }"
            style="width: 100%; border: 1px solid #ebeef5; border-radius: 4px; padding: 6px; max-height: 320px; overflow: auto"
          />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { ElTree } from "element-plus";
import { roleApi, type RoleRow } from "@/api/system";
import type { MenuNode } from "@/api/auth";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const rows = ref<RoleRow[]>([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 10, keyword: "" });
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const menuTree = ref<MenuNode[]>([]);
const menuTreeRef = ref<InstanceType<typeof ElTree>>();

const emptyForm = { code: "", name: "", status: "ENABLED", remark: "", menuIds: [] as number[] };
const form = reactive({ ...emptyForm });

async function load() {
  const res = await roleApi.list({ ...query, keyword: query.keyword || undefined });
  rows.value = res.list;
  total.value = res.total;
}

function checkedKeys(): number[] {
  const tree = menuTreeRef.value;
  if (!tree) return [];
  // 只取叶子节点(按钮/页面)，父节点由后端语义自行包含
  return [...(tree.getCheckedKeys() as number[]), ...(tree.getHalfCheckedKeys() as number[])];
}

async function openCreate() {
  Object.assign(form, emptyForm);
  editingId.value = null;
  if (!menuTree.value.length) menuTree.value = await roleApi.menuTree();
  dialogVisible.value = true;
  await nextTick();
  menuTreeRef.value?.setCheckedKeys([]);
}

async function openEdit(row: RoleRow) {
  const detail = await roleApi.detail(row.id);
  Object.assign(form, { code: row.code, name: row.name, status: row.status, remark: row.remark || "", menuIds: detail.menuIds || [] });
  editingId.value = row.id;
  if (!menuTree.value.length) menuTree.value = await roleApi.menuTree();
  dialogVisible.value = true;
  await nextTick();
  // 只勾选叶子节点，避免父级勾选联动误选全部子节点
  collectLeafIds(menuTree.value, new Set(detail.menuIds || [])).forEach((id) => {
    menuTreeRef.value?.setChecked(id, true, false);
  });
}

/** 收集树中「无子节点」的叶子 id */
function collectLeafIds(nodes: MenuNode[], allowed: Set<number>, acc: number[] = []): number[] {
  for (const n of nodes) {
    if (n.children?.length) collectLeafIds(n.children, allowed, acc);
    else if (allowed.has(n.id)) acc.push(n.id);
  }
  return acc;
}

async function submit() {
  const menuIds = checkedKeys();
  if (editingId.value) {
    await roleApi.update(editingId.value, { name: form.name, status: form.status, remark: form.remark, menuIds });
  } else {
    if (!form.code || !form.name) return ElMessage.warning("请填写角色编码与名称");
    await roleApi.create({ ...form, menuIds });
  }
  ElMessage.success("保存成功");
  dialogVisible.value = false;
  load();
}

async function remove(row: RoleRow) {
  await roleApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

onMounted(load);
</script>
