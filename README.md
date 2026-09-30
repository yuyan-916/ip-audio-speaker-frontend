# 网络音频服务器（NAS）管理后台 · 前端

配套后端：[`../ip-audio-speaker-backend`](../ip-audio-speaker-backend)（Spring Boot，默认 `http://localhost:8080`）。
后端接口契约以 `ip-audio-speaker-backend/docs/API.md` 为唯一事实来源；上游（NAS 手册）的字段与枚举见同目录 `docs/impl-notes.md`。

## 一、技术栈

| 项 | 选择 |
|---|---|
| 框架 | Vue 3（`<script setup>`） |
| 构建 | Vite 8 |
| UI | Element Plus 2.14（组件与 API 由 `unplugin-vue-components` / `unplugin-auto-import` 按需自动引入） |
| 状态 | Pinia |
| 路由 | Vue Router（`createWebHistory` + 嵌套路由） |
| 请求 | axios（统一封装在 `src/api/request.js`） |
| 语言 | JavaScript（无 TypeScript；`dts: false`，因此 **JS 侧请显式 import**，不要依赖自动导入） |
| 样式 | 原生 CSS + CSS 变量（无 Sass 等预处理器依赖；设计 token 集中在 `src/styles/theme.css`，见 §九） |
| 图标 | `@element-plus/icons-vue`（同样 **JS 侧显式 import**：unplugin 的 `ElementPlusResolver` 只认 element-plus 自己的组件，不认图标） |

## 二、启动

前置条件：后端已在 `http://localhost:8080` 运行（本前端通过 Vite 代理访问 `/api`，不存在跨域问题）。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
npm run preview    # 预览构建产物
```

- **样式无需额外依赖**：`src/styles/theme.css` / `src/styles/global.css` 都是**原生 CSS**，
  Vite 直接处理，不需要 `sass` / `sass-embedded`（只有 `.scss` 后缀才会触发预处理器检查）。
  换主题 / 加全局规则只改这两个文件即可，详见 §九。
- 开发端口固定 `5173`，代理配置见 `vite.config.js`（把 `/api` 转发到 `localhost:8080`，**不做 rewrite**，因为后端路由自身带 `/api` 前缀）。
- 默认账号：`admin` / `admin123`（来自后端 `app.security.username/password`，与 NAS 账号无关）。
- 后端没配 `app.security.jwt-secret` 时密钥每次重启都会变 → 旧 Token 失效，前端会被 401 打回登录页；要跨重启保持会话就按后端 README 设 `APP_SECURITY_JWT_SECRET`（≥32 字符）。

## 三、目录结构

```
src/
├─ api/                 # 一层薄封装：每个后端模块一个文件，只负责「路径 + 参数」
│  ├─ request.js        # axios 实例、Token 存取、请求/响应拦截器（HTTP 层错误在这里归一）
│  ├─ auth.js           # POST /auth/login
│  ├─ device.js         # /devices/**（四类设备列表、音量、删除、改名、虚假设备）
│  ├─ group.js          # /groups/**（分组列表、新建、编辑、删除）
│  ├─ media.js          # /media/**（三类媒体列表、删除、上传 / 批量上传）
│  ├─ playlist.js       # /playlists/**（播放列表、新建、编辑、删除）
│  ├─ task.js           # /tasks/**（运行中任务、按设备查任务、提交临时任务、任务控制、停止全部）
│  ├─ timing.js         # /timing/**（定时任务增删改、定时程序信息 / 配置 / 清除复制剪切）
│  ├─ priority.js       # /priority（任务源优先策略：13 个任务类的查询 + 设置，**部分更新**）
│  ├─ devicePermit.js   # /device-permits/**（已配权限的设备目录、单设备权限读取、权限设置）
│  └─ deviceTask.js     # /device-tasks/**（设备任务目录、加入 / 移出目录、单设备任务清单、启用 / 修改 / 禁用）
├─ constants/           # 枚举字典与纯函数（不含请求）
│  ├─ menus.js          # 侧边菜单表（路由驱动，index 就是路由 path；icon 只存图标名字符串）
│  ├─ device.js         # devClass / State / DeviceType 字典、音量格式化、GBK 字节校验
│  ├─ group.js          # 分组字典与纯函数（31 字符上限、GroupID 校验、FFFFFFxx 扩展、Creater 文案）
│  ├─ media.js          # 媒体类型字典与纯函数（255 字符文件名、100MB 上限 / 8MB 分块说明、上传超时估算、结果行分类）
│  ├─ playlist.js       # 播放列表字典与纯函数（31 字符上限、1024 文件上限、FFxx 引用扩展 / 识别、文件展开）
│  ├─ task.js           # 任务字典与纯函数（类型 / 状态 / 播放模式 / 命令字、TaskID 来源、TaskPriority 拆解、播放内容与目标的可读化）
│  ├─ timing.js         # 定时任务字典与纯函数（WeekDay 位序、按星期 / 绝对时刻、1~24 当前执行程序、程序组合编码、静默与自动切换校验、段式覆盖 payload 组装）
│  ├─ priority.js       # 任务优先级字典与纯函数（13 个任务类、TCPriority 接口值 1~16 与执行值 0~15、TCRule、变更检测与「只提交改过的行」的 payload 组装）
│  ├─ devicePermit.js   # 设备权限字典与纯函数（9 种「需要权限数据」的设备类型、FFFFFFxx / 8 位设备 ID 与 248 上限校验、禁止包含设备自身、三类清单的 payload 组装与候选项生成）
│  └─ deviceTask.js     # 设备任务字典与纯函数（手册 P79 的「设备类型 → 支持的任务类型 + 限定」表、128 条上限、endMode 0/3/4 与 hh:mm:ss 语义、按类型分支的 payload 组装与校验、候选项生成）
├─ layouts/
│  └─ AppLayout.vue     # 登录后的整体布局（深色顶栏 + 侧边菜单 + router-view；版式见 §九）
├─ router/
│  └─ index.js          # 路由表 + 登录守卫（beforeEach）+ 标题（afterEach）
├─ stores/              # Pinia
│  ├─ user.js           # 登录态（token / username）
│  ├─ device.js         # 四类设备列表 + 设备写操作（成功后自动重拉对应列表）
│  ├─ group.js          # 分组列表 + 分组增删改（成功后自动重拉列表）
│  ├─ media.js          # 三类媒体列表 + 删除 / **单个文件**上传（多文件串行由弹窗负责）
│  ├─ playlist.js       # 播放列表 + 增删改（成功后自动重拉列表；fileList 始终完整提交）
│  ├─ task.js           # 运行中任务列表 + 提交 / 控制 / 停止全部 + 5 秒轮询开关、按设备查任务
│  ├─ timing.js         # 定时程序信息 + 按程序缓存的任务列表 + 任务增删改 / 程序配置 / 清除复制剪切
│  ├─ priority.js       # 任务源优先策略（13 条规则的读取 / 写入；无缓存、写后强制重拉）
│  ├─ devicePermit.js   # 已配权限的设备目录 + 按设备 ID 缓存的权限数据（写入后作废该设备缓存并重拉目录）
│  └─ deviceTask.js     # 设备任务目录 + 按设备 ID 缓存的设备任务清单（写后重拉受影响的那一份）
├─ components/
│  ├─ devices/          # 模块内复用组件（三个弹窗：音量 / 改名 / 虚假设备）
│  ├─ groups/           # 分组弹窗（新建 / 编辑表单、成员查看）
│  ├─ media/            # 媒体弹窗（上传：队列 + 串行 + 逐项结果；删除：类型 + 原名确认）
│  ├─ playlists/        # 播放列表弹窗（新建 / 编辑：候选 + 有序已选、上移 / 下移；只读查看内容）
│  ├─ tasks/            # 任务弹窗（提交临时任务：类型 0/1/7 + 播放内容 / 目标 / 结束时间；控制：停止 / 音量 / 暂停恢复 / 下一曲）
│  ├─ timing/           # 定时任务弹窗（任务新建 / 编辑：按类型分支；程序配置：五段各自勾选；程序操作：清除 / 复制 / 剪切 + 二次确认）
│  ├─ devicePermits/    # 设备权限弹窗（分组 / 终端 / 采播器三类清单选择，先读后写，列为空时二次确认「清除」）
│  └─ deviceTasks/      # 设备任务弹窗（新建 / 编辑：类型按设备类型过滤，播放内容按类型分支，对讲任务播放目标单选）
├─ utils/
│  └─ nas-result.js     # HTTP 200 但 Result !== 0 的「NAS 业务拒绝」统一处理
├─ views/
│  ├─ LoginView.vue
│  ├─ devices/DeviceListView.vue
│  ├─ groups/GroupListView.vue
│  ├─ media/MediaListView.vue
│  ├─ playlists/PlayListView.vue
│  ├─ tasks/TaskListView.vue
│  ├─ timing/TimingListView.vue
│  ├─ priority/PriorityListView.vue
│  ├─ devicePermits/DevicePermitListView.vue
│  └─ deviceTasks/DeviceTaskListView.vue
├─ styles/              # 全局样式（分两层：设计 token + 全局规则，见 §九）
│  ├─ theme.css         # --app-* 设计 token + Element Plus 主题变量覆盖（--el-*）
│  └─ global.css        # 最小重置 / 滚动条 / EP 组件微调 / 工具类（.app-page、.app-card）
├─ App.vue
└─ main.js              # 样式引入顺序：EP 样式 → theme.css → global.css（顺序不能改）
```

## 四、两层错误模型（本项目最容易踩的地方）

后端有两套「失败」，**必须分开处理**：

| 层 | 表现 | 谁处理 | 行为 |
|---|---|---|---|
| HTTP 层 | HTTP `4xx` / `5xx`，响应体 `{ timestamp, status, error, message, path, code }` | `src/api/request.js` 响应拦截器 | 统一转成带 `code` / `status` / `data` 的 `Error` 抛出，并弹全局 `ElMessage.error`；请求配置里带 `silent: true` 的（如登录）改由页面自己提示；`401` 会清空登录态并跳回 `/login?redirect=…` |
| NAS 业务层 | **HTTP `200`**，响应体 `{ DataType, Result, Data }` 且 **`Result !== 0`** | 各 store / 页面 | 用 `src/utils/nas-result.js` 的 `assertNasOk(res, '码表名', '动作名')` 断言；失败抛 `NasResultError`，页面捕获后提示 |

- `Result` 码表（各接口语义不同）集中写在 `src/utils/nas-result.js`，逐条抄自后端 `docs/impl-notes.md` §十二；未知码会兜底显示原始数值，便于排障。
- 只读接口用 `nasList(res, …)`：先断言成功、再取 `Data`（缺失时返回空数组）。
- 加新接口时记得把该接口的 `Result` 码表补进 `RESULT_TABLES`。

```js
// store（写操作）
assertNasOk(await setDeviceVolume({ deviceId, volume }), 'volume', '设置音量')

