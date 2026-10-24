<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="角色编码/名称" clearable style="width: 200px" @keyup.enter="search" />
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <el-button v-permission="'system:role:create'" type="primary" plain @click="openCreate">新增角色</el-button>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column prop="code" label="角色编码" width="160" />
      <el-table-column prop="name" label="角色名称" width="160" />
      <el-table-column label="用户数" width="90">
        <template #default="{ row }">{{ row._count?.users ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <StatusTag :status="row.status" />
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" />
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:role:update'" link type="primary" @click="openEdit(row)">编辑权限</el-button>
          <el-popconfirm title="确定删除该角色吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-permission="'system:role:delete'" link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <TablePager :query="query" :total="total" :load="load" />

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
          <!--
            check-strictly：勾选状态与授权集合一一对应（联动模式无法表达「有页面、无按钮」，且回显会丢权限）。
            联动由 onTreeCheck 显式实现：勾选 → 连带子孙与祖先；取消 → 连带子孙。
          -->
          <el-tree
            ref="menuTreeRef"
            :data="menuTree"
            node-key="id"
            show-checkbox
            check-strictly
            default-expand-all
            :props="{ label: 'name', children: 'children' }"
            style="width: 100%; border: 1px solid #ebeef5; border-radius: 4px; padding: 6px; max-height: 320px; overflow: auto"
            @check="onTreeCheck"
          />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
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
import { ElMessage } from "element-plus";
import type { ElTree } from "element-plus";
import { roleApi, type RoleRow } from "@/api/system";
import type { MenuNode } from "@/api/auth";
import { usePagedList } from "@/composables/usePagedList";

const { query, rows, total, load, search } = usePagedList(
  { page: 1, pageSize: 10, keyword: "" },
  (q) => roleApi.list({ ...q, keyword: q.keyword || undefined }),
);
const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const menuTree = ref<MenuNode[]>([]);
const menuTreeRef = ref<InstanceType<typeof ElTree>>();

const emptyForm = { code: "", name: "", status: "ENABLED", remark: "" };
const form = reactive({ ...emptyForm });

/** 菜单树索引：id → 父 id / 子孙 id（用于显式联动） */
const treeIndex = computed(() => {
  const parent = new Map<number, number | null>();
  const descendants = new Map<number, number[]>();
  const walk = (nodes: MenuNode[], pid: number | null): number[] => {
    const all: number[] = [];
    for (const n of nodes) {
      parent.set(n.id, pid);
      const sub = n.children?.length ? walk(n.children, n.id) : [];
      descendants.set(n.id, sub);
      all.push(n.id, ...sub);
    }
    return all;
  };
  walk(menuTree.value, null);
  return { parent, descendants };
});

function onTreeCheck(node: MenuNode, state: { checkedKeys: (string | number)[] }) {
  const tree = menuTreeRef.value;
  if (!tree) return;
  const checked = new Set(state.checkedKeys as number[]);
  const { parent, descendants } = treeIndex.value;
  const subs = descendants.get(node.id) ?? [];
  if (checked.has(node.id)) {
    subs.forEach((id) => checked.add(id));
    // 授权按钮/页面时必须同时拥有其所在页面/目录，否则菜单不显示、页面进不去
    for (let p = parent.get(node.id) ?? null; p !== null; p = parent.get(p) ?? null) checked.add(p);
  } else {
    subs.forEach((id) => checked.delete(id));
  }
  tree.setCheckedKeys([...checked]);
}

async function ensureMenuTree() {
  if (!menuTree.value.length) menuTree.value = await roleApi.menuTree();
}

async function openCreate() {
  Object.assign(form, emptyForm);
  editingId.value = null;
  await ensureMenuTree();
  dialogVisible.value = true;
  await nextTick();
  menuTreeRef.value?.setCheckedKeys([]);
}

async function openEdit(row: RoleRow) {
  const detail = await roleApi.detail(row.id);
  Object.assign(form, { code: row.code, name: row.name, status: row.status, remark: row.remark || "" });
  editingId.value = row.id;
  await ensureMenuTree();
  dialogVisible.value = true;
  await nextTick();
  // setCheckedKeys 是整体替换：不会残留上一个角色的勾选（弹窗不销毁，追加式 setChecked 会多授权）
  menuTreeRef.value?.setCheckedKeys(detail.menuIds || []);
}

async function submit() {
  if (!editingId.value && (!form.code || !form.name)) return ElMessage.warning("请填写角色编码与名称");
  const menuIds = (menuTreeRef.value?.getCheckedKeys() as number[]) ?? [];
  saving.value = true;
  try {
    if (editingId.value) {
      await roleApi.update(editingId.value, { name: form.name, status: form.status, remark: form.remark, menuIds });
    } else {
      // 创建不传 status（CreateRoleDto 白名单校验会拒绝），后端默认 ENABLED
      await roleApi.create({ code: form.code, name: form.name, remark: form.remark, menuIds });
    }
    ElMessage.success("保存成功");
    dialogVisible.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function remove(row: RoleRow) {
  await roleApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

onMounted(load);
</script>
