import { defineStore } from "pinia";
import { dictApi, type DictOption } from "@/api/dict";

/** 前端字典缓存有效期：字典很少变，5 分钟内同一字典只请求一次 */
const TTL_MS = 5 * 60_000;

interface Entry {
  options: DictOption[];
  loadedAt: number;
}

/**
 * 数据字典缓存（下拉选项、状态文案的统一来源，避免各页面硬编码枚举）。
 *
 * - load(code)：取选项，带缓存；同一字典并发请求只发一次
 * - label(code, value)：取文案（需先 load；组件 DictTag 会自动 load）
 * - invalidate(code)：字典管理页修改后调用，下次使用时重新拉取
 * 登出会整页刷新，缓存随之清空。
 */
export const useDictStore = defineStore("dict", {
  state: () => ({
    entries: {} as Record<string, Entry>,
  }),
  actions: {
    async load(code: string): Promise<DictOption[]> {
      const hit = this.entries[code];
      if (hit && Date.now() - hit.loadedAt < TTL_MS) return hit.options;
      let p = inflight.get(code);
      if (!p) {
        p = dictApi
          .options(code)
          .then((options) => {
            this.entries[code] = { options, loadedAt: Date.now() };
            return options;
          })
          .finally(() => inflight.delete(code));
        inflight.set(code, p);
      }
      return p;
    },
    /** 已加载的选项（未加载返回空数组，不触发请求） */
    options(code: string): DictOption[] {
      return this.entries[code]?.options ?? [];
    },
    /** value → label；字典未加载或无此值时返回原值 */
    label(code: string, value: string | null | undefined): string {
      if (value === null || value === undefined) return "";
      return this.options(code).find((o) => o.value === value)?.label ?? value;
    },
    invalidate(code?: string) {
      if (code) delete this.entries[code];
      else this.entries = {};
    },
  },
});

/** 进行中的请求（不放进 state：Promise 不需要响应式） */
const inflight = new Map<string, Promise<DictOption[]>>();
