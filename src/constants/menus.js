// src/constants/menus.js —— 侧边菜单表
//
// 菜单是**路由驱动**的：index 就是路由 path，点击即 router.push(path)。
// 新增一个模块时只需两步：
//   1) 在这里加一项；
//   2) 在 src/router/index.js 里注册对应路由（未实现的模块统一先用 PlaceholderView 占位）。
//
// 顺序与后端 README「已实现功能」的模块顺序一致。

export const MENUS = [
  { path: '/devices', label: '设备管理' },
  { path: '/groups', label: '终端分组' },
  { path: '/media', label: '媒体文件' },
  { path: '/playlists', label: '播放列表' },
  { path: '/tasks', label: '任务管理' },
  { path: '/timing', label: '定时任务' }
]
