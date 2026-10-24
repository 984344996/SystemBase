<template>
  <div class="page">
    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="query.keyword" placeholder="文件名" clearable style="width: 220px" @keyup.enter="search" />
        <el-button type="primary" @click="search">查询</el-button>
        <div class="spacer" />
        <el-button v-permission="'system:file:upload'" type="primary" @click="triggerUpload">
          {{ uploading ? "上传中..." : "上传文件" }}
        </el-button>
        <input ref="inputRef" type="file" hidden @change="onPick" />
      </div>

      <!-- 拖拽上传区 -->
      <div
        v-if="canUpload"
        :class="['dropzone', { over: dragOver }]"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
        @click="triggerUpload"
      >
        将文件拖到此处，或点击选择（大小上限 {{ maxMB }}MB）
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="文件名" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="file-icon">{{ iconOf(row.mime) }}</span>{{ row.name }}
          </template>
        </el-table-column>
        <el-table-column prop="mime" label="类型" width="160" show-overflow-tooltip />
        <el-table-column label="大小" width="110">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="上传时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button
              v-permission="'system:file:download'"
              link
              type="primary"
              :loading="downloadingId === row.id"
              @click="onDownload(row)"
            >
              下载
            </el-button>
            <el-popconfirm title="确认删除？" @confirm="onDelete(row)">
              <template #reference>
                <el-button v-permission="'system:file:delete'" link type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
        <template #empty>暂无文件</template>
      </el-table>

      <TablePager :query="query" :total="total" :load="load" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { fileApi, type FileRow } from "@/api/file";
import { usePagedList } from "@/composables/usePagedList";
import { formatSize, formatTime } from "@/utils/datetime";
import { saveBlob } from "@/utils/log";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const { query, rows, total, loading, load, search } = usePagedList(
  { page: 1, pageSize: 10, keyword: "" },
  (q) => fileApi.list({ ...q, keyword: q.keyword || undefined }),
);
const uploading = ref(false);
const dragOver = ref(false);
const inputRef = ref<HTMLInputElement>();

const canUpload = computed(() => auth.hasPerm("system:file:upload"));
const maxMB = Number(import.meta.env.VITE_UPLOAD_MAX_MB || 10);

function triggerUpload() {
  if (!canUpload.value) return ElMessage.warning("没有上传权限");
  inputRef.value?.click();
}

async function upload(file: File) {
  if (file.size > maxMB * 1024 * 1024) return ElMessage.warning(`文件不能超过 ${maxMB}MB`);
  uploading.value = true;
  try {
    await fileApi.upload(file);
    ElMessage.success("上传成功");
    load();
  } finally {
    uploading.value = false;
  }
}

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) upload(file);
  (e.target as HTMLInputElement).value = "";
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) upload(file);
}

/** 下载：带 Authorization 头请求 Blob 再保存（token 不进 URL） */
const downloadingId = ref<number | null>(null);
async function onDownload(row: FileRow) {
  if (downloadingId.value) return;
  downloadingId.value = row.id;
  try {
    saveBlob(await fileApi.download(row.id), row.name);
  } finally {
    downloadingId.value = null;
  }
}

async function onDelete(row: FileRow) {
  await fileApi.remove(row.id);
  ElMessage.success("已删除");
  load();
}

function iconOf(mime: string) {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("zip")) return "🗜️";
  return "📄";
}

onMounted(load);
</script>

<style scoped>
.dropzone {
  border: 1px dashed #d9d9d9;
  border-radius: 8px;
  padding: 18px;
  text-align: center;
  color: #909399;
  cursor: pointer;
  margin-bottom: 12px;
  transition: all 0.2s;
}
.dropzone:hover { border-color: #409eff; color: #409eff; }
.dropzone.over { background: #ecf5ff; border-color: #409eff; }
.file-icon { margin-right: 6px; }
</style>
