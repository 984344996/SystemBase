<template>
  <div class="page-card">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="用户名/姓名" clearable style="width: 200px" @keyup.enter="search" />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
        <el-option label="启用" value="ENABLED" />
        <el-option label="禁用" value="DISABLED" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <el-button v-permission="'system:user:create'" type="primary" plain @click="openCreate">新增用户</el-button>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column prop="username" label="用户名" width="140" />
      <el-table-column prop="name" label="姓名" width="120" />
      <el-table-column label="角色">
        <template #default="{ row }">
          <el-tag v-for="r in row.roles" :key="r.role.id" size="small" style="margin-right: 4px">{{ r.role.name }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="phone" label="手机号" width="130" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <StatusTag :status="row.status" />
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建时间" width="170">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button v-permission="'system:user:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-permission="'system:user:resetPwd'" link type="warning" @click="resetPwd(row)">重置密码</el-button>
          <el-popconfirm title="确定删除该用户吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-permission="'system:user:delete'" link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <TablePager :query="query" :total="total" :load="load" />

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑用户' : '新增用户'" width="480px">
      <el-form label-width="80px">
        <el-form-item label="用户名" v-if="!editingId">
          <el-input v-model="form.username" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="密码" v-if="!editingId">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="手机号"><el-input v-model="form.phone" /></el-form-item>
        <el-form-item label="邮箱"><el-input v-model="form.email" /></el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleIds" multiple style="width: 100%" placeholder="选择角色">
            <el-option v-for="r in allRoles" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" v-if="editingId">
          <el-radio-group v-model="form.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">禁用</el-radio>
          </el-radio-group>
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
import { onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { userApi, roleApi, type UserRow } from "@/api/system";
import { usePagedList } from "@/composables/usePagedList";
import { formatTime } from "@/utils/datetime";

const { query, rows, total, load, search } = usePagedList(
  { page: 1, pageSize: 10, keyword: "", status: "" },
  (q) => userApi.list({ ...q, keyword: q.keyword || undefined, status: q.status || undefined }),
);
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const allRoles = ref<{ id: number; code: string; name: string }[]>([]);

const emptyForm = { username: "", password: "", name: "", phone: "", email: "", remark: "", status: "ENABLED", roleIds: [] as number[] };
const form = reactive({ ...emptyForm });

function openCreate() {
  Object.assign(form, emptyForm);
  editingId.value = null;
  dialogVisible.value = true;
}

function openEdit(row: UserRow) {
  Object.assign(form, {
    username: row.username,
    password: "",
    name: row.name,
    phone: row.phone || "",
    email: row.email || "",
    remark: row.remark || "",
    status: row.status,
    roleIds: row.roles.map((r) => r.role.id),
  });
  editingId.value = row.id;
  dialogVisible.value = true;
}

async function submit() {
  if (editingId.value) {
    await userApi.update(editingId.value, { ...form });
  } else {
    if (!form.username || form.password.length < 6 || !form.name) return ElMessage.warning("请完整填写必填项（密码至少 6 位）");
    await userApi.create({ ...form });
  }
  ElMessage.success("保存成功");
  dialogVisible.value = false;
  load();
}

async function remove(row: UserRow) {
  await userApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

async function resetPwd(row: UserRow) {
  const { value } = await ElMessageBox.prompt(`为用户「${row.name}」设置新密码`, "重置密码", {
    inputPattern: /^.{6,50}$/,
    inputErrorMessage: "密码至少 6 位",
    inputType: "password",
  });
  await userApi.resetPassword(row.id, value);
  ElMessage.success("密码已重置");
}

onMounted(async () => {
  allRoles.value = await roleApi.all();
  load();
});
</script>
