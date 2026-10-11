import { createApp } from "vue";
import { createPinia } from "pinia";
import * as Icons from "@element-plus/icons-vue";
import App from "./App.vue";
import router from "./router";
import { permission } from "./directives/permission";
import { reportClientLog, setupClientLog } from "@/utils/clientLog";
import "./styles/index.css";

// Element Plus 组件/样式由 unplugin-vue-components 按需引入，无需全局注册

const app = createApp(App);

// 图标全局注册：菜单数据中的 icon 字段直接使用图标名
for (const [name, component] of Object.entries(Icons)) {
  app.component(name, component);
}

app.use(createPinia());
app.use(router);
app.directive("permission", permission);

// 前端异常上报：window.onerror / unhandledrejection / Vue 组件错误 → 后端 web.YYYY-MM-DD.log
setupClientLog();
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