// 页面：只有 NAS 业务拒绝需要自己弹提示（HTTP 层错误拦截器已经弹过）
if (error instanceof NasResultError) ElMessage.error(error.message)
```

## 五、约定

1. **请求体小驼峰、响应大驼峰**：请求发 `deviceId` / `volume` / `devClass`，响应收 `DeviceID` / `Volume` / `DevClass`（后端开了大小写不敏感匹配，但统一按这个规则写，示例才不会乱）。
2. **新增文件用 `@/` 别名**（`@` → `src`，见 `vite.config.js`）；早期文件用的是相对路径，不影响功能。
3. **JS 侧显式 import**（`import { ref } from 'vue'`、`import { ElMessage } from 'element-plus'`）；模板里的 `<el-xxx>` 交给 unplugin 自动注册即可。
4. 注释写「为什么」而不是复述代码；涉及 NAS 语义的坑（音量反向、GBK 字节上限、只支持改播放终端名称……）必须写进注释。
5. 路由：业务页一律懒加载 `() => import()`，并写 `meta.title`（`afterEach` 会拼成浏览器标题）。
6. 菜单项要带 `icon`（图标名，见 `src/constants/menus.js` 与 §九）；模块没做完之前先挂一个占位页，让菜单点了有落点。

## 六、新增一个模块页面的 checklist

1. `src/api/xxx.js`：每个接口一个函数，注释里写清路径、请求体字段、响应形状。
2. 有枚举/字典就在 `src/constants/xxx.js` 里加上（别把魔法数字散在页面里），并把该接口的 `Result` 码表补进 `src/utils/nas-result.js`。
3. 需要跨页面复用的数据放到 `src/stores/xxx.js`（如设备列表，任务模块也要用）。
4. `src/views/xxx/XxxView.vue`（+ 必要的弹窗组件放 `src/components/xxx/`）。
5. 在 `src/router/index.js` 里把对应 child 的 `component` 换成真实页面（懒加载）。
6. 新模块需要在菜单出现时，改 `src/constants/menus.js`（`icon` 用 `@element-plus/icons-vue` 的导出名）。
7. 跑一遍 `npm run build` 确认没有编译错误。

## 七、已实现 / 待实现

**已实现**

- 登录（`POST /api/auth/login`）：Token 存 localStorage 并由拦截器自动注入 `Authorization: Bearer …`；刷新页面保持会话；退出登录清态。
- 设备管理 `/devices`：
  - 四类设备页签（播放终端 / 被动采播器 / 主动采播设备 / 主动插播设备），支持搜索、手动刷新、自动刷新（5/10/30 秒）；
  - 设置基础音量（`POST /api/devices/volume`）；修改设备名称（`POST /api/devices/reconfig`）；删除离线设备（`POST /api/devices/delete`）；添加虚假设备（`POST /api/devices/dummy`）；
  - 页签同步到地址栏 `?class=…`，刷新后仍在同一类。
- 终端分组 `/groups`：
  - 分组列表（分组 ID + 任务用的 `FFFFFFxx` / 名称 / 成员 / 创建者），支持搜索、手动刷新、自动刷新（5/10/30 秒）；
  - 新建（`POST /api/groups/new`，成功后直接提示 NAS 分配的新 `GroupID`）；编辑（`POST /api/groups/edit`，成员从「播放终端」里勾选，保存即整体覆盖）；删除（`POST /api/groups/delete`，带原名确认目标）；
  - 成员弹窗逐个列出终端的名称 / 状态 / IP，并标出「不在终端列表里」与「疑似误填成分组 ID」的成员。
- 媒体文件 `/media`：
  - 三个页签（系统媒体 / 报警媒体 / 分控软件媒体），页签同步到地址栏 `?type=…`；搜索、手动刷新、自动刷新（5/10/30 秒）；
  - 上传（`POST /api/media/{system|alarm}/upload`）：拖拽 / 多选，**串行**逐个上传（NAS 上传是会话式的，同一时刻只能有一个 Open），每个文件单独显示进度；弹窗里有一张「上传结果表」（文件名 / 状态 / FileID / 失败原因），失败按「NAS 拒绝 / 未发出 / 请求失败」分三类；请求超时按文件大小估算（`max(60s, MB × 2s)`，覆盖全局 15s）；
  - 删除（`POST /api/media/{system|alarm}/delete`）：带**列表里的原名**一起提交（NAS 用 ID + 名字一起确认目标），弹窗里明确「只作用于当前媒体类型」；
  - 分控软件媒体**只读**（NAS 没有上传 / 删除接口）：先选一台分控软件设备（候选来自设备管理的「主动插播设备」，也允许手输 8 位十六进制设备 ID），后端用 `SubUserID` 头查询，列表额外带 `DeviceID`。
- 播放列表 `/playlists`：
  - 列表（播放列表 ID + 任务用的 `FFxx` / 名称 / 文件数 / 文件预览），支持搜索、手动刷新、自动刷新（5/10/30 秒）；
  - 新建（`POST /api/playlists/new`，成功后直接提示 NAS 分配的新 `PlayListID`）；编辑（`POST /api/playlists/edit`，文件从「系统媒体」里挑，右侧有序列表可**上移 / 下移 / 移除**，保存即整体覆盖）；删除（`POST /api/playlists/delete`，带原名确认目标）；
  - 查看弹窗按播放顺序列出序号 / FileID / 文件名 / 时长，并标出「不在系统媒体列表里」与「形如 `FFxx`（会被当成播放列表引用）」的条目。
- 任务管理 `/tasks`：
  - **正在运行的任务**（`GET /api/tasks/running`）：搜索、手动刷新、自动刷新（不刷新 / 5 / 10 / 30 秒，**默认 5 秒轮询**，离开页面自动停）；行内展示任务名 + `TaskID` / `TaskSN`（可一键复制凭据）、类型与任务类、状态、播放模式 / 循环 / 任务音量 / 优先级、当前内容（FFxx 会翻成列表名，带播放进度）、参与终端（活动 / 计划数 + 终端或分组名）；空列表显示「当前没有正在运行的任务」；
  - **提交任务**（`POST /api/tasks/submit`）：任务类型只给 0 文件播放 / 1 采播 / 7 文字语音（提交端不支持 3 对讲）；播放内容按类型分别给文件（系统媒体 + 播放列表 `FFxx`，排除形如 `FFxx` 的系统媒体，有序、可上移 / 下移 / 移除，≤180）/ 采播器（被动采播器选一台）/ 文字语音（`voiceText` 带 GBK 字节计数，≤358 字节）；播放目标从播放终端 + 分组里选（分组发 `FFFFFFxx`），≤248；播放模式 / 循环次数、任务音量（0 = 最大）、结束时间（不指定 / 指定时刻 / 持续时长，采播与「随机 / 不限次循环」强制要求）、优先级、自动暂停 / 自动停止；成功后就地显示 `TaskID` / `TaskSN` 供复制；
  - **任务控制**（`POST /api/tasks/control`）：从列表行或「按设备查任务」的结果带出 `TaskID` / `TaskSN`，也可手输；操作为停止（命令字 1）/ 调整任务音量（命令字 7，0~127）/ 暂停恢复（命令字 9 + 参数 1）/ 下一曲（命令字 9 + 参数 3）；
  - **停止全部**（`POST /api/tasks/stop-all`）：会停掉系统上所有任务（含管理软件 / 定时任务 / 其它用户的），必须二次确认；
  - **按设备查任务**（`GET /api/tasks/with-device/{deviceId}`）：设备可选可手输，命中时展示任务信息并可跳转到控制弹窗；未命中时按手册口径提示「字段全缺 = 没有相关任务」。
- 定时任务 `/timing`：
  - **定时程序**（`GET /api/timing/program`）：16 套程序的名称、4 条组合编码、当前执行程序（1~24，17~19 固定组合 / 20 无程序 / 21~24 自定义组合）、静默时段（未设置时 NAS 回的是空对象）、自动切换设置（最多 7 条）全部只读展示，支持手动刷新与自动刷新（不刷新 / 15 / 30 / 60 秒，默认不刷新）；
  - **配置程序**（`POST /api/timing/program/config`）：程序名 / 程序组合 / 当前执行程序 / 静默时段 / 自动切换**五段各自勾选**、只提交勾选的段；程序名 16 个（每个 ≤39 **字符**）、组合 4 条（16 位 0/1，另配 16 个勾选框可直接点）、静默时段可选「设置」或「清除（发空对象）」、自动切换逐条增删（序号 1~7 不重复）；弹窗底部实时列出「本次会整体重置哪些段」，并在打开时把 NAS 现状铺回表单（先读后写）；
  - **清除 / 复制 / 剪切**（`POST /api/timing/program/set`）：清除会删掉该程序内全部任务；复制 / 剪切会把源程序的任务搬到目标程序并**覆盖目标程序原有任务**；三者都做二次确认（弹窗说明 + MessageBox 确认，文案写清源 / 目标与覆盖后果），且默认目标程序自动避开源程序；
  - **任务列表**（`GET /api/timing/tasks/{programIndex}`）：程序号切换（1~16，任务列表按程序分别缓存）、关键字搜索（任务名 / 序号 / 类型 / 文件 ID / 文本）、行内展示任务序号（可复制）/ 使能状态 / 任务名 / 类型 / 触发时间（`WeekDay` 翻成「每天」「周一、三」）/ 结束方式 / 播放内容（文件名，`FFxx` 翻成列表名）/ 播放目标（终端 / 分组名）/ 播放参数（播放模式 / 循环 / 音量 / 提前开功放）；
  - **新建 / 编辑任务**（`POST /api/timing/tasks/new|edit`）：类型 0 文件播放 / 1 采播 / 7 文字语音；开始方式只有「按星期循环」（勾选框顺序 日 一 二 三 四 五 六，实时显示 `WeekDay` 串并拦住全 0）与「指定绝对时刻」（`startDate` + `startTime`）；结束方式只有「不指定」与「指定时刻结束」（采播强制要求结束时刻）；文件任务从**系统媒体 + 播放列表**里挑（有序、可上移 / 下移 / 移除、≤180 项）；采播选一台采播器；文字语音带 358 GBK 字节计数；播放目标 ≤248（分组发 `FFFFFFxx`）；另有任务音量（0 = 最大）、提前开功放 0~15 秒、播放模式 / 循环次数（采播不带这两项）；新建成功会提示 NAS 分配的**任务序号**；
  - **使能 / 禁用**（走 edit 接口**整体回写**、只改 `disable`）、**删除**（`POST /api/timing/tasks/delete`，带 `taskName` 确认目标，确认框里写清「程序号 + 任务序号 + 任务名」三者匹配规则）。
- 任务优先级 `/priority`：
  - **任务源优先策略**（`GET /api/priority`）：13 个任务类（1 自动定时任务 / 2 普通寻呼对讲话筒 / 3 主动采播设备 / … / 11 第三方软件插播 / 12 对讲面板 / 13 主动（对讲）终端）各一行，展示主优先级与处理规则，支持手动刷新；
  - **设置**（`POST /api/priority`）：每行可独立编辑（主优先级 `el-input-number` **1~16**、处理规则下拉 0 原任务优先 / 1 新任务优先）；顶部说明条写清三条口径 ——「接口值 1~16、实际执行 0~15（值 -1）」「只影响请求里出现的任务类，未出现的保持不变」「优先等级只在同一任务类内比较」；
  - **只提交改过的行**：变更检测收在 `constants/priority.js`（`changedPriorityRules` / `pendingPriorityRows`），保存按钮显示待提交条数、无改动时禁用；保存前二次确认**逐行列出变更**（如「11 · 第三方软件插播：主优先级 4（执行 3） → 5（执行 4）；处理规则 原任务优先 → 新任务优先」）；保存成功后重新拉取列表核对；
  - 另有「刷新」（有未保存改动时先确认）、「重置」（整表回滚到本次读取的值）、行内「恢复」（只回滚该行）；改过但没填齐的行会标红并拦住保存（后端三项都是必填）；
  - 任务类固定 13 行：NAS 少返回哪一类就补成空行并标「NAS 未返回」，不会因为 NAS 少给而少显示一行。
- 设备权限 `/device-permits`：
  - **已设置权限数据的设备目录**（`GET /api/device-permits/catalog`）：设备 ID（可复制）+ 设备名称 / 在线状态（用设备列表补全，因为目录里只有 ID 与类型）+ 设备类型（编码 + 中文名；手册未列为「需配权限」的类型会加警告标签），支持搜索与刷新；
  - **设置权限数据**（`POST /api/device-permits`）：三类清单（可访问的**分组** / **终端** / **采播器**）都从对应列表里选（分组 ID 提交时扩展成 `FFFFFFxx`），也允许手输 ID；每类 ≤248 项；打开弹窗先用缓存铺一屏、再 `GET /api/device-permits/{deviceId}` 读一次现状（`Result=1` = 该设备尚未设置，不是错误；读失败会**禁用保存**并提供重试）；
  - **三类都为空 = 清除**（手册语义）：此时保存按钮变成「清除并保存」，二次确认里写明后果，总是显式提交三个空数组；
  - **前端先按后端 DTO 的口径拦一道**（`validatePermitPayload`）：元素格式（分组必须 `FFFFFFxx`；终端 / 采播器必须是 8 位设备 ID，不能是 `FFFFFFxx` 或 `00000000`）、每类 248 项上限、**任一清单里不能包含该设备自身**；不合法时禁用保存并逐条列出原因；
  - **「新增权限数据」= 选一台手册建议配权限的设备**（E8 分控软件 / DA 手机 APP / CE 声卡采集软件 / DE、D8 中间件 / 1E 寻呼话筒 / 5E 对讲话筒 / 5F、9F 网络对讲话筒终端；也允许手输 8 位 ID）直接打开同一个弹窗 —— 目录**不需要**手工添加设备（设置权限即自动入册）。
- 设备任务 `/device-tasks`：
  - **已配置设备任务的设备目录**（`GET /api/device-tasks/catalog`）：设备 ID（可复制）+ 名称 / 在线状态（用设备列表补）+ 设备类型（编码 + 中文名 + 该类型**支持哪些任务类型**与手册限定），支持搜索与刷新；「新增设备」下拉只列手册 P79 类型表里的设备（也允许手输 8 位 ID）；
  - **加入 / 移出目录**（`POST /api/device-tasks/catalog`）：ADD 后自动选中该设备；REMOVE 的确认框写明「会**同步删除该设备的全部设备任务**，且不可恢复」；
  - **某台设备的任务清单**（`GET /api/device-tasks/{deviceId}`）：序号（+ 按设备类型给的可读叫法）/ 启用状态 / 任务名（+ 优先等级、结束方式）/ 类型 / 播放内容（文件名或文本，带播放模式与循环）/ 播放目标（终端名） / 音量；`Result=1` = 这台设备还没有配置任务（提示「还没配过」，不是错误）；
  - **新建 / 编辑任务**（`POST /api/device-tasks`）：任务类型**只能选这台设备支持的类型**（0 文件播放 / 1 采播 / 3 对讲 / 7 文字语音，按手册 P79 的类型表过滤）；播放内容按类型分支（文件从**该设备的媒体来源**选、可手输 4 位 FileID；文字语音 ≤358 GBK 字节并实时计数；采播 / 对讲选采播器，带 `ActCapturer` 限定的设备可留空 = 设备自身）；播放目标默认多选、**对讲任务换成单选**（第一个即被叫方）；另有播放模式 / 循环次数（仅文件与文字语音）、任务音量（0 = 最大）、优先等级 0~15、自动暂停 / 自动停止、结束时间（不指定 / 持续时长 / 时段触发）；
  - **启用 / 禁用**：列表行内两个动作（禁用只发 `deviceId + taskIndex + disable`；**启用是整体设置**，会把列表里的内容一起重发，`deviceTaskToPayload` 负责按类型还原字段），都带二次确认；
  - **前端先按后端 DTO 的口径拦一道**（`validateDeviceTaskPayload`）：序号 1~128、类型必须是该设备类型支持的、对讲任务只能有一个播放目标、文件任务必须有 FileList、文字语音必须有文本且 ≤358 GBK 字节、`endMode` 与 `endTime` 配套、采播任务的采播器（除非该设备带 `ActCapturer` 限定）；不合法时禁用保存并逐条列出原因；另有「能保存但很可能配错了」的黄字提示（`ActPlayer` 限定的设备没把自己放进播放目标、手输分组写法 `FFFFFFxx`、文件里写 `FFxx`）。

**待实现**：无 —— 后端 38 个 NAS 路径对应的页面已全部实现（最后一个模块即上面的「设备任务」）。

## 八、已知限制与坑

- **音量语义是反的**：`0` = 最大（0dB），数值越大越小声，`127` = 静音；终端实际音量 = 基础音量 + 任务音量。UI 里保留了 NAS 原始数值（不翻转成「响度」）。
- **改名**：当前 NAS 版本只支持改播放终端、设备必须在线、改动约 10 秒后才在列表里生效；`devName` 转义前 ≤ 31 字节（GBK 内码，中文/全角按 2 字节计）。
- **删除**：只能删「离线 / 历史」设备，删在线设备 NAS 会返回 `Result=8`；UI 已按状态禁用按钮。
- **虚假设备**：只是占位记录（状态「历史」、无 IP、加入任务无效），真实设备会自动上线。
- **改名接口已于后端修复**：实测（2026-09-30，NAS `192.168.0.2:8308`）确认 NAS 的 `DeviceSetReconfig` **不接受 `DevClass` 字段**——同样的请求带上 `DevClass` 返回 `Result=6`，去掉后返回 `Result=0`。后端 `DeviceService.reconfigDevice` **已不再把 `DevClass` 写进发往 NAS 的报文**（只发 `DataType` + `DeviceID` + `DevName`）；请求体里的 `devClass` 仍必填、仍按 0 / 1 / 3 / 4 校验，只用于确认设备类别并刷新列表。前端无需改动（提示与 `Result` 码表本身是正确的）；详见后端 `docs/impl-notes.md` §十 M7、§十二 第 5 条与 `docs/API.md` 的 `/api/devices/reconfig`。
- **`devClass` 没有 2**：只有 0 / 1 / 3 / 4，传 2 会被后端 400 拒绝。
- **后端 JWT 密钥**：未配置 `app.security.jwt-secret` 时每次重启都会换，旧 Token 全部失效（前端会被 401 打回登录页）。
- **终端分组（`/groups`）**：
  - 分组名上限是 **31 个字符**（手册 P22 / 后端 `@Size(max = 31)`），与设备名的「31 个 GBK 字节」**不是一套口径**，不要把 `gbkByteLength` 拿来做分组名校验。
  - **编辑时缺省成员 = 清空成员**（NAS 语义）：`stores/group.js` 因此**始终显式提交完整 `playerList`**（要清空就发 `[]`），避免「只改个名」把成员悄悄清掉。
  - **分组成员必须是终端设备 ID**：`FFFFFFxx` 这种分组 ID 同样是 8 位十六进制、语法合法但语义错误，接口层拦不住；前端只在表单 / 成员弹窗里给出提示（成员选择器只让从「播放终端」列表里勾选）。
  - **`Creater` 拼写**（少一个 `o`，手册原文如此）：只有分控软件 / 本后端（API 用户，取值 `00000001`~`00000008`）创建的分组才有该字段，管理软件创建的分组**没有** → UI 显示「管理软件创建」。
  - **分组 `Result` 码表缺口**：手册的分组章节（P19-23）只写了三个操作的必填字段、没有列出 `Result` 取值，仓库内也无据可查，所以 `src/utils/nas-result.js` 里**没有** `group` 表、一律走 `COMMON_RESULT_MESSAGES` 兜底（未收录的码会显示原始数值）。拿到手册码表后补 `RESULT_TABLES.group` 即可。
  - 删除分组要求 `groupName` 与列表里**完全一致**（NAS 用它确认目标）→ UI 直接用列表里的原名，不让用户改。
  - 新建分组会返回 NAS 分配的 2 位 `GroupID`：后端为此新增了 `PlayerGroupNewAckDto`（此前只返回 `NasResultDto`，前端拿不到 ID）；编辑 / 删除仍只用 `NasResultDto`。
- **媒体文件（`/media`）**：
  - **文件名上限是 255 个字符**（不是字节）：与设备名的「31 个 GBK 字节」、分组名的「31 个字符」都不是一套口径，别互相套用；空文件 / 名字超 255 / 超 100MB 后端都会拒，前端上传前先用 `describeUploadGuardProblem` 拦一道。
  - **上传不能并发**：NAS 的上传是会话式的（上一次 `Open` 没 `Close` 之前再 `Open` 会拿到 `Result=8`），后端一次性上传接口内部就是串行分块的。前端在 `MediaUploadDialog` 里用 `el-upload` 的 `http-request` 把多文件**串成一条链**；因此**批量上传不是原子操作**——前面的文件可能已经写进 NAS，弹窗里有明确提示，不要对外承诺「失败自动回滚」。
  - **超时必须单独覆盖**：全局 axios 只有 15s，媒体上传按 `max(60s, ceil(字节 / 1000000) × 2s)` 估算（5MB→60s、50MB→100s、100MB→200s）；改用批量接口时按**整批总大小**估算。
  - **100MB / 8MB 的归属**：100MB 是后端 multipart 上限（前端校验它）；**8MB 是后端的分块粒度**（内部自动带 `UploadAddress` 偏移），前端不切片、也不传这个值。
  - **上传弹窗默认逐个调一次性上传接口**（每个文件单独进度、单独超时）；`src/api/media.js` 里的批量接口 `POST /api/media/{mediaType}/upload-batch` 也保留着（一次请求带走整批、按入参顺序返回结果），需要「一次请求传完」时可直接换用。
  - **`Result=-1` 是后端自定标记**：只出现在批量上传接口（空文件 / 缺文件名 / 名字超 255 / 上传过程出错），含义是「后端没有上传这个文件」，**NAS 永远不会返回它**；前端用 `BATCH_UPLOAD_NOT_SENT_RESULT` 与「NAS 拒绝」区分（结果表里分别显示「未发出」与「NAS 拒绝」）。
  - **上传失败的两种通道**：NAS 拒绝 `Open` 或写数据失败 → 后端返回 **HTTP 502**（全局提示里带 NAS 的 `Result`，按手册需重新上传）；`Close` 阶段失败（`7` 异常 / `8` 加入媒体清单失败）→ **HTTP 200 + `Result ≠ 0`**，走 `RESULT_TABLES.mediaUpload`。
  - **`el-upload` 的返回值约定**：`http-request` 返回 Promise 时 element-plus 会自己 `then(onSuccess, onError)`，所以**不要**手动再调 `option.onSuccess` / `option.onError`，否则失败的文件会被二次标成成功。
  - **批量上限必须前端自己数**：`el-upload` 的 `:limit` 判的是**队列总长度**（`upload-content` 里 `fileList.length + files.length > limit`，含上一批已成功的文件），且 `on-exceed` 只在设了 `limit` 时才触发；`uploadRef.value.uploadFiles` 也**没有**被 `ElUpload` expose（只 expose 了 `abort` / `submit` / `clearFiles` / `handleStart` / `handleRemove`），读它必然抛 `TypeError`，而这个异常会被 element-plus 的 `before-upload` `try/catch` **静默吞掉**（文件被移出队列、不发请求、不报错，只表现为「选完文件毫无反应」）。所以 `MediaUploadDialog` 自己数「还没结束的文件数」（`MEDIA_UPLOAD_BATCH_LIMIT`，队列空闲时即「一次最多选 20 个」）。
  - **系统媒体与报警媒体的 `FileID` 取值范围重叠**：同一个 ID 在两类里是不同的文件，删除必须锁定当前媒体类型走对应接口；播放列表只能引用**系统媒体**文件。
  - **`FFxx` 的语义**：`FileList` 的 4 位元素里，`FFxx` 表示「引用播放列表 xx」，**不是**文件 ID 的某种变体，别把文件 ID 的低 2 位拼成 `FFxx`。
  - **分控软件媒体是只读的**：NAS 没有上传 / 删除接口，页面上两个按钮都禁用；查询必须先给 8 位十六进制设备 ID（候选来自「主动插播设备」，设备已离线也能查，结果可能为空）。
  - **删除的两个坑**：文件名必须与列表**完全一致**（NAS 用 ID + 名字确认目标，不一致 `Result=8`），所以弹窗里不允许改名字；文件正在被任务 / 播放列表使用时可能 `Result=7`，且删除成功后播放列表里的引用会失效。
  - **媒体文件列表没有 `Result` 码表**：手册的列表章节只给字段不给码，`nasList(res, 'mediaList', …)` 走通用码兜底（`RESULT_TABLES` 里故意不建空表）。
- **播放列表（`/playlists`）**：
  - **`FileList` 是有序的**：数组顺序就是播放顺序 → 编辑弹窗右侧是「有序列表 + 上移 / 下移 / 移除」，不能用分组那种多选控件（多选表达不了顺序）。
  - **编辑缺省 = 清空文件列表**（NAS 语义）：`stores/playlist.js` 因此**始终显式提交完整 `fileList`**（要清空就发 `[]`），避免「只改个名」把文件清单悄悄清掉。
  - **只能包含系统媒体文件**：候选与文件名补全都只取 `media` store 的 `system` 列表（报警媒体 / 分控媒体的文件不出现）；NAS 自己**不校验**这一点，只会照 ID 播，所以约束只能落在前端。
  - **一个列表最多 1024 个文件**（手册 P33；后端 `@Size(max = 1024)` 也会拦一道），超了在弹窗里就地拦住。
  - **`FFxx` 不是文件**：4 位元素是 `FFxx` 时 NAS 会当成「引用播放列表 xx」而不是文件 → 选择器里这类系统媒体文件被禁用（`looksLikePlayListRef`）；若历史数据里已有这类条目，表单与查看弹窗都会标出来。
  - **删除需要 `PlayListID` + `PlayListName`**（名称用于确认目标，必须与列表里的原名完全一致）→ UI 直接用列表里的原名，不让用户改。
  - **new 接口会返回 NAS 分配的 2 位 `PlayListID`**：后端为此新增了 `FilePlayListNewAckDto`（此前只返回 `NasResultDto`，前端拿不到 ID）；编辑 / 删除仍只用 `NasResultDto`。任务里引用这个列表要写成 `FFxx`。
  - **`Result` 码表只确证了 0 / 8**：手册 P32-34 给的是 0~8 的完整名单，仓库内能确证的只有「0 成功」「8 被服务器拒绝」，3 / 4 按同族 Set 接口（设备音量 / 删除、媒体删除）的同样编号推断；2 / 5 语义未核对 → `RESULT_TABLES.playlist` 里没有它们，未收录的码会显示原始数值，便于照手册排查。
  - **列表接口没有码表**：`nasList(res, 'playListList', …)` 走通用码兜底（`RESULT_TABLES` 里故意不建空表）。
  - **播放模式不属于播放列表**：`PlayMode` 是任务侧的概念（`GET /api/tasks/running`），播放列表本身只有名称 + 有序文件列表，所以本模块没有「播放模式」字典。
- **任务管理（`/tasks`）**：
  - **提交端没有任务类型 3（对讲）**：手册 P62 的类型表里没有它，后端 `@AllowedValues` 也会拒 → 「提交任务」只给 0 / 1 / 7；但**运行端列表里会出现 3**（管理软件 / 对讲设备提交的），不要把它当成脏数据。
  - **采播与「随机播放 / 不限次循环」必须有结束时间**：手册 P64 只说「原则上必须」，本项目在 UI 层直接拦（判断收在 `constants/task.js` 的 `describeEndTimeRequirement`，提交弹窗与校验共用一套口径）。
  - **`TaskState` 手册自相矛盾**：字段表写「0 正在播放 / 1 暂停中 / 2 尚未执行（延时等待中）」，同一处备注又写「排队中为 0」（后端 `docs/impl-notes.md` 记为 M5）→ 列表**原样展示原始数值**、不做语义推断，也不要用它做业务判断。
  - **控制任务必须成对给 `TaskID` + `TaskSN`**，且 **`TaskSN` 不能是 `00000000`**（手册：为 0 时命令无效）；任务被停掉 / 播完后这两个值就失效，再发命令 NAS 会拒（`Result=8`）—— 所以列表里只有「当前还在跑的任务」，历史任务看不到，要重新提交。
  - **只有 `TaskID` 00000001~00000008 才是 HTTP API 提交的临时任务**：`00000000` 是管理软件 / 定时任务，其它取值是分控软件等来源；页面对非 API 来源给出提示但不拦（真正的裁判是 NAS）。
  - **`TaskPriority` 是 4 位十六进制**（不是十进制优先级）：结构 = 任务类主优先级 << 12 | 优先级 << 8 | 顺序号；本后端提交的临时任务固定属于第 11 类「第三方软件插播」，所以把等级拉到 15 也只在**同一任务类内**起作用，抢不过消防 / 紧急采播 / 寻呼话筒（`parseTaskPriority` 负责拆解）。
  - **「停止全部」影响面很大**：`POST /api/tasks/stop-all` 会停掉系统上**所有**任务（管理软件 / 定时任务 / 其它用户提交的都在内），页面强制二次确认，也没有「只恢复其中一条」的说法。
  - **按设备查任务「查不到」不是失败**：手册 P58-60 规定查不到相关任务时响应里除 `DataType` / `Result` 外**字段全部缺席**（不是空值），判空只能用 `hasTaskWithDevice`，不能直接读 `TaskName`。
  - **运行端的任务音量可能 > 127**：手册写「<128 正常播放、≥128 静音」，`formatTaskVolume` 会把超过 127 的原始值标成静音；控制弹窗的滑块范围仍是 0~127。
  - **轮询必须随页面生命周期启停**：定时器收在 `stores/task.js`（模块作用域，不进 state），默认 `TASK_POLL_INTERVAL_MS`（5 秒）；`TaskListView` 在 `onUnmounted` 里 `stopPolling()`，手动刷新时先停轮询、5 秒后再接上，避免「点刷新」与「定时器到点」撞在同一次渲染里。
- **定时任务（`/timing`）**：
  - **「先配置、到时自动执行」**：NAS 创建定时任务时**不校验**文件是否存在、设备是否在线，只有真正执行时才检索 —— 「建成功」不等于「能放出来」；而且 NAS 对第三方 API 创建的定时任务**只使用系统媒体文件**（报警 / 分控媒体的 ID 语法合法但不会响），所以候选里只给系统媒体。
  - **`WeekDay` 从左到右是 周日…周六**（`0111110` = 周一到周五），最容易写反：勾选框顺序、`describeWeekDay` 的翻译、列表里的「每天 / 周一、三」全部按这个位序，并且**不能全 0**（NAS 会拒）。
  - **定时任务的启停模式与临时任务是两套**：`startMode` 只有 0 按星期循环 / 1 指定绝对时刻（没有 2 即时开始、3 等待时长），`endMode` 只有 0 不指定 / 1 指定时刻结束（没有 3 持续时长）；字段上还多出 `disable` / `preOnAmp` / `weekDay`，没有 priority / autoPause / autoStop —— 别把两个弹窗的枚举互相套用。
  - **`CurrentProgram` 是 1~24，不只是程序号**：17 = 程序 1~8 固定组合、18 = 程序 9~16、19 = 全体、20 = 无程序（不执行任何定时任务）、21~24 = 自定义组合 1~4（用 `ProgramComb`）。判断「跑哪套程序」时要按这张表，别把 17~20 当成「第 17~20 套程序」。
  - **程序配置是段式覆盖**：请求里**包含哪个段就整体重置哪个段**（`programName` 出现就必须给满 16 个、`programComb` 给满 4 个、`autoProgram` 一旦出现没填的条目一律按禁用处理、`silenceTime` 给空对象 = 清除）；所以配置弹窗**先读回现状 → 在现状上改 → 只提交勾选的段**，后端还要求至少包含一个段（空请求 400）。想只改一处也绝不能只发一个元素。
  - **复制 / 剪切会覆盖目标程序**：`POST /api/timing/program/set` 的 COPY / CUT 会整体替换目标程序的任务（CUT 还会清空源程序），CLEAR 直接删掉该程序全部任务 → 三者都要二次确认；它们只动任务，不动程序名 / 组合 / 静默 / 自动切换。
  - **edit / delete 都靠「序号 + 名字」确认目标**：`taskIndex` 由 NAS 分配（新建时不能传），删除必须带**与 NAS 上完全一致**的 `taskName`（UI 因此不允许改名删除）；列表页的「使能 / 禁用」是**整体回写**（`timingTaskToPayload` 把这条任务的全部字段一起发回去），只发 `programIndex + taskIndex + disable` 会把其它字段当成清空。
  - **任务名必填**（≤31 个 GBK 字节）：名字留空的任务在 NAS 侧**删不掉**（删除接口要求 `taskName`），所以表单直接拦掉；列表里遇到历史空名任务也会提示先补名字。
  - **提前开功放（`preOnAmp`）只有定时任务有**（0~15 秒）：终端功放上电到出声有延迟，提前开能避免任务开头几秒被吞掉；临时任务没有这个字段。
  - **程序名按「字符」算、任务名按「GBK 字节」算**：`ProgramName` 是 39 个字符（`@Size`），任务名是 31 字节（`@GbkByteLength`）——两套口径别互相套用。
  - **`Result` 码表**：三个写接口在 `RESULT_TABLES` 里（`timingTaskSet` / `timingProgramConfig` / `timingProgramSet`，逐条抄自手册 P39-52）；两个**查询**接口（`timingTaskList` / `timingProgramInfo`）手册没给码表 → 走通用码兜底。
- **任务优先级（`/priority`）**：
  - **接口值 1~16，实际执行 0~15**：`TCPriority` 的**接口取值是 1~16**（越大越优先），而 NAS **实际执行时用「值 - 1」（0~15）** —— 它正好是运行态 `TaskPriority`（4 位十六进制）的 bit15:12。所以校验/输入框一律按**接口值 1~16**（`isValidTCPriority`），行内再标注「实际执行 N」；`0` 在接口层是**非法值**，不要拿执行值 0~15 去提交。
  - **设置是部分更新**：`POST /api/priority` **只影响请求里出现的任务类**，未出现的任务类保持不变（不是「清空」）。页面因此**只提交改过的行**（与本次读取到的基线逐项比对，`changedPriorityRules`），不把 13 行整表发上去 —— 否则可能把期间别的客户端（管理软件 / 分控软件）改过的值覆盖回去；后端 `data` 数组标了 `@NotEmpty`，空请求直接 400，所以无改动时保存按钮禁用。
  - **优先等级只在同一任务类内比较**，不是全局优先级：任务的最终优先级 = **任务类主优先级（本页设置）+ 提交时申请的 `Priority`（0~15，见「任务管理」的提交表单）+ 同类任务的提交顺序**；跨任务类比较没有意义。
  - **13 个任务类是固定的**（1~13；**14~16 保留勿用**，手册原文如此）：页面恒为 13 行，NAS 少返回哪一类就补成空行并标「NAS 未返回」让用户自己填，不会因为 NAS 少给而少显示一行。其中**任务类 11「第三方软件插播」是本后端 HTTP API 提交的临时任务所属的那一类** —— 改它会直接影响 `/tasks` 里提交的任务（行上有标签提示）。
  - **`TCRule` 只有 0 / 1**：0 原任务优先、1 新任务优先；手册注明「其他取值会被强制为 1」，所以表单只给这两个选项，不做自由输入。
  - **改过但没填齐的行会被拦**：`tcPriority` 与 `tcRule` 在后端都是 `@NotNull`，缺一项就是 400（没有「只改优先级、规则保持不变」这种按字段的部分更新 —— 请求里出现一个任务类，就三个字段全覆盖）。页面用 `pendingPriorityRows` 标红并禁用保存。
  - **`Result` 码表**：设置接口在 `RESULT_TABLES` 里（`priority`，逐条抄自手册 P82-84：2 参数超范围 / 3 缺 `TaskClass` / 4 缺 `TCPriority` / 5 缺 `TCRule` / 7 异常 / 8 被拒绝，1 与 6 走通用码）；**查询接口没有码表** → `nasList(res, 'priorityInfo', …)` 走通用码兜底（`RESULT_TABLES` 里故意不建空表）。
- **设备权限（`/device-permits`）**：
  - **HTTP API 用户本身不需要配权限**（手册 P18 原文）：本后端能完整获取设备与分组信息，这一页是给「分控软件 / 对讲话筒 / 手机 APP / 中间件」这类要在**本地显示播放目标清单**的设备配的 —— 页面上有一条常驻说明，避免被误认为「系统缺了配置」。
  - **`PermitGroup` 元素必须是 `FFFFFFxx`**（分组 2 位 ID 扩展成 8 位，与任务的播放目标写法一致）：直接填 `"05"` 会被 NAS 拒（`Result=2`）。UI 从分组列表里选、提交时统一扩展（复用 `toTaskPlayerId`）。

## 九、界面风格

风格定位：**商务专业**（参考阿里云控制台）—— 深色顶栏 / 侧边栏 + 浅灰内容区 + 白色卡片。
本次改版**只动样式与布局**，没有改任何 API 调用、store 逻辑、组件 props 与路由。

### 9.1 两个样式文件（引入顺序不能改）

| 文件 | 作用 |
|---|---|
| `src/styles/theme.css` | 设计 token（`--app-*`）+ Element Plus 主题变量覆盖（`--el-*`） |
| `src/styles/global.css` | 最小重置 / 滚动条 / EP 组件微调 / 工具类（`.app-page`、`.app-card`） |

`src/main.js` 里的顺序固定为 `element-plus/dist/index.css` → `theme.css` → `global.css`：
CSS 变量与选择器都是**后者胜**，顺序反了自定义主题会被 EP 默认值盖回去。

两个文件都是**原生 CSS**（后缀 `.css`，刻意没用任何 Sass 语法，注释也只用 `/* */`）：
Vite 直接处理，**不需要引入任何预处理器依赖**（`sass` / `sass-embedded` 只在文件后缀为
`.scss` 时才会被 Vite 要求安装）。换主题 / 加全局规则都只改这两个文件，业务代码零改动。

### 9.2 配色 / 尺寸 token（换主题只改 theme.css）

| 类别 | 变量 | 值 |
|---|---|---|
| 主色 | `--app-primary` / `--app-primary-light` / `--app-primary-dark` | `#1677FF` / `#E6F0FF` / `#0958D9` |
| 功能色 | `--app-success` / `--app-warning` / `--app-danger` / `--app-info` | `#52C41A` / `#FAAD14` / `#FF4D4F` / `#909399` |
| 页面底色 | `--app-bg-page` | `#F0F2F5` |
| 卡片底色 | `--app-bg-card` | `#FFFFFF` |
| 侧边栏 / 顶栏 | `--app-bg-sidebar` | `#001529` |
| 文字 | `--app-text-primary` / `-secondary` / `-sidebar` / `-sidebar-active` | `#1F2D3D` / `#606266` / `#BFCBD9` / `#FFFFFF` |
| 边框 | `--app-border` / `--app-border-light` | `#E4E7ED` / `#EBEEF5` |
| 圆角 | `--app-radius` / `--app-radius-small` | `4px` / `2px` |
| 间距 | `--app-space-xs` / `-sm` / `-md` / `-lg` | `4px` / `8px` / `16px` / `24px` |

