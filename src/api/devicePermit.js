// src/api/devicePermit.js —— 设备权限（主动设备 / 软件的「本地播放目标」权限）模块接口
//
// 后端对应 DevicePermitController，契约见 ip-audio-speaker-backend/docs/API.md「设备权限模块」，
// 上游（NAS 手册）见同项目 docs/impl-notes.md §九（P14-18）。
//
//   GET  /api/device-permits/catalog      已设置权限数据的设备目录（每项 { DeviceID, DeviceType }）
//   GET  /api/device-permits/{deviceId}   某个主动设备的权限数据（⚠️ Result=1 表示「尚未设置」）
//   POST /api/device-permits              设置权限数据（⚠️ 三类清单都为空 = 清除）
//
// 这一层只负责「路径 + 参数」，不做任何判断：
//   · HTTP 层错误（含 deviceId 不是 8 位十六进制时后端直接 400）由 src/api/request.js 的拦截器抛出并弹全局提示；
//   · HTTP 200 但 `Result !== 0`（NAS 业务拒绝）由 store 用 assertNasOk 断言后抛 NasResultError。
//
// ⚠️ 大小写（README §五 1）：请求体按约定发小驼峰（deviceId / permitGroup / permitPlayer / permitCapturer），
//    响应是 NAS 风格大驼峰（DeviceID / PermitGroup / …）。后端开了大小写不敏感匹配，两种写法都能绑定。
//
// ⚠️ 这个模块的定位（手册 P18 原文）：HTTP API 用户本身可完整获取设备与分组信息，**无需**设置权限数据。
//    它的用处是「代替管理软件去配置分控软件 / 对讲话筒 / 手机 APP 这类设备」，不是本后台自身运行所必需。

import request from './request'

/**
 * 获取已设置权限数据的设备目录（只读，无参数）。
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<{DeviceID: string, DeviceType: string}>}>}
 *          `Data` 可能为空数组（一台设备都没配过）；`DeviceType` 是 2 位十六进制，
 *          需要权限数据的类型见 constants/devicePermit.js 的 `DEVICE_TYPES_NEED_PERMIT`。
 *          ⚠️ 手册没给这个查询接口的 Result 码表，未收录的码走通用码兜底
 */
export function getPermitCatalog() {
  return request.get('/device-permits/catalog')
}

/**
 * 获取某个主动设备的权限数据。
 *
 * @param {string} deviceId 8 位十六进制的设备 ID（格式非法后端直接 400）
 * @returns {Promise<{DataType: string, Result: number, DeviceID?: string, PermitGroup?: string[],
 *          PermitPlayer?: string[], PermitCapturer?: string[]}>}
 *          ⚠️ `Result === 1` 表示这台设备**尚未设置**权限数据 —— 此时响应里除了 `DataType`、`Result`
 *          没有任何其它字段（不是错误，页面要按「三类清单都空」处理，别当成失败）。
 *          手册没给这个查询接口的码表，未收录的码走通用码兜底
 */
export function getPermitInfo(deviceId) {
  return request.get(`/device-permits/${encodeURIComponent(deviceId)}`)
}

/**
 * 设置主动设备的权限数据。
 *
 * ⚠️ 三类清单**都为空 = 清除**该设备的权限数据（手册定义的语义，不是错误）。
 * 本模块总是把三个数组都带上（要清空就显式发 `[]`），语义最清楚；后端只在字段为 null 时才省略。
 *
 * @param {{deviceId: string, permitGroup: string[], permitPlayer: string[], permitCapturer: string[]}} payload
 *   · deviceId：8 位十六进制（要设置权限的主动设备 / 软件）；
 *   · permitGroup：元素必须是 `FFFFFFxx` 形式（分组 2 位 ID 扩展成 8 位）；
 *   · permitPlayer / permitCapturer：元素必须是 8 位十六进制设备 ID，且不能是 `FFFFFFxx` 或 `00000000`；
 *   · 每类最多 248 项；任一清单里都不能包含 `deviceId` 自己（否则后端 400）。
 * @returns {Promise<{DataType: string, Result: number}>} DataType = `DevicePermitSetAck`
 */
export function setPermit(payload) {
  return request.post('/device-permits', payload)
}
