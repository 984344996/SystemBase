<template>
  <div class="page dict-page">
    <el-card shadow="never" class="left">
      <template #header>
        <div class="card-header">
          <span>字典类型</span>
          <el-button v-permission="'system:dict:create'" link type="primary" @click="openCreateDict">新增</el-button>
        </div>
      </template>
      <el-input v-model="keyword" placeholder="编码 / 名称" clearable size="small" @keyup.enter="loadDicts" />
      <div class="dict-list">
        <div
          v-for="d in dicts"
          :key="d.id"
          :class="['dict-item', { active: current?.id === d.id }]"
          @click="selectDict(d)"
        >
          <div class="dict-item-main">
            <span class="dict-name">{{ d.name }}</span>
            <StatusTag :status="d.status" />
          </div>
          <div class="dict-code">{{ d.code }}</div>
        </div>
        <el-empty v-if="!dicts.length" description="暂无字典" :image-size="60" />
      </div>
    </el-card>

    <el-card shadow="never" class="right">
      <template #header>
        <div class="card-header">
          <span>字典项{{ current ? `（${current.name}）` : "" }}</span>
          <div>
            <el-button v-permission="'system:dict:update'" link type="primary" :disabled="!current" @click="openEditDict">编辑字典</el-button>
            <el-button v-permission="'system:dict:delete'" link type="danger" :disabled="!current" :loading="deletingDict" @click="removeDict">删除字典</el-button>
            <el-button v-permission="'system:dict:update'" type="primary" :disabled="!current" @click="openCreateItem">新增选项</el-button>
          </div>
        </div>
      </template>

      <el-table v-loading="loadingItems" :data="items" border stripe size="small">
        <el-table-column prop="label" label="展示文案" min-width="140" />
        <el-table-column prop="value" label="存储值" min-width="140" />
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'system:dict:update'" link type="primary" @click="openEditItem(row)">编辑</el-button>
            <el-popconfirm title="确认删除该选项？" @confirm="runDelete(row.id, () => removeItem(row))">
              <template #reference>
                <el-button v-permission="'system:dict:delete'" link type="danger" :loading="deletingId === row.id">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>请选择左侧字典</template>
      </el-table>
    </el-card>

    <!-- 字典类型表单 -->
    <el-dialog v-model="dictDialog" :title="dictForm.id ? '编辑字典' : '新增字典'" width="480px">
      <el-form ref="dictFormRef" :model="dictForm" :rules="dictRules" label-width="90px">
        <el-form-item label="字典编码" prop="code"><el-input v-model="dictForm.code" :disabled="!!dictForm.id" placeholder="如 user_status" maxlength="50" /></el-form-item>
        <el-form-item label="名称" prop="name"><el-input v-model="dictForm.name" maxlength="50" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="dictForm.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark"><el-input v-model="dictForm.remark" type="textarea" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dictDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitDict">保存</el-button>
      </template>
    </el-dialog>

    <!-- 字典项表单 -->
    <el-dialog v-model="itemDialog" :title="itemForm.id ? '编辑选项' : '新增选项'" width="480px">
      <el-form ref="itemFormRef" :model="itemForm" :rules="itemRules" label-width="90px">
        <el-form-item label="展示文案" prop="label"><el-input v-model="itemForm.label" maxlength="100" /></el-form-item>
        <el-form-item label="存储值" prop="value"><el-input v-model="itemForm.value" maxlength="100" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="itemForm.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="itemForm.status">
            <el-radio value="ENABLED">启用</el-radio>
            <el-radio value="DISABLED">停用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注" prop="remark"><el-input v-model="itemForm.remark" maxlength="255" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitItem">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useDictStore } from "@/stores/dict";
import { nextTick, onMounted, reactive, ref } from "vue";
import { ElMessage, type FormInstance, type FormRules } from "element-plus";
import { R, clearValidate, validateForm } from "@/utils/formRules";
import { confirmAction } from "@/utils/confirm";
import { dictApi, type DictItemRow, type DictRow } from "@/api/dict";
import { useRowBusy } from "@/composables/useRowBusy";

/** 行内删除：按钮 loading + 防重复点击 */
const { busyId: deletingId, run: runDelete } = useRowBusy();

const dicts = ref<DictRow[]>([]);
const items = ref<DictItemRow[]>([]);
const current = ref<DictRow | null>(null);
const keyword = ref("");
const loadingItems = ref(false);
const saving = ref(false);
const dictDialog = ref(false);
const itemDialog = ref(false);
const dictForm = reactive<Partial<DictRow>>({});
const itemForm = reactive<Partial<DictItemRow>>({});

async function loadDicts() {
  dicts.value = await dictApi.list({ keyword: keyword.value || undefined });
  // 保持当前选中项（保存后不跳回第一个）；当前项已不存在时才回落到第一个
  const keep = current.value && dicts.value.find((d) => d.id === current.value!.id);
  if (keep) current.value = keep;
  else if (dicts.value.length) selectDict(dicts.value[0]);
  else current.value = null;
}