- 主色与四个功能色都各自给了 `light-3/5/7/8/9`（主色另有 `dark-2`）派生色，并映射到 EP 的同名变量
  （`--el-color-primary-light-9` 等）。**只覆盖基色不覆盖派生色**，会出现「底是旧版 EP 色、边框是新色」的错配。
- EP 的 `error` 是 `danger` 的别名，两边都要给，否则表单校验文字还是旧红。
- EP 的 `--el-border-radius-base`、`--el-text-color-primary`、`--el-border-color-light`、`--el-card-*`、
  `--el-table-*` 也一起映射到了 token，所以组件里**原有的 `var(--el-xxx)` 写法不用改**，会跟着新主题走。
- 页面 / 组件里一律用 `var(--app-xxx)`，**不要写死十六进制色值，也不要写死圆角 px**。本次已把 `media__card` 的 8px、
  `timing__card` 的 6px、5 个弹窗里 `.playlist-form__panel` / `.task-form__col` / `.timing-config__segment` / `.timing-set__segment` / `.timing-form__col` 的 4px、以及 `media__subuser` 的 6px 全部统一成 `var(--app-radius)`。

### 9.3 版式（`src/layouts/AppLayout.vue`）

```
┌─────────────── 顶栏 56px（#001529）：品牌 / 面包屑 / 用户下拉 ───────────────┐
├── 侧边栏 220px（#001529，菜单）──────────┬── 内容区（#F0F2F5，页面自带 .app-page）──┤
```

