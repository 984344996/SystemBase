<template>
  <div class="page-card">
    <div class="toolbar">
      <el-date-picker
        v-model="query.date"
        type="date"
        value-format="YYYY-MM-DD"
        :clearable="false"
        style="width: 150px"
        @change="search"
      />
      <el-input v-model="query.keyword" placeholder="用户名/模块/动作" clearable style="width: 200px" @keyup.enter="search" />
      <el-input v-model="query.module" placeholder="模块(精确)" clearable style="width: 130px" @keyup.enter="search" />
      <el-select v-model="query.success" placeholder="结果" clearable style="width: 110px" @change="search">
        <el-option label="成功" value="true" />
        <el-option label="失败" value="false" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <span class="muted">数据来自当日日志文件（category=audit, event=operate）</span>
    </div>

    <el-alert v-if="truncated" type="warning" :closable="false" show-icon title="命中记录过多，仅显示最新 5000 条" style="margin-bottom: 12px" />

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="detail">
            <div><span class="key">traceId：</span>{{ row.traceId || "-" }}</div>
            <div v-if="row.error" class="err"><span class="key">错误：</span>{{ row.error }}</div>
            <div><span class="key">请求参数：</span></div>
            <pre class="json">{{ row.params === undefined ? "-" : JSON.stringify(row.params, null, 2) }}</pre>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="175">
        <template #default="{ row }">{{ row.time }}</template>
      </el-table-column>
      <el-table-column prop="username" label="操作人" width="110" />
      <el-table-column prop="module" label="模块" width="110" />
      <el-table-column prop="action" label="动作" width="110" />
      <el-table-column label="结果" width="80">
        <template #default="{ row }">
          <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? "成功" : "失败" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="请求" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tag size="small" class="method">{{ row.method }}</el-tag>{{ row.path }}
        </template>
      </el-table-column>
      <el-table-column label="耗时" width="90">
        <template #default="{ row }">{{ row.costMs ?? "-" }} ms</template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="130" />
    </el-table>

    <TablePager :query="query" :total="Math.min(total, 5000)" :load="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { monitorApi } from "@/api/system";
import { today } from "@/utils/datetime";
import { usePagedList } from "@/composables/usePagedList";

/** 命中过多时后端只保留最新一部分，页面上提示 */
const truncated = ref(false);
const { query, rows, total, loading, load, search } = usePagedList(
  { date: today(), keyword: "", module: "", success: "", page: 1, pageSize: 10 },
  async (q, { signal }) => {
    const res = await monitorApi.operateLogs(q, signal);
    truncated.value = res.truncated;
    return res;
  },
);

onMounted(load);
</script>

<style scoped>
.detail {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.key {
  color: var(--el-text-color-secondary);
}
.err {
  color: var(--el-color-danger);
}
.json {
  margin: 4px 0 0;
  padding: 8px;
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-all;
}
.method {
  margin-right: 6px;
}
</style>
