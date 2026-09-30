// src/api/timing.js —— 定时任务 / 定时程序模块接口
//
// 后端对应 TimingController，契约见 ip-audio-speaker-backend/docs/API.md「定时任务模块」，
// 上游（NAS 手册）字段与枚举见同项目 docs/impl-notes.md §四（定时任务，P34-44）/ §五（定时程序，P44-52）。
//
//   GET  /api/timing/tasks/{programIndex}   某个程序内的全部定时任务（NAS TimingTaskList，P34-36）
//   POST /api/timing/tasks/new              新建定时任务（NAS TimingTaskSet / DataType=TimingTaskNew）
//   POST /api/timing/tasks/edit             编辑定时任务（DataType=TimingTaskEdit，**必须带 taskIndex**）
//   POST /api/timing/tasks/delete           删除定时任务（DataType=TimingTaskDelete，**必须带 taskName**）
//   GET  /api/timing/program                定时程序信息（ProgramName / ProgramComb / CurrentProgram / SilenceTime / AutoProgram）
//   POST /api/timing/program/config         配置定时程序参数（⚠️ **段式覆盖**：包含哪个段就整体重置哪个段）
//   POST /api/timing/program/set            定时程序操作：CLEAR 清除 / COPY 复制 / CUT 剪切（复制、剪切会覆盖目标程序）
//
// 这一层只负责「路径 + 参数」，不做任何判断：
//   · HTTP 层错误由 src/api/request.js 的拦截器抛 Error 并弹全局提示；
//   · HTTP 200 但 `Result !== 0`（NAS 业务拒绝）由 store 用 assertNasOk 断言后抛 NasResultError。
//
// ⚠️ 大小写约定（README §五 1）：**请求体小驼峰、响应大驼峰**。
//    发出去的是 programIndex / taskType / weekDay / preOnAmp / fileList，
//    拿回来的是 TaskIndex / TaskType / WeekDay / **PreOnAMP** / **CapturerID** / FileList。
// ⚠️ 与「任务管理（/tasks）」的临时任务不是一套东西：这里没有 priority / autoPause / autoStop，
//    多出 disable / preOnAmp / weekDay，且 taskType 只有 0 文件播放 / 1 采播 / 7 文字语音（没有对讲 3）。

import request from './request'

/**
 * 取某个定时程序内的全部定时任务。
 *
 * @param {number} programIndex 定时程序序号 1~16（越界后端返回 400）
 * @returns {Promise<{DataType: string, Result: number, ProgramIndex: number, Data: Array<object>}>}
 *          `Data` 元素字段：TaskIndex / Disable / TaskName / TaskType / StartMode / EndMode /
 *          StartDate / StartTime / EndDate / EndTime / WeekDay / PreOnAMP / PlayMode / LoopTimes /
 *          TaskVolume / CapturerID / VoiceText / FileList / PlayerList
 */
export function getTimingTasks(programIndex) {
  return request.get(`/timing/tasks/${encodeURIComponent(programIndex)}`)
}

/**
 * 新建定时任务（**taskIndex 由 NAS 分配，不能传**；taskName 缺省为 `New Timing Task`）。
 *
 * 请求体（小驼峰，必填项见 API.md 的字段表）：
 *   programIndex ✔ 1~16；taskType ✔ 0/1/7；startTime ✔ hh:mm:ss；
 *   startMode 0 按星期循环（需 weekDay）/ 1 指定绝对时刻（需 startDate）；
 *   endMode=1 需 endTime（绝对时刻开始时还需 endDate）；
 *   fileList（文件任务必填，≤180，元素 4 位 hex 或 FFxx 播放列表）/ capturerId（采播必填，8 位 hex）/
 *   voiceText（文字语音必填，≤358 GBK 字节）；playerList ✔ ≤248（元素 8 位 hex 或 FFFFFFxx 分组）；
 *   disable 0 使能 / 1 禁用；preOnAmp 0~15；playMode 0~4 / loopTimes 0~31 / taskVolume 0~127（仅文件与文字语音）。
 *
 * @returns {Promise<{DataType: string, Result: number, ProgramIndex: number, TaskIndex: number}>}
 *          `TaskIndex` 是 NAS 新分配的序号，必须回显给用户（后续编辑 / 删除全靠它）
 */
export function newTimingTask(payload) {
  return request.post('/timing/tasks/new', payload)
}

/**
 * 编辑定时任务：请求体与新建**完全相同**，另加 `taskIndex`（1~248）。
 * `taskName` 缺省表示保持原名（要改名就一起传）。
 */
export function editTimingTask(payload) {
  return request.post('/timing/tasks/edit', payload)
}

/**
 * 删除定时任务：只需要 `programIndex` + `taskIndex` + `taskName` 三个字段
 * （`taskName` 用于确认目标，必须与列表里的原名完全一致，**任务内容字段一律不用传**）。
 */
export function deleteTimingTask(payload) {
  return request.post('/timing/tasks/delete', payload)
}

/**
 * 取定时程序信息（只读，无参数）。
 *
 * @returns {Promise<object>} `ProgramName`（固定 16 个名称）、`ProgramComb`（固定 4 个 16 位 0/1 串）、
 *          `CurrentProgram`（1~24）、`SilenceTime`（未设置时是空对象 `{}`）、
 *          `AutoProgram`（只含有效设置，最多 7 条）
 */
export function getTimingProgram() {
  return request.get('/timing/program')
}

/**
 * 配置定时程序参数（⚠️ **段式覆盖**）。
 *
 * 请求体里**只放要写的段**，每段都是整体重置：
 *   · `programName`：一旦出现必须给满 16 个（≤39 字符）；
 *   · `programComb`：一旦出现必须给满 4 个（每个 16 位 0/1）；
 *   · `currentProgram`：1~24（17~19 固定组合 / 20 无程序 / 21~24 自定义组合）；
 *   · `silenceTime`：空对象 `{}` = 清除静默时段；要设置则四个时间字段必须齐全；
 *   · `autoProgram`：出现即重置全部 7 条，`[]` = 清除全部自动切换设置。
 * 后端额外要求至少包含一个段（空请求 → 400），所以 store 侧不允许发空对象。
 *
 * @returns {Promise<{DataType: string, Result: number}>} DataType = `TimingProgramConfigAck`
 */
export function configTimingProgram(payload) {
  return request.post('/timing/program/config', payload)
}

/**
 * 定时程序操作：清除 / 复制 / 剪切。
 *
 * `action` 为 `CLEAR`（删除该程序内所有定时任务）/ `COPY`（复制到目标程序）/ `CUT`（剪切到目标程序）；
 * 复制与剪切**会覆盖目标程序的原有内容**，且只影响任务、不改程序名等参数。
 *
 * @param {{action: string, programIndex: number, programIndex1?: number}} payload
 *        `programIndex` 1~16（清除时即目标程序）；`programIndex1` 复制/剪切必填且不能与源相同
 * @returns {Promise<{DataType: string, Result: number}>} DataType = `TimingProgramSetAck`
 */
export function setTimingProgram(payload) {
  return request.post('/timing/program/set', payload)
}
