// src/api/device.js —— 设备模块接口
//
// 响应统一是 NAS 风格：{ DataType, Result, Data }（HTTP 状态码是 200）。
// **Result === 0 才算成功**，Result !== 0 表示 NAS 业务拒绝，由页面自行判断并提示。

import request from './request'

/**
 * 获取播放终端列表 —— GET /api/devices/player
 * @returns {Promise<{DataType: string, Result: number, Data: Array<{DeviceID: string, DevName: string, IP: string, Port: number, MAC: string, State: number, Volume: number, DeviceType: string}>}>}
 *   State：0 = 在线；Volume：0 = 最大音量、127 = 静音
 */
export function getPlayerDevices() {
  return request.get('/devices/player')
}

/** 获取被动采播设备列表 —— GET /api/devices/capturer */
export function getCapturerDevices() {
  return request.get('/devices/capturer')
}

/** 获取主动采播设备列表 —— GET /api/devices/act-capturer */
export function getActCapturerDevices() {
  return request.get('/devices/act-capturer')
}

/** 获取主动插播设备列表 —— GET /api/devices/act-requester */
export function getActRequesterDevices() {
  return request.get('/devices/act-requester')
}

/**
 * 设置终端基础音量 —— POST /api/devices/volume
 * @param {{deviceId: string, volume: number}} payload
 *   deviceId：8 位十六进制；volume：0 ~ 127（0 = 最大音量 / 0dB，数字越大声音越小，127 = 静音）
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function setDeviceVolume(payload) {
  return request.post('/devices/volume', payload)
}

/**
 * 删除离线设备 —— POST /api/devices/delete
 * @param {{deviceId: string, devClass: number}} payload
 *   devClass：0 播放终端、1 被动采播器、3 主动采播设备、4 主动插播设备（**没有 2**，传 2 会 400）
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function deleteDevices(payload) {
  return request.post('/devices/delete', payload)
}

/**
 * 修改在线设备名称 —— POST /api/devices/reconfig
 * @param {{deviceId: string, devName: string, devClass: number}} payload
 *   devName：转义前 ≤31 字节（GBK 内码，中文/全角按 2 字节计）；
 *   当前版本 NAS 仅支持修改播放终端的名称，且改动约 10 秒后在设备列表中生效
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function reconfigDevice(payload) {
  return request.post('/devices/reconfig', payload)
}

/**
 * 添加虚假设备 —— POST /api/devices/dummy
 * ⚠️ 仅供「凑数」：真实设备会自动上线，这里加的只是占位记录（无 IP、状态为「历史」、入任务无效）。
 * @param {{deviceId: string, devName?: string, devClass?: number}} payload
 *   devClass 缺省 0（播放终端）；deviceId 必须当前不存在
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function addDummyDevice(payload) {
  return request.post('/devices/dummy', payload)
}
