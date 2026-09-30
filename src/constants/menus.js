// src/constants/menus.js —— 侧边菜单表
//
// 菜单是**路由驱动**的：index 就是路由 path，点击即 router.push(path)。
// 新增一个模块时只需两步：
//   1) 在这里加一项（含 icon 图标名）；
//   2) 在 src/router/index.js 里注册对应路由（懒加载业务页面）。
//
// icon 存的是**图标名字符串**（@element-plus/icons-vue 的导出名），
// 由 src/layouts/AppLayout.vue 里的 MENU_ICONS 表解析成组件 —— 这里只存字符串，
// menus.js 保持纯数据、不 import 任何组件；名字写错 / 留空只是不渲染图标，菜单依旧可点。
//
// 顺序与后端 README「已实现功能」的模块顺序一致。

export const MENUS = [
  { path: '/devices', label: '设备管理', icon: 'Monitor' },
  { path: '/groups', label: '终端分组', icon: 'FolderOpened' },
  { path: '/media', label: '媒体文件', icon: 'Headset' },
  { path: '/playlists', label: '播放列表', icon: 'List' },
  { path: '/tasks', label: '任务管理', icon: 'VideoPlay' },
  { path: '/timing', label: '定时任务', icon: 'AlarmClock' },
  { path: '/priority', label: '任务优先级', icon: 'Sort' },
  { path: '/device-permits', label: '设备权限', icon: 'Lock' },
  { path: '/device-tasks', label: '设备任务', icon: 'SetUp' }
]
