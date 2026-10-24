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
            <!-- 行内编辑：布尔用开关，其余用输入框，失焦/回车即保存。
                 输入框绑定草稿（drafts），失焦时与行上的已保存值比较，变了才提交 -->
            <el-switch
              v-if="row.type === 'BOOL'"
              :model-value="row.value === 'true' || row.value === '1'"
              active-text="开"
              inactive-text="关"
              :disabled="!canEdit"
              @change="(v: string | number | boolean) => saveInline(row, String(v))"
            />
            <el-input
              v-else
              :model-value="drafts[row.key] ?? row.value"
              size="small"
              :disabled="!canEdit"
              @update:model-value="(v: string) => (drafts[row.key] = v)"
              @blur="commitDraft(row)"
              @keyup.enter="commitDraft(row)"
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
/** 行内编辑草稿：key → 输入中的值（未提交前不改 row.value） */
const drafts = reactive<Record<string, string>>({});
const savingKeys = new Set<string>();

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
    for (const k of Object.keys(drafts)) delete drafts[k];
  } finally {
    loading.value = false;
  }
}

function commitDraft(row: ConfigRow) {
  const draft = drafts[row.key];
  if (draft === undefined) return;
  delete drafts[row.key];
  saveInline(row, draft);
}

/** row.value 始终是「已保存」的值：成功后才更新，失败保持原值 */
async function saveInline(row: ConfigRow, value: string) {
  if (row.value === value || savingKeys.has(row.key)) return;
  savingKeys.add(row.key);
  try {
    await configApi.update(row.key, { value });
    row.value = value;
    ElMessage.success("已保存（即时生效）");
  } finally {
    savingKeys.delete(row.key);
  }
}

function openCreate() {
  isEdit.value = false;
  replaceForm({ key: "", value: "", type: "STRING", group: "base", label: "", remark: "" });
  dialog.value = true;
}

function openEdit(row: ConfigRow) {
  isEdit.value = true;
  replaceForm({ key: row.key, value: row.value, type: row.type, group: row.group, label: row.label, remark: row.remark ?? "" });
  dialog.value = true;
}

/** 整体替换表单（Object.assign 只覆盖不清空，会残留上一次的 id/createdAt 等字段） */
function replaceForm(next: Partial<ConfigRow>) {
  for (const k of Object.keys(form)) delete (form as Record<string, unknown>)[k];
  Object.assign(form, next);
}

async function submit() {
  saving.value = true;
  try {
    const { key, value, type, group: g, label, remark } = form;
    // 只提交 DTO 白名单内的字段（多余字段会被后端 forbidNonWhitelisted 拒绝）
    if (isEdit.value && key) await configApi.update(key, { value, type, group: g, label, remark });
    else await configApi.create({ key, value, type, group: g, label, remark });
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
