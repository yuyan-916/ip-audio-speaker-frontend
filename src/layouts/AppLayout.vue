<script setup>
// src/layouts/AppLayout.vue —— 登录后的整体布局（顶栏 + 侧边菜单 + 内容区）
//
// 版式（商务风格，参考阿里云控制台）：
//   ┌────────────── 顶栏 56px（#001529）：品牌 / 面包屑 / 用户下拉 ──────────────┐
//   ├── 侧边栏 220px（#001529，菜单）────────┬── 内容区（#F0F2F5，页面自带 .app-page）──┤
//   即：深色顶栏通栏 + 下方左右分栏。顶栏与侧边栏同色，视觉上连成一体。
//
// 菜单是**路由驱动**的：index 就是路由 path，点击即 router.push(path)。
// el-menu 自带 router 模式，但本项目已用 @select + router.push 实现了同样的跳转，
// 所以这里**不加** router 属性 —— 否则同一处跳转会写两遍（重复 push 同一路径）。
// 新增模块：改 src/constants/menus.js（含 icon）+ src/router/index.js 两处即可。
//
// 配色 / 尺寸 token 见 src/styles/theme.css，全局样式见 src/styles/global.css。
// 图标必须在 JS 侧**显式 import**：unplugin 的 ElementPlusResolver 只认 element-plus
// 自己的组件，不认 @element-plus/icons-vue，模板里的图标名不会自动注册。
//
// JS 侧 API 一律显式 import（原因见 LoginView.vue 顶部说明）。

import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  AlarmClock,
  ArrowDown,
  FolderOpened,
  Headset,
  List,
  Lock,
  Monitor,
  SetUp,
  Sort,
  SwitchButton,
  UserFilled,
  VideoPlay
} from '@element-plus/icons-vue'
import { MENUS } from '@/constants/menus'
import { useUserStore } from '@/stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

/**
 * 菜单图标表：键名 = src/constants/menus.js 里 menu.icon 的字符串。
 * 这里**逐项列出**（而不是 `import * as Icons`）是为了让打包器 tree-shaking：
 * 只把这 9 个图标打进产物，而不是整套 300+ 个图标（体积差好几倍）。
 */
const MENU_ICONS = {
  Monitor,
  FolderOpened,
  Headset,
  List,
  VideoPlay,
  AlarmClock,
  Sort,
  Lock,
  SetUp
}

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
    <!-- ============ 顶栏：品牌 / 面包屑 / 用户下拉（深色通栏） ============ -->
    <el-header class="layout__topbar" height="56px">
      <div class="layout__brand">
        <el-icon class="layout__brand-icon"><Headset /></el-icon>
        <span class="layout__brand-title">网络音频服务器</span>
      </div>

      <!-- 面包屑由当前路由的 meta.title 生成（首页 → 当前模块） -->
      <el-breadcrumb class="layout__breadcrumb" separator="/">
        <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
        <el-breadcrumb-item v-if="pageTitle">{{ pageTitle }}</el-breadcrumb-item>
      </el-breadcrumb>

      <div class="layout__topbar-right">
        <!-- 退出确认逻辑仍在 handleLogout 里（本组件原样保留），这里只换成下拉菜单触发 -->
        <el-dropdown trigger="click" @command="handleLogout">
          <span class="layout__user">
            <el-icon class="layout__user-icon"><UserFilled /></el-icon>
            <span class="layout__user-name">{{ userStore.username || '-' }}</span>
            <el-icon class="layout__user-arrow"><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">
                <el-icon><SwitchButton /></el-icon>
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>

    <!-- ============ 下方：侧边菜单 + 内容区 ============ -->
    <el-container class="layout__body">
      <el-aside class="layout__aside" width="220px">
        <el-menu
          class="layout__menu"
          mode="vertical"
          background-color="#001529"
          text-color="#BFCBD9"
          active-text-color="#FFFFFF"
          :default-active="activeMenu"
          @select="handleMenuSelect"
        >
          <el-menu-item v-for="menu in MENUS" :key="menu.path" :index="menu.path">
            <!-- 图标名来自 menus.js；名字写错时只是不渲染图标，不影响点击 -->
            <el-icon v-if="MENU_ICONS[menu.icon]" class="layout__menu-icon">
              <component :is="MENU_ICONS[menu.icon]" />
            </el-icon>
            <span class="layout__menu-label">{{ menu.label }}</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main class="layout__main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
