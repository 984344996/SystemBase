import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { permission } from "./directives/permission";
import { reportClientLog, setupClientLog } from "@/utils/clientLog";
import { setupAuthSync } from "@/utils/request";
// Element Plus 组件/样式由 unplugin-vue-components 按需引入，无需全局注册。
// 例外：ElMessage / ElMessageBox 是在 script 里显式 import 的「服务类 API」，按需插件只为模板里
// 用到的组件注入样式，不会给它们带上样式（生产构建里提示框/确认框会没有样式），必须在这里手动引入。
// 用组件自带的 style 入口（会连同依赖的 button/input/overlay 样式一起引入）
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
// 暗色主题变量：<html class="dark"> 时生效（切换逻辑见 utils/theme.ts）
import "element-plus/theme-chalk/dark/css-vars.css";
import "./styles/index.css";
import { setupTheme } from "@/utils/theme";

setupTheme();

const app = createApp(App);

// 图标不全局注册：统一用 <MenuIcon name="Setting" />（整套图标在单独的 chunk 里按需异步加载，不进首屏主包）。
// 注意不要 import { Xxx } from "@element-plus/icons-vue"：该包是单文件，任何静态引用都会把全部图标拉回主包

app.use(createPinia());
app.use(router);
app.directive("permission", permission);

// 前端异常上报：window.onerror / unhandledrejection / Vue 组件错误 → 后端 web.YYYY-MM-DD.log
setupClientLog();
// 跨标签页登录态同步：其他标签页登出/换账号时本页刷新，避免界面身份与请求身份不一致
setupAuthSync();
app.config.errorHandler = (err, _instance, info) => {
  reportClientLog({
    level: "error",
    kind: "error",
    msg: `[vue] ${info}: ${err instanceof Error ? err.message : String(err)}`,
    stack: err instanceof Error ? err.stack : undefined,
    url: location.href,
  });
  // 开发环境仍打印，方便直接看控制台
  if (import.meta.env.DEV) console.error(err);
};

app.mount("#app");
