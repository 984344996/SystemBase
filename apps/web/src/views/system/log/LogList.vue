<template>
  <div class="page-card">
    <div class="toolbar">
      <!-- 后端日志 app.*.log 与前端日志 web.*.log 分开存放，前端错误由浏览器上报 -->
      <el-radio-group v-model="query.source" size="small" @change="search">
        <el-radio-button value="server">后端日志</el-radio-button>
        <el-radio-button value="client">前端日志</el-radio-button>
      </el-radio-group>
      <el-select v-model="query.date" placeholder="日期" style="width: 190px" @change="search">
        <el-option v-for="f in files" :key="f.date" :label="`${f.date}（${formatSize(f.size)}）`" :value="f.date" />
      </el-select>
      <el-select
        v-if="query.source === 'server'"
        v-model="query.level"
        placeholder="级别"
        clearable
        style="width: 110px"
        @change="search"
      >
        <el-option v-for="l in LOG_LEVEL_OPTIONS" :key="l" :label="l" :value="l" />
      </el-select>
      <el-select
        v-if="query.source === 'server'"
        v-model="query.category"
        placeholder="分类"
        clearable
        style="width: 110px"
        @change="search"
      >
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
          <div v-if="row.url" class="muted mini">{{ row.url }}</div>
        </template>
      </el-table-column>
    </el-table>

    <TablePager
      :query="query"
      :total="Math.min(total, 5000)"
      :load="load"
      :page-sizes="[20, 50, 100]"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { usePagedList } from "@/composables/usePagedList";
import { ElMessage } from "element-plus";
import { monitorApi } from "@/api/system";
import { formatSize, today } from "@/utils/datetime";
import { LOG_CATEGORY_OPTIONS, LOG_LEVEL_OPTIONS, entryDetail, levelTagType, saveBlob } from "@/utils/log";

const files = ref<{ date: string; size: number }[]>([]);
/** 命中过多时后端只保留最新一部分，页面上提示 */
const truncated = ref(false);
const { query, rows, total, loading, load, search } = usePagedList(
  {
    date: today(),
    source: "server" as "server" | "client",
    level: "",
    category: "",
    traceId: "",
    keyword: "",
    page: 1,
    pageSize: 20,
  },
  async (q, { signal }) => {
    const res = await monitorApi.logs(
      {
        date: q.date,
        source: q.source,
        // 前端日志没有 category 分类，级别过滤也仅在后端日志下有意义
        level: q.source === "server" ? q.level : undefined,
        category: q.source === "server" ? q.category : undefined,
        traceId: q.traceId.trim(),
        keyword: q.keyword,
        page: q.page,
        pageSize: q.pageSize,
      },
      signal,
    );
    truncated.value = res.truncated;
    return res;
  },
);

function categoryLabel(v?: string) {
  return LOG_CATEGORY_OPTIONS.find((c) => c.value === v)?.label || v || "-";
}


/** 点击 traceId：只看这一次请求的完整链路（跨分类） */
function filterTrace(traceId: string) {
  Object.assign(query, { traceId, level: "", category: "", keyword: "" });
  search();
}

async function download() {
  const blob = await monitorApi.download(query.date, query.source);
  const prefix = query.source === "client" ? "web" : "app";
  saveBlob(blob, `${prefix}.${query.date}.log`);
  ElMessage.success("已开始下载");
}

onMounted(async () => {
  files.value = await monitorApi.dates();
  if (files.value.length && !files.value.some((f) => f.date === query.date)) query.date = files.value[0].date;
  load();
});
</script>

<style scoped>
.mini {
  font-size: 12px;
  margin-top: 2px;
}
.log-json {
  margin: 0;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
