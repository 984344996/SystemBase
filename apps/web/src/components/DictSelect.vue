<template>
  <el-select
    :model-value="modelValue"
    :placeholder="placeholder"
    :clearable="clearable"
    :loading="loading"
    v-bind="$attrs"
    @update:model-value="(v: string) => emit('update:modelValue', v)"
  >
    <el-option v-for="o in options" :key="o.value" :label="o.label" :value="o.value" />
  </el-select>
</template>

<script setup lang="ts">
/**
 * 字典下拉框：选项来自数据字典（带缓存），不用在页面里硬编码。
 * 用法：<DictSelect v-model="query.status" code="common_status" placeholder="状态" />
 * 其余属性（style、size、disabled…）原样透传给 el-select
 */
import { computed, onMounted, ref } from "vue";
import { useDictStore } from "@/stores/dict";

defineOptions({ inheritAttrs: false });
const props = withDefaults(
  defineProps<{ code: string; modelValue?: string | null; placeholder?: string; clearable?: boolean }>(),
  { placeholder: "请选择", clearable: true },
);
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const dict = useDictStore();
const loading = ref(false);
const options = computed(() => dict.options(props.code));

onMounted(async () => {
  loading.value = true;
  try {
    await dict.load(props.code);
  } catch {
    /* 加载失败时请求层已提示，这里保持空选项 */
  } finally {
    loading.value = false;
  }
});
</script>
