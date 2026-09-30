// src/api/task.js —— 任务管理模块接口
//
// 后端对应 TaskController（docs/API.md「任务管理模块」），NAS 侧路径与手册页码见后端
// docs/impl-notes.md §三「任务运行管理」（P52-68）：
//   GET  /api/tasks/running                  正在运行的任务列表（NAS TaskExecList，P53-58）
//   GET  /api/tasks/with-device/{deviceId}   指定设备参与的任务（NAS TaskExecWithDevice，P58-60）
//   POST /api/tasks/submit                   提交临时任务（NAS TaskRequest/TempTask，P60-65）
//   POST /api/tasks/control                  任务控制（NAS TaskExec/Control，P66-68）
//   POST /api/tasks/stop-all                 停止所有正在运行的任务（命令字 6 的独立接口）
//
// 响应仍是 NAS 风格：{ DataType, Result, Data }（HTTP 状态码 200）。
// **Result === 0 才算成功**；Result !== 0 由 store 用 assertNasOk 抛出，页面提示（本层不做判断）。
//
// ⚠️ 字段大小写：**请求体小驼峰、响应大驼峰**（README §五 1）。发出去的是 taskType / fileList /
//    playerList / taskCmd …，拿回来的是 TaskID / TaskSN / TaskState …（后端开了大小写不敏感匹配，
//    这里按约定各写各的，不要混）。

import request from './request'

/**
 * 获取正在运行的任务列表 —— GET /api/tasks/running
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<object>}>}
 *   Data 元素字段（NAS 原始大驼峰，节选；完整字段表见后端 docs/impl-notes.md §三 1）：
 *   · TaskID / TaskSN   —— 任务唯一标识（HTTP API 提交的是 00000001~00000008，管理软件 / 定时任务是
 *                           00000000）；后续停止 / 调音量 / 暂停都要成对回传，且 TaskSN 不能为 00000000；
 *   · TaskName / TaskType（0 文件 / 1 采播 / 3 对讲 / 7 文字语音）；
 *   · TaskClass / TaskPriority（4 位十六进制：任务类主优先级 + 申请等级 + 顺序号）；
 *   · TaskState（⚠️ 手册语义自相矛盾，见 constants/task.js）、TaskVolume / PlayMode / LoopTimes；
 *   · PlayProgress / CurrentFileID / CurrentFileSN / TotalFileNum（当前**文件**的进度与序号，
 *     不是整个任务的进度）；
 *   · AlivePlayerNum / TotalPlayerNum（活动终端数 / 计划终端总数，被更高优先级任务抢占的终端处于挂起）。
 *   ⚠️ 列表为空是正常情况：`Data` 可能缺失或为 `[]`（页面要显示「当前没有正在运行的任务」）。
 */
export function getRunningTasks() {
  return request.get('/tasks/running')
}

/**
 * 获取指定设备参与的任务 —— GET /api/tasks/with-device/{deviceId}
 *
 * 匹配顺序（手册 P58-60）：`TheDeviceID` = `PlayerID`（该设备正在播此任务）→ = `CapturerID`
 * （采播器 / 对讲机之一）→ = `TaskID`（该设备提交的任务）；后两种情形下若有多个任务只返回第一个。
 *
 * @param {string} deviceId **8 位十六进制**设备 ID（格式非法后端直接 400）
 * @returns {Promise<{DataType: string, Result: number, TaskID?: string, TaskSN?: string, TaskName?: string,
 *   TaskType?: number, TaskClass?: number, TaskState?: number, CurrentFileID?: string,
 *   PlayProgress?: number, FileName?: string, CapturerID?: string, PlayerID?: string}>}
 *   ⚠️ 响应是**单个对象**（不是数组），而且**查不到相关任务时除 `DataType` / `Result` 外字段全部缺席**
 *      → 页面必须先判空（constants/task.js 的 hasTaskWithDevice）。
 */
export function getTaskWithDevice(deviceId) {
  return request.get(`/tasks/with-device/${encodeURIComponent(deviceId)}`)
}

