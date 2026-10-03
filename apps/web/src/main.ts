import { createApp } from "vue";
import { createPinia } from "pinia";
import * as Icons from "@element-plus/icons-vue";
import App from "./App.vue";
import router from "./router";
import { permission } from "./directives/permission";
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
app.mount("#app");
