import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  // 子路径部署（如 https://域名/systembase-pre）：deploy.sh 构建时注入 SB_BASE_PATH（带尾斜杠）；
  // 路由必须显式 createWebHistory(import.meta.env.BASE_URL)（不传则默认站点根路径 "/"，跳转会跳出子路径），
  // API 前缀见 src/utils/request.ts，三者统一跟随 base
  base: process.env.SB_BASE_PATH || "/",
  plugins: [
    vue(),
    // Element Plus 按需引入：API(ref/computed/ElMessage 等) + 组件自动注册
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 共享包直接指向源码：dev/build 无需先构建 packages/shared/dist
      "@sb/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // SERVER_PORT 由 start-local 脚本传入（与 apps/server/.env 的 PORT 一致），默认 3000
      "/api": {
        target: `http://localhost:${process.env.SERVER_PORT || 3000}`,
        changeOrigin: true,
      },
    },
  },
});