- 顶栏是**通栏**的（不是「侧边栏顶部放品牌」）：左边图标 + 「网络音频服务器」16px 加粗白字，
  中间面包屑由 `route.meta.title` 生成（`首页 / 当前模块`），右边用户名 + 下拉菜单
  （下拉里是「退出登录」，仍然调用原来的 `handleLogout`，二次确认逻辑一点没动）。
- 侧边菜单 `el-menu`：`background-color="#001529"` / `text-color="#BFCBD9"` / `active-text-color="#FFFFFF"`，
  行高 44px；**选中项 = 主色半透明底 + 左侧 3px 蓝色竖条**（未选中时竖条透明占位，避免整行文字横向位移）。
- 菜单跳转仍由 `@select` 里的 `router.push` 负责 —— 效果等价于 `el-menu` 的 `router` 模式，
  所以**没有**再加 `router` 属性（两处都写会让同一次点击 push 两次）。

### 9.4 写新页面的三条硬规矩

1. 页面最外层 `<div>` 必须带 `app-page`（提供页面灰底 + 16px 内边距）。布局里的 `el-main` 因此
   `padding: 0`；**两处都写会叠成 32px**。现有 10 个页面（含登录页）都已加上这个类。
2. 表格 / 表单块用 `el-card` 包裹（沿用 `shadow="never"`，阴影与圆角已由全局样式统一）。
3. 菜单图标：`menus.js` 只存图标名（字符串），`AppLayout.vue` 的 `MENU_ICONS` 表解析成组件 ——
   图标必须**逐项显式 import**（不要 `import * as Icons`），否则整套 300+ 图标都会进产物。

