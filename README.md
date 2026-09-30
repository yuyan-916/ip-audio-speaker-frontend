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

## 二、启动

前置条件：后端已在 `http://localhost:8080` 运行（本前端通过 Vite 代理访问 `/api`，不存在跨域问题）。

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/
npm run preview    # 预览构建产物
```

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
│  └─ timing.js         # /timing/**（定时任务增删改、定时程序信息 / 配置 / 清除复制剪切）
├─ constants/           # 枚举字典与纯函数（不含请求）
│  ├─ menus.js          # 侧边菜单表（路由驱动，index 就是路由 path）
│  ├─ device.js         # devClass / State / DeviceType 字典、音量格式化、GBK 字节校验
│  ├─ group.js          # 分组字典与纯函数（31 字符上限、GroupID 校验、FFFFFFxx 扩展、Creater 文案）
│  ├─ media.js          # 媒体类型字典与纯函数（255 字符文件名、100MB 上限 / 8MB 分块说明、上传超时估算、结果行分类）
│  ├─ playlist.js       # 播放列表字典与纯函数（31 字符上限、1024 文件上限、FFxx 引用扩展 / 识别、文件展开）
│  ├─ task.js           # 任务字典与纯函数（类型 / 状态 / 播放模式 / 命令字、TaskID 来源、TaskPriority 拆解、播放内容与目标的可读化）
│  └─ timing.js         # 定时任务字典与纯函数（WeekDay 位序、按星期 / 绝对时刻、1~24 当前执行程序、程序组合编码、静默与自动切换校验、段式覆盖 payload 组装）
├─ layouts/
│  └─ AppLayout.vue     # 登录后的整体布局（侧边菜单 + 顶部栏 + router-view）
├─ router/
│  └─ index.js          # 路由表 + 登录守卫（beforeEach）+ 标题（afterEach）
├─ stores/              # Pinia
│  ├─ user.js           # 登录态（token / username）
│  ├─ device.js         # 四类设备列表 + 设备写操作（成功后自动重拉对应列表）
│  ├─ group.js          # 分组列表 + 分组增删改（成功后自动重拉列表）
│  ├─ media.js          # 三类媒体列表 + 删除 / **单个文件**上传（多文件串行由弹窗负责）
│  ├─ playlist.js       # 播放列表 + 增删改（成功后自动重拉列表；fileList 始终完整提交）
│  ├─ task.js           # 运行中任务列表 + 提交 / 控制 / 停止全部 + 5 秒轮询开关、按设备查任务
│  └─ timing.js         # 定时程序信息 + 按程序缓存的任务列表 + 任务增删改 / 程序配置 / 清除复制剪切
├─ components/
│  ├─ devices/          # 模块内复用组件（三个弹窗：音量 / 改名 / 虚假设备）
│  ├─ groups/           # 分组弹窗（新建 / 编辑表单、成员查看）
│  ├─ media/            # 媒体弹窗（上传：队列 + 串行 + 逐项结果；删除：类型 + 原名确认）
│  └─ playlists/        # 播放列表弹窗（新建 / 编辑：候选 + 有序已选、上移 / 下移；只读查看内容）
│  ├─ tasks/            # 任务弹窗（提交临时任务：类型 0/1/7 + 播放内容 / 目标 / 结束时间；控制：停止 / 音量 / 暂停恢复 / 下一曲）
│  └─ timing/           # 定时任务弹窗（任务新建 / 编辑：按类型分支；程序配置：五段各自勾选；程序操作：清除 / 复制 / 剪切 + 二次确认）
├─ utils/
│  └─ nas-result.js     # HTTP 200 但 Result !== 0 的「NAS 业务拒绝」统一处理
├─ views/
│  ├─ LoginView.vue
│  ├─ PlaceholderView.vue   # 未实现模块的占位页（所有模块都已接入，当前没有路由引用它，保留作模板）
│  ├─ devices/DeviceListView.vue
│  ├─ groups/GroupListView.vue
│  ├─ media/MediaListView.vue
│  ├─ playlists/PlayListView.vue
│  ├─ tasks/TaskListView.vue
│  └─ timing/TimingListView.vue
├─ App.vue
├─ main.js
└─ style.css            # 全局最小重置；组件样式一律写在各自的 <style scoped> 里
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
6. 模块没做完之前，先在 `router/index.js` 里指向 `PlaceholderView`，让菜单点了有落点。

## 六、新增一个模块页面的 checklist

1. `src/api/xxx.js`：每个接口一个函数，注释里写清路径、请求体字段、响应形状。
2. 有枚举/字典就在 `src/constants/xxx.js` 里加上（别把魔法数字散在页面里），并把该接口的 `Result` 码表补进 `src/utils/nas-result.js`。
3. 需要跨页面复用的数据放到 `src/stores/xxx.js`（如设备列表，任务模块也要用）。
4. `src/views/xxx/XxxView.vue`（+ 必要的弹窗组件放 `src/components/xxx/`）。
5. 在 `src/router/index.js` 里把对应 child 的 `component` 换成真实页面（懒加载）。
6. 新模块需要在菜单出现时，改 `src/constants/menus.js`。
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

**待实现**（后端接口都已就绪，页面按 `docs/API.md` 逐个接入）

设备任务、设备权限、任务优先级。

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
- **工程化缺口**：项目当前没有 ESLint / Prettier，也没有测试框架；验证方式是 `npm run build` + 连真机后端手工回归。