/** 请求序号：快速切换字典时丢弃过期响应，避免右侧显示成上一个字典的项 */
let itemsSeq = 0;
async function selectDict(d: DictRow) {
  current.value = d;
  const seq = ++itemsSeq;
  loadingItems.value = true;
  try {
    const list = await dictApi.items(d.id);
    if (seq === itemsSeq) items.value = list;
  } finally {
    if (seq === itemsSeq) loadingItems.value = false;
  }
}

function openCreateDict() {
  Object.assign(dictForm, { id: undefined, code: "", name: "", status: "ENABLED", remark: "" });
  dictDialog.value = true;
  nextTick(() => clearValidate(dictFormRef));
}

function openEditDict() {
  if (!current.value) return;
  const { id, code, name, status, remark } = current.value;
  Object.assign(dictForm, { id, code, name, status, remark: remark ?? "" });
  dictDialog.value = true;
  nextTick(() => clearValidate(dictFormRef));
}

// ---------- 表单校验（与后端 dict.dto 一致） ----------
const dictFormRef = ref<FormInstance>();
const itemFormRef = ref<FormInstance>();
const dictRules: FormRules = {
  code: [R.required("字典编码"), R.max(50)],
  name: [R.required("名称"), R.max(50)],
  remark: [R.max(255)],
};
const itemRules: FormRules = {
  label: [R.required("展示文案"), R.max(100)],
  value: [R.required("存储值"), R.max(100)],
  remark: [R.max(255)],
};

async function submitDict() {
  if (saving.value || !(await validateForm(dictFormRef))) return;
  saving.value = true;
  try {
    // 只提交 DTO 白名单字段（整行带上 id/_count 会被后端 forbidNonWhitelisted 拒绝；编码创建后不可改）
    const { id, code, name, status, remark } = dictForm;
    if (id) await dictApi.update(id, { name, status, remark });
    else await dictApi.create({ code, name, status, remark });
    dictStore.invalidate(code);
    ElMessage.success("保存成功");
    dictDialog.value = false;
    loadDicts();
  } finally {
    saving.value = false;
  }
}

function openCreateItem() {
  if (!current.value) return;
  Object.assign(itemForm, { id: undefined, label: "", value: "", sort: items.value.length + 1, status: "ENABLED", remark: "" });
  itemDialog.value = true;
  nextTick(() => clearValidate(itemFormRef));
}

function openEditItem(row: DictItemRow) {
  const { id, label, value, sort, status, remark } = row;
  Object.assign(itemForm, { id, label, value, sort, status, remark: remark ?? "" });
  itemDialog.value = true;
  nextTick(() => clearValidate(itemFormRef));
}

async function submitItem() {
  if (!current.value || saving.value || !(await validateForm(itemFormRef))) return;
  saving.value = true;
  try {
    const { id, label, value, sort, status, remark } = itemForm;
    const data = { label, value, sort, status, remark };
    if (id) await dictApi.updateItem(id, data);
    else await dictApi.addItem(current.value.id, data);
    dictStore.invalidate(current.value.code); // 让各页面的 DictSelect / DictTag 下次使用时重新拉取
    ElMessage.success("保存成功");
    itemDialog.value = false;
    selectDict(current.value);
  } finally {
    saving.value = false;
  }
}

/** 删除字典：确认框里写明会一并删除多少个选项（后端在未确认时同样会拒绝） */
const deletingDict = ref(false);
async function removeDict() {
  const d = current.value;
  if (!d) return;
  const count = d._count?.items ?? 0;
  const tip = count
    ? `字典「${d.name}」下有 ${count} 个选项，将一并删除。业务数据里引用这些值的地方将无法显示文案，确认删除？`
    : `确认删除字典「${d.name}」？`;
  if (!(await confirmAction(tip, { title: "删除字典", confirmText: "删除" }))) return;
  deletingDict.value = true;
  try {
    await dictApi.remove(d.id, count > 0);
    dictStore.invalidate(d.code);
    ElMessage.success("已删除");
    current.value = null;
    await loadDicts();
  } finally {
    deletingDict.value = false;
  }
}

async function removeItem(row: DictItemRow) {
  if (!current.value) return;
  await dictApi.removeItem(row.id);
  dictStore.invalidate(current.value.code);
  ElMessage.success("已删除");
  selectDict(current.value);
}

const dictStore = useDictStore();
onMounted(loadDicts);
</script>

<style scoped>
.dict-page { display: grid; grid-template-columns: 300px 1fr; gap: 12px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.dict-list { margin-top: 10px; max-height: 60vh; overflow: auto; }
.dict-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; }
.dict-item:hover { background: var(--el-fill-color-light); }
.dict-item.active { background: var(--el-color-primary-light-9); box-shadow: inset 2px 0 0 var(--el-color-primary); }
.dict-item-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dict-name { font-weight: 500; }
.dict-code { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 2px; }
@media (max-width: 1280px) {
  .dict-page { grid-template-columns: 1fr; }
}
</style>
