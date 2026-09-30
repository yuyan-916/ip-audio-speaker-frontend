<script setup>
// src/layouts/AppLayout.vue —— 登录后的整体布局（侧边菜单 + 顶部栏 + 内容区）
//
// 由原 HomeView.vue 拆出：菜单改为**路由驱动**（index 就是路由 path），
// 内容区交给 <router-view />，各业务页面只专注自己那一块。
// 新增模块：改 src/constants/menus.js + src/router/index.js 两处即可。
//
// JS 侧 API 一律显式 import（原因见 LoginView.vue 顶部说明）。

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MENUS } from '@/constants/menus'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// el-menu 的高亮项直接用当前路由 path，菜单与地址栏天然同步（不需要本地 active 状态）
const activeMenu = computed(() => route.path)
const pageTitle = computed(() => route.meta.title || '')

function handleMenuSelect(path) {
  if (path !== route.path) router.push(path)
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning'
    })
  } catch {
    return // 用户点了取消 / 关闭弹窗
  }

  userStore.logout()
  ElMessage.success('已退出登录')
  router.replace('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-aside class="layout__aside" width="200px">
      <div class="layout__brand">
        <span class="layout__brand-title">网络音频服务器</span>
        <span class="layout__brand-sub">管理后台</span>
      </div>

      <el-menu class="layout__menu" :default-active="activeMenu" @select="handleMenuSelect">
        <el-menu-item v-for="menu in MENUS" :key="menu.path" :index="menu.path">
          {{ menu.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="layout__header">
        <span class="layout__header-title">{{ pageTitle }}</span>

        <div class="layout__header-right">
          <span class="layout__header-user">当前用户：{{ userStore.username || '-' }}</span>
          <el-button type="danger" plain size="small" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="layout__main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}

.layout__aside {
  display: flex;
  flex-direction: column;
  background-color: #fff;
  border-right: 1px solid var(--el-border-color-light);
}

.layout__brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.layout__brand-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.layout__brand-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.layout__menu {
  flex: 1;
  border-right: none;
}

.layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #fff;
  border-bottom: 1px solid var(--el-border-color-light);
}

.layout__header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.layout__header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.layout__header-user {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.layout__main {
  background-color: var(--el-bg-color-page);
}
</style>
