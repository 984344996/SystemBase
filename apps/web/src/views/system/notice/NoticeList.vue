<template>
  <div class="page">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="query.keyword" placeholder="标题" clearable style="width: 200px" @keyup.enter="search" />
        <el-select v-model="query.type" placeholder="类型" clearable style="width: 120px" @change="search">
          <el-option label="公告" value="NOTICE" />
          <el-option label="消息" value="MSG" />
        </el-select>
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px" @change="search">
          <el-option label="草稿" value="DRAFT" />
          <el-option label="已发布" value="PUBLISHED" />
        </el-select>
        <el-button type="primary" @click="search">查询</el-button>
        <div class="spacer" />
        <el-button v-permission="'system:notice:create'" type="primary" @click="openCreate">新增公告</el-button>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column label="标题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag v-if="row.top" size="small" type="danger" class="top-tag">置顶</el-tag>
            {{ row.title }}
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ row.type === "MSG" ? "消息" : "公告" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="有效期" min-width="200">
          <template #default="{ row }">
            <span v-if="!row.startAt && !row.endAt">长期有效</span>
            <span v-else>{{ fmt(row.startAt) }} ~ {{ fmt(row.endAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'system:notice:update'" link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="row.status === 'DRAFT'"
              v-permission="'system:notice:publish'"
              link
              type="success"
              @click="onPublish(row)"
            >
              发布
            </el-button>
            <el-button link type="primary" @click="preview(row)">预览</el-button>
            <el-popconfirm title="确认删除？" @confirm="onDelete(row)">
              <template #reference>
                <el-button v-permission="'system:notice:delete'" link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>暂无公告</template>
      </el-table>

      <TablePager :query="query" :total="total" :load="load" />
    </el-card>

    <el-drawer v-model="dialog" :title="editingId ? '编辑公告' : '新增公告'" size="560px">
      <el-form :model="form" label-width="90px">
        <el-form-item label="标题"><el-input v-model="form.title" /></el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="NOTICE">公告</el-radio>
            <el-radio value="MSG">消息</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="置顶"><el-switch v-model="form.top" /></el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="range"
            type="datetimerange"
            range-separator="~"
            start-placeholder="生效开始"
            end-placeholder="生效结束"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="form.content" type="textarea" :rows="8" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-drawer>

    <!-- 预览 -->
    <el-dialog v-model="previewVisible" :title="previewRow?.title" width="520px">
      <div class="notice-content">{{ previewRow?.content }}</div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { noticeApi, type NoticeRow } from "@/api/notice";
import { usePagedList } from "@/composables/usePagedList";

const { query, rows, total, loading, load, search } = usePagedList(
  { page: 1, pageSize: 10, keyword: "", type: "", status: "" },
  (q) =>
    noticeApi.list({
      ...q,
      keyword: q.keyword || undefined,
      type: q.type || undefined,
      status: q.status || undefined,
    }),
);
const saving = ref(false);
const dialog = ref(false);
const previewVisible = ref(false);
const previewRow = ref<NoticeRow | null>(null);
const range = ref<[string, string] | null>(null);
const editingId = ref<number | null>(null);
const form = reactive({ title: "", content: "", type: "NOTICE", top: false, status: "DRAFT" });

function openCreate() {
  editingId.value = null;
  Object.assign(form, { title: "", content: "", type: "NOTICE", top: false, status: "DRAFT" });
  range.value = null;
  dialog.value = true;
}

function openEdit(row: NoticeRow) {
  editingId.value = row.id;
  // 只取表单字段（整行 assign 会带上 id/createdAt 等，提交时被后端白名单校验拒绝）
  Object.assign(form, { title: row.title, content: row.content, type: row.type, top: row.top, status: row.status });
  range.value = row.startAt && row.endAt ? [row.startAt, row.endAt] : null;
  dialog.value = true;
}

async function submit() {
  if (!form.title || !form.content) return ElMessage.warning("标题与内容不能为空");
  saving.value = true;
  try {
    if (editingId.value) {
      // 清空有效期时显式传 null（undefined 表示不修改，原有效期会保留）
      await noticeApi.update(editingId.value, { ...form, startAt: range.value?.[0] ?? null, endAt: range.value?.[1] ?? null });
    } else {
      await noticeApi.create({ ...form, startAt: range.value?.[0], endAt: range.value?.[1] });
    }
    ElMessage.success("保存成功（发布后用户端可见）");
    dialog.value = false;
    load();
  } finally {
    saving.value = false;
  }
}

async function onPublish(row: NoticeRow) {
  await noticeApi.publish(row.id);
  ElMessage.success("已发布");
  load();
}

async function onDelete(row: NoticeRow) {
  await noticeApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

function preview(row: NoticeRow) {
  previewRow.value = row;
  previewVisible.value = true;
}

function fmt(v?: string | null) {
  return v ? String(v).replace("T", " ").slice(0, 16) : "不限";
}

onMounted(load);
</script>

<style scoped>
.top-tag { margin-right: 6px; }
.notice-content { white-space: pre-wrap; line-height: 1.7; color: #303133; }
</style>