/* 本组件的样式只负责「布局骨架 + 深色顶栏/侧边栏」；
   配色一律取 src/styles/theme.css 里的 token，不写死色值。 */

/* ---------------- 外层容器 ---------------- */
.layout {
  height: 100%;
}

/* ---------------- 顶栏（#001529，通栏） ---------------- */
.layout__topbar {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 16px;
  padding: 0 16px;
  background-color: var(--app-bg-sidebar);
}

.layout__brand {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 8px;
  color: var(--app-text-sidebar-active);
}

.layout__brand-icon {
  font-size: 20px;
  color: var(--app-primary);
}

.layout__brand-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* 面包屑：EP 默认是深色文字，在 #001529 上几乎看不见，必须逐项改色。
   margin-right: auto 把右侧用户块顶到最右，面包屑紧跟在品牌之后。 */
.layout__breadcrumb {
  margin-right: auto;
  min-width: 0;
}

.layout__breadcrumb :deep(.el-breadcrumb__inner),
.layout__breadcrumb :deep(.el-breadcrumb__separator) {
  color: var(--app-text-sidebar);
}

.layout__breadcrumb :deep(.el-breadcrumb__inner.is-link) {
  font-weight: 400;
}

.layout__breadcrumb :deep(.el-breadcrumb__inner.is-link:hover) {
  color: var(--app-text-sidebar-active);
}

/* 最后一项是「当前页」，固定白色且不可点（EP 默认还会给它 hover 反馈） */
.layout__breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--app-text-sidebar-active);
  cursor: text;
}

.layout__topbar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.layout__user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 13px;
  color: var(--app-text-sidebar);
  cursor: pointer;
  border-radius: var(--app-radius);
  transition: color 0.2s, background-color 0.2s;
}

.layout__user:hover {
  color: var(--app-text-sidebar-active);
  background-color: rgba(255, 255, 255, 0.08);
}

.layout__user-icon {
  font-size: 16px;
}

.layout__user-arrow {
  font-size: 12px;
}

/* ---------------- 下方主区（左菜单 + 右内容） ---------------- */
/* overflow: hidden 防止内部（长表格）把整页顶高：滚动条只在内容区里出现 */
.layout__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ---------------- 侧边栏（#001529） ---------------- */
.layout__aside {
  width: 220px;
  overflow-y: auto;
  background-color: var(--app-bg-sidebar);
}

.layout__menu {
  flex: 1;
  border-right: none;
  background-color: var(--app-bg-sidebar);
}

/* 菜单项：44px 行高 + 左侧 3px 竖条。
   未选中时竖条透明（占位），保证 hover / 选中时整行文字不会横向位移。 */
.layout__menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 4px 0;
  padding-left: 17px;
  color: var(--app-text-sidebar);
  border-left: 3px solid transparent;
  transition: color 0.2s, background-color 0.2s, border-color 0.2s;
}

.layout__menu :deep(.el-menu-item:hover) {
  color: var(--app-text-sidebar-active);
  background-color: rgba(255, 255, 255, 0.08);
}

/* 选中项：白色文字 + 主色底（半透明，压在深底上比纯色更稳）+ 3px 蓝色竖条 */
.layout__menu :deep(.el-menu-item.is-active) {
  color: var(--app-text-sidebar-active);
  font-weight: 500;
  background-color: rgba(22, 119, 255, 0.16);
  border-left-color: var(--app-primary);
}

.layout__menu-icon {
  width: 18px;
  flex-shrink: 0;
  margin-right: 10px;
  font-size: 16px;
}

/* 长菜单名在 220px 里省略号截断（不换行、不把菜单撑宽） */
.layout__menu-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ---------------- 内容区 ---------------- */
/* padding 置 0：内边距由页面自己的 .app-page 提供（16px + 页面灰底），
   两处都写会叠成 32px（见 src/styles/global.css 的 .app-page）。 */
.layout__main {
  padding: 0;
  background-color: var(--app-bg-page);
}
</style>