### 9.5 全局组件微调一览（都在 `global.css`）

| 目标 | 规则 |
|---|---|
| 表格 | 表头 `#FAFAFA` / 文字 `#1F2D3D` / 字重 500；单元格 `padding: 10px 0`；行 hover `#F5F9FF` |
| 卡片 | `1px var(--app-border)` 边框、`box-shadow: none`、圆角 4px；卡片头 `12px 16px` |
| 按钮 / 输入框 | 圆角 4px、去掉默认阴影 |
| 滚动条 | 6px 宽；滑块 `#C0C4CC`、hover `#909399`（Firefox 用 `scrollbar-width: thin`） |
| 字体 | 系统 UI 字体 + 中文栈（苹方 / 微软雅黑） |

> `src/style.css` 已**删除**：它原来的全局最小重置全部搬进了 `src/styles/global.css`，
> 仓库里已经没有这个文件，也不再被任何地方 import。


  - **`PermitPlayer` / `PermitCapturer` 元素必须是 8 位十六进制设备 ID，不能是 `FFFFFFxx`（分组写法）、也不能是 `00000000`**：手册的判据是「不能 ≥ `FFFFFF00`」，在 8 位十六进制里等价于「不能是 `FFFFFFxx`」；表单对这类写法会单独提示（`isPermitGroupFormId`）。
  - **任一清单里不能包含该设备自身**（否则后端 400）：后端 DTO 只校验终端 / 采播器两类，前端 `validatePermitPayload` 三类都查（更严，但不会误伤）。
  - **三类清单都为空 = 清除**该设备的权限数据（手册定义的语义，**不是错误**）：后端只在字段为 null 时省略数组，前端**总是显式发三个数组**（要清空就发 `[]`），并在提交前弹二次确认。
  - **`GET /api/device-permits/{deviceId}` 的 `Result=1` 是业务语义**（该设备尚未设置权限数据，响应里没有三个数组）→ `stores/devicePermit.js` 在 `assertNasOk` **之前**单独放行并按「三类都空」处理；当成失败会误弹红条。
  - **服务器不校验这些 ID 是否存在**（填了不存在的 ID 也能保存，只会在设备真正下载清单时被过滤掉）：官方建议只填有效数据，所以候选项一律来自设备 / 分组列表；已选但不在列表里的 ID 只提示、**原样保留**（不静默删掉用户的数据）。
  - **`PermitCapturer` 的可选范围**：被动采播器 + 支持被动启动的主动采播器（手册 P19 明确其类型是 `1E` / `2E` / `4E` / `CE`）+ 对讲面板 / 对讲话筒（`2E` / `5E` / `6E`；其中 `5E` / `6E` 可能落在主动采播或主动插播列表里，两处都扫）。⚠️ 后端 `DeviceItemDto` **没有透出 `Passive` 字段**，所以前端是按手册给出的**类型表**做等价筛选，而不是读 `Passive = 1`（见 `constants/devicePermit.js` 的说明）。
  - **`PermitGroup` 建议只放 `Creater` 为 `00000000`~`00000008` 的分组**（管理软件或本后端创建）：`Creater` 更大的分组是分控软件的**私有分组**，手册建议不要给其它设备使用 → 候选项打「私有分组」标签（判定复用 `constants/group.js` 的 `isPrivateGroup`），但**不拦**保存。
  - **目录不需要手工添加 / 删除设备**：给某台设备设置权限数据即自动入册（没有单独的目录增删接口），所以「新增权限数据」的交互是「选一台设备 → 直接打开权限弹窗」。
  - **`Result` 码表**：设置接口在 `RESULT_TABLES` 里（`devicePermit`，逐条抄自手册 P16-18：2 含非法 ID / 3 缺 `DeviceID` / 5 该设备不需要权限数据 / 8 设备不存在；1 与 6 走通用码。⚠️ 手册的编号从 3 直接跳到 5，**没有 4**）；两个**查询**接口没有码表 → `nasList(res, 'permitCatalog', …)` 与 `'permitInfo'` 走通用码兜底（`RESULT_TABLES` 里故意不建空表）。
