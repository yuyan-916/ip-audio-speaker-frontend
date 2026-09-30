// src/api/deviceTask.js —— 设备任务模块接口
//
// 后端对应 DeviceTaskController，契约见 ip-audio-speaker-backend/docs/API.md「设备任务模块」，
// 上游（NAS 手册）见同项目 docs/impl-notes.md §六（P68-80）。
//
//   GET  /api/device-tasks/catalog       已配置设备任务的设备目录（每项 { DeviceID, DeviceType }）
//   POST /api/device-tasks/catalog       设备加入 / 移出目录（⚠️ 移出会同步删除该设备的全部任务）
//   GET  /api/device-tasks/{deviceId}    某个设备的全部设备任务（⚠️ Result=1 = 该设备没有配置任务）
//   POST /api/device-tasks               启用 / 修改 / 禁用一条设备任务（DeviceID + TaskIndex 定位）
//
// 这一层只负责「路径 + 参数」，不做任何判断：
//   · HTTP 层错误（含 deviceId 不是 8 位十六进制时后端直接 400）由 src/api/request.js 的拦截器抛出并弹全局提示；
//   · HTTP 200 但 `Result !== 0`（NAS 业务拒绝）由 store 用 assertNasOk 断言后抛 NasResultError。
//
// ⚠️ 设备任务与「任务管理（/tasks）」「定时任务（/timing）」都不是一套东西（手册 P68 原话）：
//    它**绑定在具体设备上**，由设备的按键 / 端口 / 触控按钮等触发源触发后**即时执行** ——
//    没有任何开始时间参数，配置前还必须先把设备加入「设备任务目录」。
//
// ⚠️ 大小写（README §五 1）：请求体按约定发小驼峰（deviceId / action / taskIndex / disable / fileList …），
//    响应是 NAS 风格大驼峰（DeviceID / TaskIndex / Disable / CapturerID …）。后端开了大小写不敏感匹配。

import request from './request'

/**
 * 获取已配置设备任务的设备目录（只读，无参数）。
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<{DeviceID: string, DeviceType: string}>}>}
 *          `Data` 可能为空数组（一台设备都没配过）；`DeviceType` 是 2 位十六进制，
 *          哪些类型支持设备任务见 constants/deviceTask.js 的 `DEVICE_TYPES_SUPPORT_TASK`。
 *          ⚠️ 手册没给这个查询接口的 Result 码表，未收录的码走通用码兜底
 */
export function getDeviceTaskCatalog() {
  return request.get('/device-tasks/catalog')
}

/**
 * 把设备加入 / 移出设备任务目录 —— POST /api/device-tasks/catalog
 *
 * ⚠️ `REMOVE` 会**同步删除该设备的全部设备任务**（重新添加不会恢复，任务也不会回到之前的内容），
 *    页面必须二次确认。
 * ⚠️ 设备类型不需要配置设备任务时 NAS 会拒（Result=3）—— 候选设备先按类型表筛再让用户选。
 *
 * @param {{action: 'ADD'|'REMOVE', deviceId: string}} payload
 *   · action    必填，ADD 加入目录 / REMOVE 从目录删除；
 *   · deviceId  必填，8 位十六进制设备 ID。
 * @returns {Promise<{DataType: string, Result: number, DeviceID?: string, DeviceType?: string}>}
 *          DataType：ADD → `DeviceTaskConfigAddAck`、REMOVE → `DeviceTaskConfigDelAck`（未识别时 `DeviceTaskConfigAck`）；
 *          **ADD 时反馈设备类型（DeviceType），REMOVE 时没有该字段**；
 *          码表见 utils/nas-result.js 的 `deviceTaskCatalog`。
 */
export function configDeviceTaskCatalog({ action, deviceId }) {
  return request.post('/device-tasks/catalog', { action, deviceId })
}

/** 把设备加入设备任务目录（`configDeviceTaskCatalog` 的便捷封装） */
export function addDeviceToTaskCatalog(deviceId) {
  return configDeviceTaskCatalog({ action: 'ADD', deviceId })
}

/** 把设备移出设备任务目录（⚠️ 会同步删除它的全部设备任务） */
export function removeDeviceFromTaskCatalog(deviceId) {
  return configDeviceTaskCatalog({ action: 'REMOVE', deviceId })
}

