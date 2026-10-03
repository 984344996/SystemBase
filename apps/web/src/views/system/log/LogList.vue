<template>
  <div class="page-card">
    <div class="toolbar">
      <el-select v-model="query.date" placeholder="日期" style="width: 190px" @change="search">
        <el-option v-for="f in files" :key="f.date" :label="`${f.date}（${formatSize(f.size)}）`" :value="f.date" />
      </el-select>
      <el-select v-model="query.level" placeholder="级别" clearable style="width: 110px" @change="search">
        <el-option v-for="l in LOG_LEVEL_OPTIONS" :key="l" :label="l" :value="l" />
      </el-select>
      <el-select v-model="query.category" placeholder="分类" clearable style="width: 110px" @change="search">
        <el-option v-for="c in LOG_CATEGORY_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
      </el-select>
      <el-input v-model="query.traceId" placeholder="traceId" clearable style="width: 220px" @keyup.enter="search" />
      <el-input v-model="query.keyword" placeholder="关键字（原文包含）" clearable style="width: 200px" @keyup.enter="search" />
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <el-button v-permission="'system:log:download'" :disabled="!query.date" @click="download">下载当日日志</el-button>
    </div>

    <el-alert
      v-if="truncated"
      type="warning"
      :closable="false"
      show-icon
      title="命中记录过多，仅保留最新的 5000 条；请缩小条件，或下载原文件分析"
      style="margin-bottom: 12px"
    />

    <el-table v-loading="loading" :data="rows" border stripe size="small">
      <el-table-column type="expand">
        <template #default="{ row }">
          <pre class="log-json">{{ entryDetail(row) }}</pre>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="175">
        <template #default="{ row }">{{ row.time }}</template>
      </el-table-column>
      <el-table-column label="级别" width="80">
        <template #default="{ row }">
          <el-tag :type="levelTagType(row.level)" size="small" effect="plain">{{ row.level }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="分类" width="80">
        <template #default="{ row }">{{ categoryLabel(row.category) }}</template>
      </el-table-column>
      <el-table-column label="traceId" width="140">
        <template #default="{ row }">
          <el-link v-if="row.traceId" type="primary" :underline="false" @click="filterTrace(row.traceId)">
            {{ row.traceId.slice(0, 12) }}…
          </el-link>
          <span v-else class="muted">-</span>
        </template>
      </el-table-column>
      <el-table-column label="消息" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.context" class="muted">[{{ row.context }}] </span>{{ row.msg }}
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="Math.min(total, 5000)"
      :page-sizes="[20, 50, 100]"
      layout="total, prev, pager, next, sizes"
      style="margin-top: 12px; justify-content: flex-end"
      @change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { monitorApi, type LogEntry } from "@/api/system";
import { formatSize, today } from "@/utils/datetime";
import { LOG_CATEGORY_OPTIONS, LOG_LEVEL_OPTIONS, entryDetail, levelTagType, saveBlob } from "@/utils/log";

const files = ref<{ date: string; size: number }[]>([]);
const rows = ref<LogEntry[]>([]);
const total = ref(0);
const truncated = ref(false);
const loading = ref(false);
const query = reactive({ date: today(), level: "", category: "", traceId: "", keyword: "", page: 1, pageSize: 20 });

function categoryLabel(v?: string) {
  return LOG_CATEGORY_OPTIONS.find((c) => c.value === v)?.label || v || "-";
}

async function load() {
  loading.value = true;
  try {
    const res = await monitorApi.logs({
      date: query.date,
      level: query.level || undefined,
      category: query.category || undefined,
      traceId: query.traceId.trim() || undefined,
      keyword: query.keyword || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    rows.value = res.list;
    total.value = res.total;
    truncated.value = res.truncated;
  } finally {
    loading.value = false;
  }
}

function search() {
  query.page = 1;
  load();
}

/** 点击 traceId：只看这一次请求的完整链路（跨分类） */
function filterTrace(traceId: string) {
  Object.assign(query, { traceId, level: "", category: "", keyword: "" });
  search();
}

async function download() {
  const blob = await monitorApi.download(query.date);
  saveBlob(blob, `app.${query.date}.log`);
  ElMessage.success("已开始下载");
}

onMounted(async () => {
  files.value = await monitorApi.dates();
  if (files.value.length && !files.value.some((f) => f.date === query.date)) query.date = files.value[0].date;
  load();
});
</script>

<style scoped>
.muted {
  color: #8a97a8;
}
.log-json {
  margin: 0;
  padding: 8px 12px;
  background: #f7f8fa;
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
