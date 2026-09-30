// src/constants/device.js —— 设备模块的枚举字典与格式化工具
//
// 取值来源：后端 docs/impl-notes.md §十二（NAS 手册 P7-14）。
// 响应里的字段名是 NAS 风格大驼峰（DeviceID / DevName / IP / Port / MAC / State / Volume / DeviceType）。

/** 设备类别（devClass）：⚠️ 手册里**没有 2**，传 2 会被后端 400 拒绝 */
export const DEV_CLASS = {
  PLAYER: 0,
  CAPTURER: 1,
  ACT_CAPTURER: 3,
  ACT_REQUESTER: 4
}

export const DEV_CLASS_NAMES = {
  0: '播放终端',
  1: '被动采播器',
  3: '主动采播设备',
  4: '主动插播设备'
}

/**
 * 页面页签与取数函数的对应关系。
 * key：页签标识（同时用于 store.lists / store.loading 的键、以及 URL 查询参数 ?class=）
 * dataType：NAS 响应体里的 DataType，用于排障时确认拿到的确实是这一类设备的列表
 */
export const DEVICE_CLASSES = [
  { key: 'player', devClass: DEV_CLASS.PLAYER, label: '播放终端', dataType: 'DeviceInfo_Player',
    hint: '真实音箱 / 音柱 / 解码器。删除只对离线、历史设备生效；改名的改动约 10 秒后才会在列表里刷新。' },
  { key: 'capturer', devClass: DEV_CLASS.CAPTURER, label: '被动采播器', dataType: 'DeviceInfo_Capturer',
    hint: '被服务器点名后开始采集的设备，本身不主动发起采播。' },
  { key: 'actCapturer', devClass: DEV_CLASS.ACT_CAPTURER, label: '主动采播设备', dataType: 'DeviceInfo_ActCapturer',
    hint: '自带触发键 / 触屏的采播设备（寻呼话筒等），可主动发起采播任务。' },
  { key: 'actRequester', devClass: DEV_CLASS.ACT_REQUESTER, label: '主动插播设备', dataType: 'DeviceInfo_ActRequester',
    hint: '消防报警控制器、无线电遥控接收机、分控软件等只能发起插播请求的设备。' }
]

/** 设备状态（State）：0 在线 / 1 注册中 / 2 故障 / 3 离线 / 4 历史 / 5 工作中 */
export const DEVICE_STATES = {
  0: { text: '在线', tag: 'success' },
  1: { text: '注册中', tag: 'primary' },
  2: { text: '故障', tag: 'danger' },
  3: { text: '离线', tag: 'info' },
  4: { text: '历史', tag: 'info' },
  5: { text: '工作中', tag: 'warning' }
}

/** 取状态展示信息（未知状态不隐藏，原值显示出来便于排障） */
export function getDeviceState(state) {
  return DEVICE_STATES[Number(state)] || { text: `未知（${state}）`, tag: 'info' }
}

/** 只有「离线 / 历史」设备能被删除（NAS 拒绝删除在线设备，返回 Result=8） */
export function isDeletable(state) {
  const value = Number(state)
  return value === 3 || value === 4
}

/**
 * 设备类型（DeviceType，2 位十六进制）→ 中文名。
 * 表来源：docs/impl-notes.md §十二「DeviceType 取值表（P8-9）」。
 * 手册里同一行涵盖多个编码（如 01/11/21/31 都是终端音箱/音柱、解码器），这里按编码逐条展开。
 */