/**
 * 获取某个设备的全部设备任务 —— GET /api/device-tasks/{deviceId}
 *
 * @param {string} deviceId 8 位十六进制的设备 ID（格式非法后端直接 400）
 * @returns {Promise<{DataType: string, Result: number, DeviceID?: string, Data?: Array<object>}>}
 *          `Data` 元素字段（NAS 原始大驼峰，见后端 DeviceTaskItemDto）：
 *          TaskIndex（1~128，一般与设备的按键 / 端口 / 触控按钮序号对应）/ TaskName / Priority（**0~15 数值**，
 *          与运行端 4 位十六进制的 `TaskPriority` 不是同一个东西）/ AutoPause / AutoStop / TaskType（0/1/3/7）/
 *          EndMode（**0 / 3 / 4，没有 1**）/ EndTime / PlayMode / LoopTimes / TaskVolume /
 *          CapturerID（仅采播、对讲任务）/ VoiceText（仅文字语音）/ FileList（4 位文件 ID）/ PlayerList（8 位终端 ID）。
 *          ⚠️ `Result === 1` 表示**该设备没有配置设备任务**：此时除 `DataType` / `Result` 外字段全部缺席
 *          （不是错误，按空列表处理；store 里已单独放行）。
 *          ⚠️ 手册只列出**已创建**任务的索引号对象：`EndMode=0` 时不含 `EndTime`，`TaskType≠0` 时不含 `CapturerID`。
 */
export function getDeviceTasks(deviceId) {
  return request.get(`/device-tasks/${encodeURIComponent(deviceId)}`)
}

/**
 * 启用 / 修改 / 禁用一条设备任务 —— POST /api/device-tasks
 *
 * ⚠️ 每次只操作**一个**任务（`deviceId` + `taskIndex` 定位）；`disable=1` 时**只需这三个字段**
 *    （后端在禁用时只往 NAS 发 DataType + DeviceID + TaskIndex + Disable，任务内容保留在 NAS 上）。
 *    ⚠️ 但「启用一条已禁用的任务」是**整体设置**：必须把任务内容一起发回来
 *    （用 constants/deviceTask.js 的 `deviceTaskToPayload` 从列表行回写，否则 NAS 侧内容会变空）。
 * ⚠️ 这里的 `capturerId` 与临时任务不同：对讲任务**可以省略**（NAS 默认取设备自身），
 *    但**若提供就必须等于 `deviceId`**（后端 @AssertTrue，400 直接拒）。
 * ⚠️ `endMode` 只有 0 不指定 / 3 持续时长 / 4 时段触发（**仅特殊设备**，见 constants/deviceTask.js）；
 *    `endTime` 在 `endMode=3/4` 时必填，格式 `hh:mm:ss` —— `=3` 时是**持续时长**，`=4` 时是**起始时分 + 时段小时数**。
 *
 * @param {object} payload 请求体（小驼峰）
 *   · deviceId   必填，8 位十六进制（设备必须已在目录中，否则 Result=8）
 *   · taskIndex  必填，1~128
 *   · disable    必填，0 启用（需带任务内容）/ 1 禁用（无需任务内容）
 *   · taskType   启用时必填：0 文件播放 / 1 采播 / 3 对讲 / 7 文字语音（必须是该设备类型支持的类型）
 *   · playerList 启用时必填，≤248 项，元素 8 位十六进制（**对讲任务的第一个是被叫方**）
 *   · fileList   文件任务必填，≤180 项，元素 4 位十六进制（消防类设备的文件来自**报警**媒体列表）
 *   · voiceText  文字语音任务必填，转义后 ≤358 字节
 *   · capturerId 采播任务需要（8 位十六进制）；对讲任务可省略，提供时必须等于 deviceId
 *   · taskName / priority / autoPause / autoStop / endMode / endTime / playMode / loopTimes / taskVolume
 *     均为可选（取值范围见手册 P74-80 的字段表：31 GBK 字节 / 0~15 / 0~1 / 0~1 / 0、3、4 / hh:mm:ss / 0~4 / 0~31 / 0~127）
 * @returns {Promise<{DataType: string, Result: number}>} DataType = `DeviceTaskSetAck`；码表见 utils/nas-result.js 的 `deviceTaskSet`
 */
export function setDeviceTask(payload) {
  return request.post('/device-tasks', payload)
}
