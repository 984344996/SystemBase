import { describe, expect, it, beforeEach } from "vitest";
import { defineComponent, h, nextTick, ref, withDirectives } from "vue";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { permission } from "./permission";
import { useAuthStore } from "@/stores/auth";

/** 渲染 <div><button v-permission="code">x</button></div> */
function render(code: ReturnType<typeof ref<string | string[]>>) {
  return mount(
    defineComponent({
      setup: () => () => h("div", [withDirectives(h("button", { class: "btn" }, "x"), [[permission, code.value]])]),
    }),
  );
}

describe("v-permission", () => {
  beforeEach(() => setActivePinia(createPinia()));

  const login = (permissions: string[]) => {
    useAuthStore().user = { id: 1, username: "u", name: "u", permissions, roleCodes: [] } as never;
  };

  it("有权限保留元素，无权限移除；数组满足任一即可", () => {
    login(["a:list"]);
    expect(render(ref("a:list")).find(".btn").exists()).toBe(true);
    expect(render(ref("a:delete")).find(".btn").exists()).toBe(false);
    expect(render(ref(["a:delete", "a:list"])).find(".btn").exists()).toBe(true);
  });

  it("超管通配 * 全部放行；未传权限码不限制", () => {
    login(["*"]);
    expect(render(ref("anything")).find(".btn").exists()).toBe(true);
    login([]);
    expect(render(ref("")).find(".btn").exists()).toBe(true);
  });

  it("绑定值变化时重新判断：移除后可恢复到原位置", async () => {
    login(["a:list"]);
    const code = ref<string | string[]>("a:delete");
    const w = render(code);
    expect(w.find(".btn").exists()).toBe(false);
    code.value = "a:list";
    await w.vm.$forceUpdate();
    await nextTick();
    expect(w.find(".btn").exists()).toBe(true);
  });
});
