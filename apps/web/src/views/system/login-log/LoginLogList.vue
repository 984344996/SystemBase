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
      <el-input v-model="query.keyword" placeholder="用户名" clearable style="width: 180px" @keyup.enter="search" />
      <el-select v-model="query.success" placeholder="结果" clearable style="width: 110px" @change="search">
        <el-option label="成功" value="true" />
        <el-option label="失败" value="false" />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
      <div class="spacer" />
      <span class="muted">数据来自当日日志文件（category=audit, event=login）</span>
    </div>

    <el-alert v-if="truncated" type="warning" :closable="false" show-icon title="命中记录过多，仅显示最新 5000 条" style="margin-bottom: 12px" />

    <el-table v-loading="loading" :data="rows" border stripe>
      <el-table-column label="时间" width="175">
        <template #default="{ row }">{{ row.time }}</template>
      </el-table-column>
      <el-table-column prop="username" label="用户名" width="140" />
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? "成功" : "失败" }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="原因" width="130">
        <template #default="{ row }">{{ row.reason || "-" }}</template>
      </el-table-column>
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="浏览器/设备" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ row.ua || "-" }}</template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :total="Math.min(total, 5000)"
      layout="total, prev, pager, next, sizes"
      style="margin-top: 12px; justify-content: flex-end"
      @change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { monitorApi, type LoginLogRow } from "@/api/system";
import { today } from "@/utils/datetime";

const rows = ref<LoginLogRow[]>([]);
const total = ref(0);
const truncated = ref(false);
const loading = ref(false);
const query = reactive({ date: today(), keyword: "", success: "", page: 1, pageSize: 10 });

async function load() {
  loading.value = true;
  try {
    const res = await monitorApi.loginLogs({
      date: query.date,
      keyword: query.keyword || undefined,
      success: query.success || undefined,
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

onMounted(load);
</script>

<style scoped>
.muted {
  color: #8a97a8;
  font-size: 12px;
}
</style>
