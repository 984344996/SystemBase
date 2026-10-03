<template>
  <div class="page-card">
    <div class="toolbar">
      <span class="muted">任务 cron 存数据库，增删改即时生效，无需重启服务</span>
      <div class="spacer" />
      <el-button v-if="auth.hasPerm('system:job:create')" type="primary" plain @click="openCreate">新增任务</el-button>
    </div>

    <el-table :data="rows" border stripe>
      <el-table-column prop="name" label="任务名" width="150" />
      <el-table-column label="处理器" width="170">
        <template #default="{ row }">
          <span>{{ row.handlerKey }}</span>
          <el-tag v-if="!row.handlerExists" type="danger" size="small" style="margin-left: 4px">未注册</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="cronExpr" label="cron 表达式" width="130" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'ENABLED'"
            :disabled="!auth.hasPerm('system:job:update') || !row.handlerExists"
            @change="toggle(row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="上次/下次执行" width="180">
        <template #default="{ row }">
          <div class="mini">上: {{ fmt(row.prevRunAt) }}</div>
          <div class="mini">下: {{ fmt(row.nextRunAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="timeoutSec" label="超时(s)" width="85" />
      <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button v-if="auth.hasPerm('system:job:run') && row.handlerExists" link type="success" @click="runNow(row)">立即执行</el-button>
          <el-button link type="primary" @click="openLogs(row)">日志</el-button>
          <el-button v-if="auth.hasPerm('system:job:update')" link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确定删除该任务吗？" @confirm="remove(row)">
            <template #reference>
              <el-button v-if="auth.hasPerm('system:job:delete')" link type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <!-- 新增/编辑 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑任务' : '新增任务'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="任务名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="处理器" v-if="!editingId">
          <el-select v-model="form.handlerKey" style="width: 100%" placeholder="选择已注册的处理器">
            <el-option v-for="h in handlers" :key="h.key" :label="h.key" :value="h.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="cron 表达式">
          <el-input v-model="form.cronExpr" placeholder="分 时 日 月 周，如 0 3 * * *" />
          <div class="cron-tip">常用：每小时 0 * * * * ｜ 每天 3 点 0 3 * * * ｜ 工作日 9 点 0 9 * * 1-5</div>
        </el-form-item>
        <el-form-item label="参数(JSON)">
          <el-input v-model="form.params" type="textarea" :rows="3" placeholder='{"pageSize": 100}' />
        </el-form-item>
        <el-form-item label="错过策略">
          <el-radio-group v-model="form.misfirePolicy">
            <el-radio value="SKIP">跳过</el-radio>
            <el-radio value="RUN_ONCE">补跑一次</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="超时(秒)"><el-input-number v-model="form.timeoutSec" :min="5" :max="3600" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存并生效</el-button>
      </template>
    </el-dialog>

    <!-- 执行日志抽屉 -->
    <el-drawer v-model="logsVisible" :title="`执行日志 · ${activeJob?.name || ''}`" size="55%">
      <div class="drawer-toolbar">
        <el-date-picker
          v-model="logQuery.date"
          type="date"
          value-format="YYYY-MM-DD"
          :clearable="false"
          style="width: 150px"
          @change="reloadLogs"
        />
        <el-select v-model="logQuery.status" placeholder="状态" clearable style="width: 140px" @change="reloadLogs">
          <el-option v-for="s in ['SUCCESS', 'FAILED', 'TIMEOUT', 'SKIPPED_LOCK']" :key="s" :label="s" :value="s" />
        </el-select>
        <span class="mini">数据来自当日日志文件（category=job, event=run）</span>
      </div>
      <el-table :data="logRows" border size="small">
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="logTag(row.status)" size="small">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="开始时间" width="160">
          <template #default="{ row }">{{ fmt(row.startedAt || row.time) }}</template>
        </el-table-column>
        <el-table-column label="触发" width="70">
          <template #default="{ row }">{{ row.trigger === "manual" ? "手动" : "定时" }}</template>
        </el-table-column>
        <el-table-column label="耗时(ms)" width="90" prop="costMs" />
        <el-table-column label="结果/错误" min-width="220">
          <template #default="{ row }">
            <div v-if="row.error" class="err">{{ row.error.slice(0, 300) }}</div>
            <div v-else>{{ row.result || '-' }}</div>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="logQuery.page"
        v-model:page-size="logQuery.pageSize"
        :total="logTotal"
        layout="total, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
        @change="loadLogs"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { jobApi, type JobRow, type JobLogRow } from "@/api/system";
import { useAuthStore } from "@/stores/auth";
import { today } from "@/utils/datetime";

const auth = useAuthStore();
const rows = ref<JobRow[]>([]);
const handlers = ref<{ key: string }[]>([]);
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const logsVisible = ref(false);
const activeJob = ref<JobRow | null>(null);
const logRows = ref<JobLogRow[]>([]);
const logTotal = ref(0);
const logQuery = reactive({ page: 1, pageSize: 10, jobId: 0, date: today(), status: "" });

const emptyForm = { name: "", handlerKey: "", cronExpr: "0 * * * *", params: "", misfirePolicy: "SKIP", timeoutSec: 300, remark: "" };
const form = reactive({ ...emptyForm });

function fmt(v?: string | null) {
  return v ? v.replace("T", " ").slice(0, 19) : "-";
}
function logTag(s: string) {
  return { SUCCESS: "success", FAILED: "danger", TIMEOUT: "warning", SKIPPED_LOCK: "info" }[s] as any;
}

async function load() {
  rows.value = await jobApi.list();
}

function openCreate() {
  Object.assign(form, emptyForm);
  editingId.value = null;
  dialogVisible.value = true;
}

function openEdit(row: JobRow) {
  Object.assign(form, {
    name: row.name,
    handlerKey: row.handlerKey,
    cronExpr: row.cronExpr,
    params: row.params ? JSON.stringify(row.params) : "",
    misfirePolicy: row.misfirePolicy,
    timeoutSec: row.timeoutSec,
    remark: row.remark || "",
  });
  editingId.value = row.id;
  dialogVisible.value = true;
}

async function submit() {
  if (!form.name || !form.cronExpr) return ElMessage.warning("请填写任务名与 cron 表达式");
  let params: string | undefined = form.params.trim() || undefined;
  if (params) {
    try {
      JSON.parse(params);
    } catch {
      return ElMessage.warning("参数必须是合法 JSON");
    }
  }
  const data = { ...form, params };
  if (editingId.value) await jobApi.update(editingId.value, data);
  else {
    if (!form.handlerKey) return ElMessage.warning("请选择处理器");
    await jobApi.create(data);
  }
  ElMessage.success("已保存并即时生效");
  dialogVisible.value = false;
  load();
}

async function toggle(row: JobRow) {
  await jobApi.toggle(row.id);
  ElMessage.success(row.status === "ENABLED" ? "已暂停" : "已启用");
  load();
}

async function runNow(row: JobRow) {
  ElMessage.info("已触发执行");
  const res = await jobApi.run(row.id);
  if (res?.status === "SUCCESS") ElMessage.success(`执行成功：${res.result?.slice(0, 80) || "无返回"}`);
  else ElMessage.error(`执行失败：${res?.error?.slice(0, 120) || "未知错误"}`);
  load();
}

async function remove(row: JobRow) {
  await jobApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

async function openLogs(row: JobRow) {
  activeJob.value = row;
  Object.assign(logQuery, { jobId: row.id, page: 1, date: today(), status: "" });
  logsVisible.value = true;
  loadLogs();
}

function reloadLogs() {
  logQuery.page = 1;
  loadLogs();
}

async function loadLogs() {
  const res = await jobApi.logs({ ...logQuery, status: logQuery.status || undefined });
  logRows.value = res.list;
  logTotal.value = res.total;
}

onMounted(async () => {
  load();
  handlers.value = await jobApi.handlers();
});
</script>

<style scoped>
.muted {
  color: #8a97a8;
  font-size: 13px;
}
.mini {
  font-size: 12px;
  color: #66707e;
}
.drawer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.cron-tip {
  font-size: 12px;
  color: #aab4c0;
  margin-top: 4px;
  line-height: 1.5;
}
.err {
  color: #f56c6c;
  white-space: pre-wrap;
  font-size: 12px;
}
</style>
