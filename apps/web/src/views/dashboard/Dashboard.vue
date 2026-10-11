<template>
  <div class="dashboard">
    <el-row :gutter="16">
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">欢迎回来</div>
          <div class="stat-value">{{ auth.user?.name }}</div>
          <div class="stat-sub">{{ auth.user?.roles?.join(" · ") }}</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">角色权限</div>
          <div class="stat-value">{{ auth.user?.permissions?.length ?? 0 }}</div>
          <div class="stat-sub">个权限点</div>
        </div>
      </el-col>
      <el-col :span="8">
        <div class="stat-card">
          <div class="stat-label">服务状态</div>
          <div class="stat-value" :style="{ color: healthy ? '#67c23a' : '#f56c6c' }">
            {{ healthy ? "正常" : "异常" }}
          </div>
          <div class="stat-sub">后端探活 /api/health</div>
        </div>
      </el-col>
    </el-row>

    <div class="page-card" style="margin-top: 16px">
      <h3>框架能力一览</h3>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="认证">JWT accessToken + refreshToken 轮换（前端静默续期）</el-descriptions-item>
        <el-descriptions-item label="权限">RBAC：用户-角色-菜单/按钮权限码，接口级校验</el-descriptions-item>
        <el-descriptions-item label="定时任务">cron 存数据库，管理页动态增删改，即时生效</el-descriptions-item>
        <el-descriptions-item label="日志">只落文件、每天一份，INFO / WARN / ERROR 分级，traceId 串联全链路</el-descriptions-item>
        <el-descriptions-item label="审计">登录与操作审计写入日志文件（敏感字段脱敏），管理页按天检索、可下载原文件</el-descriptions-item>
        <el-descriptions-item label="部署">三环境一键脚本：本地启动 / 服务器发布（PM2 + Nginx，秒级回滚）</el-descriptions-item>
      </el-descriptions>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import axios from "axios";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const healthy = ref(false);

onMounted(async () => {
  try {
    const { data } = await axios.get(`${import.meta.env.BASE_URL}api/health`);
    healthy.value = data?.data?.status === "ok" || data?.status === "ok";
  } catch {
    healthy.value = false;
  }
});
</script>

<style scoped>
.stat-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
}
.stat-label {
  color: #8a97a8;
  font-size: 13px;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  margin: 8px 0 4px;
}
.stat-sub {
  color: #aab4c0;
  font-size: 12px;
}
h3 {
  margin: 0 0 16px;
}
</style>
