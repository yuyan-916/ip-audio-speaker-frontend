<script setup>
// src/views/PlaceholderView.vue —— 尚未接入接口的模块占位页
//
// 菜单是路由驱动的，所以每个菜单项都必须有落点；未实现的模块统一指向这里，
// 免得点了菜单被兜底重定向回首页。实现某个模块后，把 router 里对应的 component
// 换成真实页面即可，本文件可以继续留给后面的模块用。

import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const moduleTitle = computed(() => route.meta.title || '该模块')
</script>

<template>
  <el-card shadow="never">
    <el-empty :description="`「${moduleTitle}」模块尚未接入接口`">
      <p class="placeholder__hint">
        后端接口已就绪（见后端 docs/API.md），本页面待实现：按现有约定新增
        <code>src/api/*.js</code> + <code>src/views/*.vue</code>，再到
        <code>src/router/index.js</code> 注册路由即可。
      </p>
    </el-empty>
  </el-card>
</template>

<style scoped>
.placeholder__hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.placeholder__hint code {
  padding: 0 4px;
  border-radius: 3px;
  background-color: var(--el-fill-color-light);
  font-family: Consolas, Monaco, 'Courier New', monospace;
}
</style>
