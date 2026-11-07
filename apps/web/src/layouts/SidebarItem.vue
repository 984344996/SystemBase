<template>
  <!-- 有子菜单：递归渲染（支持任意层级） -->
  <el-sub-menu v-if="item.children?.length" :index="item.path || `dir-${item.id}`">
    <template #title>
      <MenuIcon :name="item.icon" />
      <span>{{ item.name }}</span>
    </template>
    <SidebarItem v-for="child in item.children" :key="child.id" :item="child" />
  </el-sub-menu>
  <!-- 叶子菜单：点击按 path 跳转（el-menu 开启了 router 模式） -->
  <el-menu-item v-else :index="item.path || `menu-${item.id}`">
    <MenuIcon :name="item.icon" />
    <template #title>{{ item.name }}</template>
  </el-menu-item>
</template>

<script setup lang="ts">
/** 侧栏菜单项（递归组件）：后端菜单树有几层就渲染几层 */
import type { MenuNode } from "@/api/auth";
import MenuIcon from "@/components/MenuIcon.vue";

defineOptions({ name: "SidebarItem" });
defineProps<{ item: MenuNode }>();
</script>
