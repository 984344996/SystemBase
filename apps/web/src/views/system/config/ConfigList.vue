<template>
  <div class="page">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="参数键 / 名称" clearable style="width: 220px" @keyup.enter="load" />
        <el-select v-model="group" placeholder="分组" clearable style="width: 160px" @change="load">
          <el-option v-for="g in groups" :key="g" :label="groupLabel(g)" :value="g" />
        </el-select>
        <el-button type="primary" @click="load">查询</el-button>
        <div class="spacer" />
        <el-button v-permission="'system:config:create'" type="primary" @click="openCreate">新增参数</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="key" label="参数键" min-width="180" show-overflow-tooltip />
        <el-table-column prop="label" label="名称" min-width="150" />
        <el-table-column label="值" min-width="240">
          <template #default="{ row }">
            <!-- 行内编辑：布尔用开关，其余用输入框，失焦/切换即保存 -->
            <el-switch
              v-if="row.type === 'BOOL'"
              :model-value="row.value === 'true' || row.value === '1'"
              active-text="开"
              inactive-text="关"
              :disabled="!canEdit"
              @change="(v: boolean) => saveInline(row, String(v))"
            />
            <el-input
              v-else
              v-model="row.value"
              size="small"
              :disabled="!canEdit"
              @blur="saveInline(row, row.value)"
              @keyup.enter="saveInline(row, row.value)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="90">
          <template #default="{ row }"><el-tag size="small">{{ row.type }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="group" label="分组" width="110">
          <template #default="{ row }">{{ groupLabel(row.group) }}</template>
        </el-table-column>
        <el-table-column label="内置" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.builtin" size="small" type="info">内置</el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'system:config:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除该参数？" @confirm="onDelete(row)">
              <template #reference>
                <el-button v-permission="'system:config:delete'" link type="danger" :disabled="row.builtin">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>暂无参数</template>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog" :title="isEdit ? '编辑参数' : '新增参数'" width="520px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="参数键">
          <el-input v-model="form.key" :disabled="!!isEdit" placeholder="如 login.captcha" />
        </el-form-item>
        <el-form-item label="名称"><el-input v-model="form.label" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="字符串" value="STRING" />
            <el-option label="数值" value="NUMBER" />
            <el-option label="布尔" value="BOOL" />
            <el-option label="JSON" value="JSON" />
          </el-select>
        </el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.group" allow-create filterable default-first-option style="width: 100%">
            <el-option v-for="g in groups" :key="g" :label="groupLabel(g)" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="值">
          <el-input v-model="form.value" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { configApi, type ConfigRow } from "@/api/config";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const rows = ref<ConfigRow[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const keyword = ref("");
const group = ref("");
const form = reactive<Partial<ConfigRow>>({});
const isEdit = ref(false);

const canEdit = computed(() => auth.hasPerm("system:config:update"));
const groups = computed(() => [...new Set(rows.value.map((r) => r.group))]);

const GROUP_LABELS: Record<string, string> = { base: "基础", security: "安全", notice: "通知", upload: "上传" };
function groupLabel(g: string) {
  return GROUP_LABELS[g] || g;
}

async function load() {
  loading.value = true;
  try {
    rows.value = await configApi.list({ keyword: keyword.value || undefined, group: group.value || undefined });
  } finally {
    loading.value = false;
  }
}

async function saveInline(row: ConfigRow, value: string) {
  if (row.value === value) return;
  const old = row.value;
  row.value = value;
  try {
    await configApi.update(row.key, { value });
    ElMessage.success("已保存（即时生效）");
  } catch {
    row.value = old;
  }
}

function openCreate() {
  isEdit.value = false;
  Object.assign(form, { key: "", value: "", type: "STRING", group: "base", label: "", remark: "" });
  dialog.value = true;
}

function openEdit(row: ConfigRow) {
  isEdit.value = true;
  Object.assign(form, row);
  dialog.value = true;
}

async function submit() {
  saving.value = true;
  try {
    if (isEdit.value && form.key) await configApi.update(form.key, form);
    else await configApi.create(form);
    ElMessage.success("保存成功");
    dialog.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: ConfigRow) {
  await configApi.remove(row.key);
  ElMessage.success("已删除");
  load();
}

onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.spacer { flex: 1; }
</style>