- **设备任务（`/device-tasks`）**：
  - **绑定在设备上、触发即执行**：由设备的按键 / 端口 / 触控按钮等触发源触发，**没有开始时间参数**（别拿临时任务的 `startMode` / 定时任务的 `weekDay` 来套）；配置前必须先把设备加入「设备任务目录」，一个设备最多 **128** 条（`TaskIndex` 1~128）。
  - **移出目录会同步删除该设备的全部设备任务**（重新加入不会恢复，任务也不会回到之前的内容）→ 二次确认里写明了这一点，且本地缓存一起作废。
  - **任务类型受设备类型限制**（手册 P79 的类型表，抄在 `constants/deviceTask.js` 的 `DEVICE_TASK_TYPE_TABLE`）：例如主动采播器（`2E` / `4E` / `7E`）**只支持采播**、对讲面板（`6E`）只支持采播 + 对讲、`5F` / `6F` / `9F` 才支持对讲任务；表单的单选项与校验都按这张表过滤，类型不支持时提示「它只支持：…」。
  - **4C / 3E 的文件来自报警媒体**：这两类设备（网络消防报警控制器 / 消防采播器）的文件任务候选取自 `media` store 的 `alarm` 列表，其余设备取自 `system`；⚠️ 两类的 `FileID` 取值范围重叠，所以候选与文件名补全都锁定了当前来源。
  - **`ActCapturer` 限定的设备采播源就是它自己**：`CapturerID` 可以**留空**（NAS 默认取设备自身），填了就必须等于设备 ID —— 前端对「非空且不等于自身」只给黄字提示（后端只对**对讲任务**做等式校验，直接拦住会让用户以为接口不认）；**对讲任务**（`taskType=3`）的等式校验是**硬拦**（后端 @AssertTrue，不一致直接 400）。
  - **对讲任务的 `PlayerList` 第一个是被叫方、只能有一个**：所以表单在对讲类型下把「播放目标」换成**单选**（`calleeId`），提交时也只取第一个；主叫方永远是设备自身（由 `CapturerID` 表达），页面上单独标注。
  - **`endMode` 只有 0 不指定 / 3 持续时长 / 4 时段触发**（**没有 1「指定绝对时刻」**）：`=4` 时 `EndTime` 的语义是「起始时分 + 时段小时数」（例 `08:20:03` = 08:20 开始、持续 3 小时），所以表单把它拆成两个输入框（`hh:mm` + 小时数）再拼回 `hh:mm:ss`；⚠️ **手册只说 `endMode=4` 是「特殊设备」专用、没有给出支持它的设备类型清单**（后端也没透出这类能力位）→ 前端把 `DEVICE_TYPES_END_MODE_4` 留成空清单（不硬拦），改用「我确认这台设备属于特殊设备」的勾选框兜住；一旦确证了类型清单，把类型码填进那个常量，UI 与校验会自动收紧。
  - **⚠️ DeviceTaskList 看不到「启用 / 禁用」**：手册的 `DeviceTaskList.Data[]` 字段表里**没有 `Disable`**（后端 `DeviceTaskItemDto` 也没有这个字段），所以列表里那一条**只能显示「NAS 未回传」**，不能凭 0/1 猜；要确保某条任务被停用就用行内的「禁用」（只发 `DeviceID + TaskIndex + Disable`）。
  - **⚠️ 设备任务没有「删除单条任务」的接口**：`POST /api/device-tasks` 只有启用 / 修改 / 禁用三种语义，**禁用是停用一条任务的唯一手段**（内容仍留在 NAS 上）；要彻底清掉只能把设备**移出目录**（会删掉该设备的全部任务）。页面在任务卡片上把这两点写成了常驻提示，避免被当成功能缺失。
  - **启用一条已禁用的任务是「整体设置」**：`DeviceTaskSet` 少发的字段等于清空，所以行内「启用」会把列表里的内容一起重发（`deviceTaskToPayload` 按类型还原字段：采播 / 对讲不带 `PlayMode`，`TaskType≠0` 时 NAS 也不回 `CapturerID`）。
  - **触发前 NAS 什么都不校验**：配置时不检查文件是否存在、终端是否在线，只有**触发执行时**才检索 —— 「保存成功」不等于「触发就一定出声」。
  - **`Result` 码表**：两个写接口在 `RESULT_TABLES` 里（`deviceTaskSet` 抄手册 P74-80、`deviceTaskCatalog` 抄手册 P69-70；1 与 6 走通用码。⚠️ 手册把「缺字段」与「取值不符」写在同一条里，提示文案两种可能都列出）；两个**查询**接口没有码表 → `nasList(res, 'deviceTaskCatalogList', …)` 与 `'deviceTaskList'` 走通用码兜底（`RESULT_TABLES` 里故意不建空表）。其中 **`GET /api/device-tasks/{deviceId}` 的 `Result=1` 是业务语义**（该设备没有配置设备任务，响应里连 `Data` 都没有）→ `stores/deviceTask.js` 在 `assertNasOk` 之前单独放行，并按空列表处理。
  - **`TaskPriority` vs `Priority` 别混**：设备任务里的 `Priority` 是 **0~15 的数值**（手册原话：与 `TaskExecList` 里 4 位十六进制的 `TaskPriority` 不是同一个东西）。
- **工程化缺口**：项目当前没有 ESLint / Prettier，也没有测试框架；验证方式是 `npm run build` + 连真机后端手工回归。

