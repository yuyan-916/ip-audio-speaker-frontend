// src/router/index.js —— 路由表与登录守卫
//
// 结构：/login 独立成页；其余业务页面都挂在 AppLayout 之下（布局里放 <router-view />）。
// 业务页一律**懒加载**（() => import()）：首屏只加载登录页与布局，模块多了也不会拖慢启动。
// 所有模块（38 个 NAS 路径对应的页面）都已实现并在这里注册。
// 将来若新增未实现的模块：先在 src/constants/menus.js 加菜单项，再在这里挂一个占位页。

import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'
import AppLayout from '@/layouts/AppLayout.vue'
import LoginView from '@/views/LoginView.vue'

const APP_TITLE = '网络音频服务器管理后台'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: LoginView,
    // public: 未登录也能进（守卫放行）
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    component: AppLayout,
    children: [
      // 根路径直接落到设备管理（第一个实现的模块）
      { path: '', redirect: { name: 'devices' } },
      {
        path: 'devices',
        name: 'devices',
        component: () => import('@/views/devices/DeviceListView.vue'),
        meta: { title: '设备管理' }
      },
      {
        path: 'groups',
        name: 'groups',
        component: () => import('@/views/groups/GroupListView.vue'),
        meta: { title: '终端分组' }
      },
      {
        path: 'media',
        name: 'media',
        component: () => import('@/views/media/MediaListView.vue'),
        meta: { title: '媒体文件' }
      },
      {
        path: 'playlists',
        name: 'playlists',
        component: () => import('@/views/playlists/PlayListView.vue'),
        meta: { title: '播放列表' }
      },
      {
        path: 'tasks',
        name: 'tasks',
        component: () => import('@/views/tasks/TaskListView.vue'),
        meta: { title: '任务管理' }
      },
      // 以下四个模块同样已实现（至此 38 个 NAS 路径 38/38，没有占位路由）
      {
        path: 'timing',
        name: 'timing',
        component: () => import('@/views/timing/TimingListView.vue'),
        meta: { title: '定时任务' }
      },
      {
        path: 'priority',
        name: 'priority',
        component: () => import('@/views/priority/PriorityListView.vue'),
        meta: { title: '任务优先级' }
      },
      {
        path: 'device-permits',
        name: 'device-permits',
        component: () => import('@/views/devicePermits/DevicePermitListView.vue'),
        meta: { title: '设备权限' }
      },
      {
        path: 'device-tasks',
        name: 'device-tasks',
        component: () => import('@/views/deviceTasks/DeviceTaskListView.vue'),
        meta: { title: '设备任务' }
      }
    ]
  },
  // 兜底：未知路径回首页，再由守卫决定是否弹回登录页
  { path: '/:pathMatch(.*)*', redirect: '/' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 前置守卫：未登录只能进 public 页面；已登录再访问 /login 直接回首页
router.beforeEach((to) => {
  // 必须在守卫内部调用：此时 Pinia 已由 main.js 安装，模块顶层调用会拿不到实例
  const userStore = useUserStore()

  if (!userStore.isLoggedIn && !to.meta.public) {
    return {
      path: '/login',
      // 记下来源路径，登录成功后回到原处；根路径不必带
      query: to.fullPath === '/' ? {} : { redirect: to.fullPath }
    }
  }

  if (userStore.isLoggedIn && to.path === '/login') {
    return { path: '/' }
  }

  return true
})

// 后置守卫：按路由 meta 更新浏览器标题
router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_TITLE}` : APP_TITLE
})

export default router