/**
 * 提交临时播放任务 —— POST /api/tasks/submit
 *
 * ⚠️ `taskType` **只支持 0 文件播放 / 1 采播 / 7 文字语音**：手册 P62 的类型表里没有对讲任务 3
 *    （后端也用 @AllowedValues({0,1,7}) 挡了一道），表单里不要给出对讲选项。
 * ⚠️ `playerList` 必填（终端 ID 8 位，或 `FFFFFFxx` 分组引用，≤248 项）；内容字段按类型二选一：
 *    0 → `fileList`（4 位文件 ID 或 `FFxx` 播放列表引用，≤180 项）；1 → `capturerId`；7 → `voiceText`。
 * ⚠️ 采播任务**不应该**带 `playMode` / `loopTimes`（后端 @AssertTrue 会拒）。
 *
 * @param {object} payload 请求体（小驼峰，字段全可选与否见手册 P63-64）
 *   · taskName   任务名（转义前 ≤31 字节，缺省 NAS 命名为 HTTP API Requested Task）
 *   · taskType   0 / 1 / 7（必填）
 *   · priority   优先等级 0~15，越大越高，缺省 0；**仅在同一任务类内起作用**（不是最终优先级）
 *   · autoPause / autoStop  0 否（缺省）/ 1 是
 *   · startMode  1 指定绝对时刻 / 2 即时开始（缺省）/ 3 等待指定时长（提交端不支持 0）
 *   · startDate / startTime  格式 `YY-MM-DD` / `hh:mm:ss`（startMode=1 / 3 时条件必填）
 *   · endMode    0 不指定（缺省）/ 1 指定绝对时刻 / 3 持续指定时长
 *   · endDate / endTime      同上（endMode=1 给日期+时刻；=3 只给时刻，含义是**时长**）
 *   · playMode   0~4 缺省 2；loopTimes 0 不限 / 1~31 缺省 0；taskVolume 0~127 缺省 0（0dB）
 *   · capturerId / voiceText / fileList / playerList
 * @returns {Promise<{DataType: string, Result: number, TaskID?: string, TaskSN?: string}>}
 *   DataType 为 TempTaskAck；**Result 非 0 时不返回 TaskID / TaskSN**（码表见 utils/nas-result.js 的 taskSubmit）
 */
export function submitTask(payload) {
  return request.post('/tasks/submit', payload)
}

/**
 * 任务控制 —— POST /api/tasks/control
 *
 * 命令字（手册 P66-68）：1 停止指定任务、2 停止所有 TaskID 匹配的任务、6 停止全部、7 设音量、9 进度控制。
 * ⚠️ 命令字 1 / 7 / 9 必须**同时**给 `taskId` 与 `taskSn`，且 **`taskSn` 不能是 `00000000`**（为 0 时命令无效）；
 *    命令字 2 只需 `taskId`。停止全部有独立接口（stopAllTasks），不要在这里发命令字 6。
 *
 * @param {object} payload
 *   · taskCmd     1 / 2 / 6 / 7 / 9（必填）
 *   · taskId      8 位十六进制
 *   · taskSn      8 位十六进制，不可为 00000000
 *   · taskCmdPara 命令字 7 时是新音量（0~127）；命令字 9 时是动作
 *                 （0 无动作 / 1 暂停恢复 / 2 上一曲 / 3 下一曲 / 4 修改播放模式）
 *   · taskCmdPara1 / taskCmdPara2  仅命令字 9 且动作为 4 时使用（新播放模式 / 新循环次数）
 * @returns {Promise<{DataType: string, Result: number}>}
 *   DataType 为 TaskExecCtrlAck；码表见 utils/nas-result.js 的 taskControl（8 = 被拒绝，如指定任务不存在）
 */
export function controlTask(payload) {
  return request.post('/tasks/control', payload)
}

/**
 * 停止所有正在运行的任务 —— POST /api/tasks/stop-all
 *
 * ⚠️ 无参数（后端固定发命令字 6 + 占位 TaskID/TaskSN），**会停掉系统上所有正在运行的任务，
 *    包括管理软件、定时任务、其它用户提交的** → 页面上必须二次确认。
 *
 * @returns {Promise<{DataType: string, Result: number}>} TaskExecCtrlAck
 */
export function stopAllTasks() {
  return request.post('/tasks/stop-all')
}