export const DEVICE_TYPE_NAMES = {
  '01': '终端音箱/音柱、解码器',
  '11': '终端音箱/音柱、解码器',
  '21': '终端音箱/音柱、解码器',
  '31': '终端音箱/音柱、解码器',
  '41': '4G 终端',
  '51': '4G 终端',
  '2D': '触屏功放',
  '55': '带 SD 卡的本地备份终端',
  '61': '双解码终端',
  '71': '双解码终端',
  '02': '被动采播器',
  '12': '被动采播器',
  '22': '被动采播器',
  // ⚠️ 手册三处对 5E 的叫法不一致（寻呼话筒 / 对讲话筒 / 对讲面板）；功能上都对应任务类 2，以任务类为准
  '1E': '寻呼话筒',
  '5E': '寻呼（对讲）话筒',
  '2E': '主动采播器（触屏）',
  '4E': '主动采播器（按键）',
  '7E': '主动采播器（电平触发）',
  '6E': '对讲面板',
  '3E': '消防采播器',
  '4C': '网络消防报警控制器',
  '5C': '无线电遥控接收器',
  '5D': '无线电遥控功放',
  '7C': '触屏点播器',
  '6C': '红外遥控接收器',
  '6D': '红外遥控点播终端',
  '7D': '主动终端（按键触发）',
  '8D': '主动终端',
  '9D': '主动终端（电平触发）',
  '5F': '网络对讲话筒终端',
  '6F': '网络对讲话筒终端',
  '9F': '网络对讲话筒终端',
  DC: '第三方控制器 / 网关',
  E8: '分控软件',
  EE: '分控软件',
  D8: '中间件 / 第三方软件',
  DE: '中间件 / 第三方软件',
  CE: '声卡采集软件',
  DA: '手机 APP',
  C8: '手机 APP'
}

/** 取设备类型中文名（未知编码时返回空串，由页面决定怎么兜底） */
export function getDeviceTypeName(deviceType) {
  const code = String(deviceType == null ? '' : deviceType).trim().toUpperCase()
  return DEVICE_TYPE_NAMES[code] || ''
}

/** 设备名称（GBK 内码）的字节上限，对应后端 DeviceReconfigRequestDto.devName 的 @GbkByteLength(max = 31) */
export const DEV_NAME_MAX_BYTES = 31

/**
 * 按 GBK 内码估算字节数：码点 ≤ 0x7F 记 1 字节，其余（中文 / 全角 / 大部分符号）记 2 字节。
 * 后端 `validation/GbkByteLengthValidator` 是 `text.getBytes("GBK").length`（GBK 表示不了的字符
 * 会退化成 1 字节占位符），本函数对 BMP 汉字与 ASCII 的结果与之相同，个别 GBK 单字节符号会差 1 字节——
 * 这里只用于**输入时的即时提示与提前拦截**，最终仍以后端校验为准。
 */
export function gbkByteLength(text) {
  let bytes = 0
  for (const char of String(text == null ? '' : text)) {
    bytes += char.codePointAt(0) <= 0x7f ? 1 : 2
  }
  return bytes
}

/**
 * 音量（Volume）格式化：**0 = 0dB（最大）、数值越大越小声、127 = 静音**（反直觉，必须显式说明）。
 * 手册示例：3 表示 -3dB，即该数值就是衰减量。
 */
export function formatVolume(volume) {
  const value = Number(volume)
  if (volume === null || volume === undefined || volume === '' || Number.isNaN(value)) return '-'
  if (value === 0) return '0（最大 / 0dB）'
  if (value >= 127) return '127（静音）'
  return `${value}（-${value}dB）`
}

/** 8 位十六进制设备 ID 的正则（与后端 DTO 的 @Pattern 一致） */
export const DEVICE_ID_PATTERN = /^[0-9A-Fa-f]{8}$/

/** 设备 ID 是否合法（8 位十六进制） */
export function isValidDeviceId(deviceId) {
  return DEVICE_ID_PATTERN.test(String(deviceId || '').trim())
}

/**
 * 给「添加虚假设备」推荐一个可用的设备 ID。
 * NAS 要求：**高 5 位必须与系统内已有设备一致（用户编码），低 3 位不能与任何已有设备重复**。
 * 因此这里沿用已有设备的 5 位前缀，再挑一个当前未被占用的低 3 位。
 * @param {string[]} existingIds 系统内已存在的设备 ID
 * @returns {string} 推荐 ID（无参照设备时用 00001 + 100）
 */
export function suggestDummyDeviceId(existingIds = []) {
  const ids = existingIds
    .map((id) => String(id || '').trim().toUpperCase())
    .filter((id) => DEVICE_ID_PATTERN.test(id))

  const prefix = ids.length > 0 ? ids[0].slice(0, 5) : '00001'

  for (let low = 0x100; low <= 0xfff; low += 1) {
    const candidate = `${prefix}${low.toString(16).toUpperCase().padStart(3, '0')}`
    if (!ids.includes(candidate)) return candidate
  }

  return ''
}
