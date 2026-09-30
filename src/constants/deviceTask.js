// src/constants/deviceTask.js —— 设备任务模块的枚举字典与纯函数（不含请求）
//
// 取值来源：后端 `docs/impl-notes.md` §六（设备任务，NAS 手册 P68-80 的第九部分），
// 对外契约见 `backend/docs/API.md` 的「设备任务模块」。响应字段是 NAS 风格大驼峰：
// TaskIndex / TaskName / Priority / AutoPause / AutoStop / TaskType / EndMode / EndTime /
// PlayMode / LoopTimes / TaskVolume / **CapturerID** / VoiceText / FileList / PlayerList。
//
// ⚠️ 四条必须记住的口径（都来自手册）：
//   1) 设备任务**绑定在具体设备上、触发即执行**：由设备的按键 / 端口 / 触控按钮等触发源触发，
//      **没有任何开始时间参数**（不要拿临时任务的 startMode / startDate 来套）；
//   2) 配置前必须先把设备加入「设备任务目录」；**从目录删除会同步删除该设备的全部任务**，重新添加不恢复；
//   3) 一个设备最多 **128** 条设备任务（`TaskIndex` 1~128）；
//   4) 类型是 **0 文件播放 / 1 采播 / 3 对讲 / 7 文字语音**（与临时任务不同：设备任务**支持对讲 3**），
//      但**某台设备支持哪几种类型由它的设备类型决定**（手册 P79 的类型表，见下）。
//
// ⚠️ 还有两条「NAS 不会报错、但不会生效」的坑，只能写进 UI：
//   · 配置时**不校验**文件是否存在 / 终端是否在线，只有**触发执行时才检索**（文件不存在 = 一触发就退出）；
//   · `EndMode = 4`（时段触发）**仅特殊设备支持**：服务器不按索引号查找任务，而是在该设备所有 endMode=4
//     的任务里找「当前时间处于其时段内」的那条执行。

import {
  TASK_FILE_MAX,
  TASK_LOOP_TIMES_MAX,
  TASK_NAME_MAX_BYTES,
  TASK_PLAYER_MAX,
  TASK_PRIORITY_MAX,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_FILE,
  TASK_TYPE_TALK,
  TASK_TYPE_VOICE,
  TASK_TYPES,
  TASK_VOLUME_MAX,
  VOICE_TEXT_MAX_BYTES,
  formatPlayMode,
  formatTaskType,
  formatTaskVolume
} from '@/constants/task'
import { gbkByteLength, getDeviceTypeName, isValidDeviceId } from '@/constants/device'
import { looksLikeGroupId } from '@/constants/group'
import { looksLikePlayListRef } from '@/constants/playlist'

// ---------------- 数量与长度上限（与其它任务模块同口径，直接复用 constants/task.js 的常量） ----------------

/** 一个设备最多 128 条设备任务（手册 P68；`TaskIndex` 1~128） */
export const DEVICE_TASK_MAX = 128
export const DEVICE_TASK_INDEX_MIN = 1

/** 任务名上限：31 个 GBK 字节（中文 / 全角按 2 字节计），与临时 / 定时任务同口径 */
export const DEVICE_TASK_NAME_MAX_BYTES = TASK_NAME_MAX_BYTES
/** 文字语音文本上限：358 个 GBK 字节（约 179 个汉字） */
export const DEVICE_TASK_VOICE_TEXT_MAX_BYTES = VOICE_TEXT_MAX_BYTES
/** 文件任务的播放内容上限：180 项 */
export const DEVICE_TASK_FILE_MAX = TASK_FILE_MAX
/** 播放目标上限：248 项 */
export const DEVICE_TASK_PLAYER_MAX = TASK_PLAYER_MAX
/** 优先等级上限：0~15（数值，不是运行端那个 4 位十六进制的 `TaskPriority`） */
export const DEVICE_TASK_PRIORITY_MAX = TASK_PRIORITY_MAX
/** 循环次数上限：0 不限、1~31 */
export const DEVICE_TASK_LOOP_TIMES_MAX = TASK_LOOP_TIMES_MAX
/** 任务音量上限：0~127（0 = 0dB 最大、数值越大越小声、127 = 静音） */
export const DEVICE_TASK_VOLUME_MAX = TASK_VOLUME_MAX

/** 任务序号是否合法（1~128） */
export function isValidDeviceTaskIndex(value) {
  const num = Number(value)
  return Number.isInteger(num) && num >= DEVICE_TASK_INDEX_MIN && num <= DEVICE_TASK_MAX
}

/** 内部：统一把类型码 / ID 规范成「去空格 + 大写」的字符串（NAS 两种大小写都可能回） */
function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase()
}

/** 对外的规范化函数：设备类型码 / 设备 ID 都用它 */
export function normalizeDeviceTaskCode(value) {
  return normalizeCode(value)
}

/** 设备 ID 的规范形式（去空格 + 大写） */
export function normalizeDeviceTaskId(id) {
  return normalizeCode(id)
}

/** ID 数组的规范形式：大写、丢空值、按首次出现顺序去重 */
export function normalizeDeviceTaskIds(list) {
  const result = []
  for (const item of Array.isArray(list) ? list : []) {
    const id = normalizeDeviceTaskId(item)
    if (id && !result.includes(id)) result.push(id)
  }
  return result
}

// ---------------- 设备类型 → 支持的任务类型（手册 P79 的类型表） ----------------
//
// 手册 P79 给出一张「设备类型 → 支持的任务类型 → 限定」的表。本项目把它抄成下面这张字典：
//   · `types`  —— 该设备类型支持的任务类型（**表单里只能从这几个里选**）；
//   · `limits` —— 手册对字段内容的「限定」，取值见 TASK_SCOPES。
// ⚠️ 手册那一页是按「行」给出限定的（一行覆盖好几个类型码），所以同一行里的类型共享同一组 `limits`。

/** 手册 P79「限定」列的四个取值（本项目内部用途，**不会**发给 NAS） */
export const TASK_SCOPES = {
  ACT_PLAYER: 'ActPlayer',
  ACT_CAPTURER: 'ActCapturer',
  ACT_PHONE: 'ActPhone',
  ALARM_FILE: 'AlarmFile'
}

/**
 * 设备类型 → 支持的任务类型 + 限定（手册 P79）。
 * key 是 2 位十六进制的 `DeviceType`，中文名取自 constants/device.js 的 `DEVICE_TYPE_NAMES`（同一张手册表）。
 */
export const DEVICE_TASK_TYPE_TABLE = {
  // 4G 终端 / 触屏功放 / 带 SD 卡的本地备份终端：文件 + 采播 + 文字语音，限定 ActPlayer
  '41': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '51': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '2D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '55': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  // 主动采播器（触屏 / 按键 / 电平触发）：只支持采播，限定 ActCapturer
  '2E': { types: [TASK_TYPE_CAPTURE], limits: ['ActCapturer'] },
  '4E': { types: [TASK_TYPE_CAPTURE], limits: ['ActCapturer'] },
  '7E': { types: [TASK_TYPE_CAPTURE], limits: ['ActCapturer'] },
  // 对讲面板：采播 + 对讲，限定 ActCapturer + ActPhone
  '6E': { types: [TASK_TYPE_CAPTURE, TASK_TYPE_TALK], limits: ['ActCapturer', 'ActPhone'] },
  // 消防采播器：文件（报警媒体）+ 采播 + 文字语音，限定 ActCapturer + AlarmFile
  '3E': {
    types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE],
    limits: ['ActCapturer', 'AlarmFile']
  },
  // 网络消防报警控制器：文件（报警媒体）+ 采播 + 文字语音，限定 AlarmFile
  '4C': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['AlarmFile'] },
  // 遥控 / 点播 / 主动终端一族：文件 + 采播 + 文字语音，限定 ActPlayer
  '5C': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '5D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '7C': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '6C': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '6D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '7D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '9D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  '8D': { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActPlayer'] },
  // 网络对讲话筒终端：文件 + 采播 + **对讲** + 文字语音，限定 ActPlayer + ActCapturer + ActPhone
  '5F': {
    types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_TALK, TASK_TYPE_VOICE],
    limits: ['ActPlayer', 'ActCapturer', 'ActPhone']
  },
  '6F': {
    types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_TALK, TASK_TYPE_VOICE],
    limits: ['ActPlayer', 'ActCapturer', 'ActPhone']
  },
  '9F': {
    types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_TALK, TASK_TYPE_VOICE],
    limits: ['ActPlayer', 'ActCapturer', 'ActPhone']
  },
  // 第三方控制器 / 网关与几种软件（分控软件等）：文件 + 采播 + 文字语音，限定 ActCapturer
  DC: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] },
  D8: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] },
  DE: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] },
  CE: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] },
  C8: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] },
  DA: { types: [TASK_TYPE_FILE, TASK_TYPE_CAPTURE, TASK_TYPE_VOICE], limits: ['ActCapturer'] }
}

/** 支持（需要）配置设备任务的设备类型：code → 中文名（「新增设备」候选与列表展示都用它） */
export const DEVICE_TYPES_SUPPORT_TASK = Object.fromEntries(
  Object.keys(DEVICE_TASK_TYPE_TABLE).map((code) => [code, getDeviceTypeName(code) || '未知类型'])
)

/** 支持设备任务的类型编码清单（候选设备筛选、下拉遍历都用它） */
export const SUPPORT_TASK_TYPE_CODES = Object.keys(DEVICE_TASK_TYPE_TABLE)

/** 该设备类型的任务类型定义（未知类型返回 null，调用方据此提示「手册未列出」） */
export function findDeviceTaskTypeInfo(deviceType) {
  return DEVICE_TASK_TYPE_TABLE[normalizeCode(deviceType)] || null
}

/** 这台设备是否需要（支持）配置设备任务：候选设备筛选用 */
export function needsDeviceTask(deviceType) {
  return Boolean(findDeviceTaskTypeInfo(deviceType))
}

/** 取该设备类型支持的任务类型数组（未知类型返回空数组） */
export function supportTaskTypes(deviceType) {
  const info = findDeviceTaskTypeInfo(deviceType)
  return info ? info.types.slice() : []
}

/** 该设备类型是否支持某个任务类型（后端 / NAS 只按设备类型判断，前端据此限制单选项） */
export function isValidTaskTypeForDevice(deviceType, taskType) {
  const info = findDeviceTaskTypeInfo(deviceType)
  if (!info) return false
  return info.types.includes(Number(taskType))
}

/** 该设备类型是否带某个「限定」（入参是 TASK_SCOPES 的值，如 'ActPhone'） */
export function hasTaskScope(deviceType, scope) {
  const info = findDeviceTaskTypeInfo(deviceType)
  return Boolean(info && info.limits.includes(scope))
}

/** 限定 ActPlayer：播放目标里应当包含设备自身（它自己也是播放终端） */
export function limitsDeviceAsPlayer(deviceType) {
  return hasTaskScope(deviceType, TASK_SCOPES.ACT_PLAYER)
}

/** 限定 ActCapturer：采播内容来自设备自身 → `CapturerID` 可省略（省略即设备自身） */
export function limitsDeviceAsCapturer(deviceType) {
  return hasTaskScope(deviceType, TASK_SCOPES.ACT_CAPTURER)
}

/** 限定 ActPhone：支持对讲任务，设备自身是主叫方、`PlayerList` 第一个是被叫方 */
export function limitsDeviceAsPhone(deviceType) {
  return hasTaskScope(deviceType, TASK_SCOPES.ACT_PHONE)
}

/**
 * 限定 AlarmFile：文件任务的 `FileList` 来自**报警媒体**（不是系统媒体）。
 * 手册 §六 3 明确点名的类型是 `4C`（网络消防报警控制器）与 `3E`（消防采播器）——
 * 判定就用类型表里的 AlarmFile 限定，不再单独硬编码类型码。
 */
export function needsAlarmFile(deviceType) {
  return hasTaskScope(deviceType, TASK_SCOPES.ALARM_FILE)
}

/** 支持「对讲」任务（类型 3）的设备类型清单（对讲任务的「被叫方」候选从这里筛） */
export const TALK_CAPABLE_TYPE_CODES = Object.keys(DEVICE_TASK_TYPE_TABLE).filter((code) =>
  DEVICE_TASK_TYPE_TABLE[code].types.includes(TASK_TYPE_TALK)
)

/** 文件来自报警媒体的设备类型清单（4C / 3E；页面上用它决定媒体的来源） */
export const ALARM_FILE_TYPE_CODES = Object.keys(DEVICE_TASK_TYPE_TABLE).filter((code) =>
  DEVICE_TASK_TYPE_TABLE[code].limits.includes(TASK_SCOPES.ALARM_FILE)
)

// ---------------- 设备类型与任务序号的展示 ----------------

/**
 * 设备类型 → 展示文案：`4C · 网络消防报警控制器`。
 * 未知编码原样显示（目录 / 设备列表都可能出现手册之外的值，藏起来反而不好排障）。
 */
export function describeDeviceTypeForTask(deviceType) {
  const code = normalizeCode(deviceType)
  if (!code) return '未知类型（设备列表里没找到这台设备）'
  return DEVICE_TYPES_SUPPORT_TASK[code] || `未知类型（${code}）`
}

/** 手册 P79 那张表的可读描述：`支持任务类型：文件播放、采播、文字语音（限定 ActPlayer）` */
export function describeDeviceSupport(deviceType) {
  const code = normalizeCode(deviceType)
  const info = findDeviceTaskTypeInfo(code)
  if (!info) return '手册 P79 的类型表里没有这个设备类型 —— 无法判断它支持哪些设备任务'
  const names = info.types.map((type) => TASK_TYPES[type] || `未知类型（${type}）`).join('、')
  const limits = info.limits.length ? `（手册限定：${info.limits.join(' + ')}）` : ''
  return `支持任务类型：${names}${limits}`
}

/**
 * 任务序号的可读叫法。
 * 手册只说「一般与设备的按键 / 端口 / 触控按钮序号对应」，这里按设备类型给一个更贴近的叫法（纯提示）。
 */
export function describeTaskIndexLabel(deviceType, taskIndex) {
  const code = normalizeCode(deviceType)
  const index = Number(taskIndex)
  const suffix = isValidDeviceTaskIndex(index) ? `#${index}` : '（序号待填）'
  if (needsAlarmFile(code)) return `报警通道 ${suffix}`
  if (limitsDeviceAsPhone(code)) return `对讲按键 ${suffix}`
  return `端口 / 按键 / 触控按钮 ${suffix}`
}

/**
 * 推荐一个还没被占用的任务序号（新建弹窗的默认值）。
 * 取现有序号之后的第一个空位；已满 128 条时返回 0，调用方提示「已达上限」。
 */
export function recommendTaskIndex(rows) {
  const used = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => Number(row && row.TaskIndex))
      .filter((value) => isValidDeviceTaskIndex(value))
  )
  for (let index = DEVICE_TASK_INDEX_MIN; index <= DEVICE_TASK_MAX; index += 1) {
    if (!used.has(index)) return index
  }
  return 0
}

// ---------------- 结束时间模式 ----------------

/**
 * 结束时间模式（`EndMode`）。⚠️ **只有 0 / 3 / 4**，没有 1 ——
 * 1「指定绝对时刻结束」是临时任务 / 定时任务用的，设备任务触发即执行、没有绝对时刻的概念。
 */
export const DEVICE_TASK_END_MODES = {
  0: '不指定（任务播完自然结束）',
  3: '持续指定时长（`hh:mm:ss` 就是时长）',
  4: '时段触发（`hh:mm:ss` = 起始时分 + 时段小时数，仅特殊设备）'
}

/** 给 el-radio-group / el-select 用的选项数组 */
export const DEVICE_TASK_END_MODE_OPTIONS = Object.entries(DEVICE_TASK_END_MODES).map(
  ([value, label]) => ({ value: Number(value), label })
)

/** 取结束模式的可读文案 */
export function describeEndModeForDeviceTask(mode) {
  const value = Number(mode)
  if (mode === null || mode === undefined || mode === '' || Number.isNaN(value)) return '未指定'
  return DEVICE_TASK_END_MODES[value] || `未知的结束模式（${value}）`
}

/**
 * ⚠️ 手册只说 `endMode = 4`（时段触发）是「**特殊设备**」专用，**没有给出设备类型清单**，
 * 后端 DTO 也没有透出这类能力位。这里的清单**故意保持为空**：
 *   · 为空时 `canUseEndMode4()` 一律返回 true（不硬拦，弹窗用一条强制确认来兜住）；
 *   · 一旦从手册 / 现场确证了支持时段触发的设备类型，把类型码（2 位十六进制）填进来即可，
 *     UI 与校验会自动收紧到这些类型。
 */
export const DEVICE_TYPES_END_MODE_4 = []

/** 该设备类型是否可以使用 `endMode = 4`（清单未知时一律放行，见 DEVICE_TYPES_END_MODE_4 的说明） */
export function canUseEndMode4(deviceType) {
  if (DEVICE_TYPES_END_MODE_4.length === 0) return true
  return DEVICE_TYPES_END_MODE_4.includes(normalizeCode(deviceType))
}

/**
 * 结束时间是否合法（格式 `hh:mm:ss`，语义随 `endMode` 变化）：
 *   · `endMode = 3` —— 前两位是**时长**的小时、`mm` 分、`ss` 秒（时分秒都要 < 60）；
 *   · `endMode = 4` —— 前两位是**起始时分**（`hh` < 24、`mm` < 60），第三位是**持续小时数**（1~99）；
 *   · `endMode = 0` —— 不需要结束时间，一律返回 true。
 * ⚠️ 后端只做 `^\d{2}:\d{2}:\d{2}$` 的正则校验，这里更严（提前拦住「25:99:99」这种）。
 */
export function isValidDeviceTaskEndTime(value, endMode) {
  const mode = Number(endMode)
  if (mode === 0 || Number.isNaN(mode)) return true
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(value == null ? '' : value).trim())
  if (!match) return false
  const first = Number(match[1])
  const second = Number(match[2])
  const third = Number(match[3])
  if (mode === 4) return first < 24 && second < 60 && third >= 1 && third <= 99
  return first < 60 && second < 60 && third < 60
}

/** 把「起始时分 + 时段小时数」拼成 `endMode=4` 要发的 `hh:mm:ss`（小时数补 2 位） */
export function buildDeviceTaskEndTime({ start = '', hours = 0 } = {}) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(start == null ? '' : start).trim())
  const hourCount = Number(hours)
  if (!match || !Number.isInteger(hourCount)) return ''
  return `${match[1]}:${match[2]}:${String(hourCount).padStart(2, '0')}`
}

/**
 * 结束时间的可读描述（列表页与弹窗摘要都用它）。
 * `endMode=4` 时拆成「08:20 起，持续 3 小时」让人一眼看懂 SS 不是秒。
 */
export function describeDeviceTaskEnd(row) {
  const source = row || {}
  const mode = Number(source.EndMode)
  if (mode === 0) return '不指定（播完自然结束）'
  const value = String(source.EndTime == null ? '' : source.EndTime).trim() || '（缺结束时间）'
  if (mode === 4) {
    const parts = value.split(':')
    if (parts.length === 3) {
      return `时段触发：${parts[0]}:${parts[1]} 起，持续 ${Number(parts[2])} 小时`
    }
    return `时段触发：${value}`
  }
  if (mode === 3) return `持续 ${value}`
  return describeEndModeForDeviceTask(mode)
}

// ---------------- 提示文案（页面与弹窗直接渲染，保证各处口径一致） ----------------

/** 设备任务的定位（每次进页面都要讲一次，否则很容易被当成「定时任务」） */
export const HINT_BOUND_DEVICE =
  '设备任务绑定在具体设备上：该设备的按键 / 端口 / 触控按钮等触发源被触发后「即时执行」，没有开始时间参数（不需要、也不能设置「什么时候开始」）'

/** 配置前必须先加入目录 */
export const HINT_CATALOG_FIRST = '配置设备任务前，必须先把设备加入「设备任务目录」（没有加入目录的设备读不到任务）'

/** 移出目录的后果（二次确认文案也用它） */
export const HINT_REMOVE_DELETES_ALL =
  '把设备移出目录会「同步删除该设备的全部设备任务」（重新加入不会恢复，任务也不会回到之前的内容）'

/** 数量上限 */
export const HINT_MAX_TASKS = `一个设备最多 ${DEVICE_TASK_MAX} 条设备任务（TaskIndex 1~${DEVICE_TASK_MAX}，一般与设备的按键 / 端口 / 触控按钮序号对应）`

/** 触发时才校验 */
export const HINT_TRIGGER_NO_CHECK =
  '配置时 NAS 不校验文件是否存在、终端是否在线，只有触发执行时才去检索 —— 「保存成功」不等于「触发就一定出声」'

/** 报警媒体的来源（4C / 3E） */
export const HINT_ALARM_FILE =
  '此设备的文件来自报警媒体列表，不是系统媒体（消防类设备 4C 网络消防报警控制器 / 3E 消防采播器）'

/** 时段触发（endMode=4）的语义 */
export const HINT_END_MODE_4 =
  '时段触发是特殊设备专用：服务器在该设备所有 endMode=4 的任务里找「当前时间处于其时段内」的任务执行；此时 EndTime 形如 hh:mm:ss，前两个字段是起始时分，第三个是持续小时数（例：08:20:03 = 08:20 开始、持续 3 小时）'

/** 时段触发的确认语（手册没给设备类型清单，只能让用户确认） */
export const HINT_END_MODE_4_CONFIRM =
  '手册只写「endMode=4 仅特殊设备支持」，没有给出支持它的设备类型清单，本系统也无法从设备信息里判断 —— 请自行确认这台设备属于「特殊设备」'

/** 对讲任务：第一个播放目标是「被叫方」 */
export const HINT_TALK_FIRST_CALLEE =
  '对讲任务的 PlayerList 第一个是「被叫方」（只能有一个）；主叫方是设备自身，由 CapturerID 表示'

/** 对讲任务的 CapturerID 约定 */
export const HINT_TALK_CAPTURER =
  '对讲任务的 CapturerID 可以省略（NAS 默认取设备自身），但若填写就必须等于 DeviceID（后端会返回 400）'

/** ActCapturer 限定的采播来源说明 */
export const HINT_CAPTURER_SELF =
  '这台设备的采播源就是它自己（手册限定 ActCapturer）：CapturerID 可以留空（NAS 默认取设备自身），填写时必须等于设备 ID'

/** ActPlayer 限定的播放目标说明 */
export const HINT_ACT_PLAYER =
  '手册限定 ActPlayer：播放目标里要包含「设备自身」（触发时它自己也要出声），别只选别的终端'

/** 禁用的语义 */
export const HINT_DISABLE_ONLY =
  '禁用一条任务只需 DeviceID + TaskIndex + Disable（任务内容保留在 NAS 上）；重新启用必须把任务内容一起发回去，否则内容会被清空'

/** 文件 ID 的写法 */
export const HINT_FILE_ID =
  '文件 ID 是 4 位十六进制（上传媒体时由 NAS 分配）；在设备任务里直接填文件 ID，不要填播放列表引用 FFxx'

/** 播放目标的写法 */
export const HINT_PLAYER_ID =
  '播放目标是 8 位十六进制终端设备 ID（手册的设备任务字段表里只写终端；FFFFFFxx 是分组写法，那是临时 / 定时任务里的用法）'

/** 查询接口的 Result=1 语义 */
export const HINT_NO_TASKS_YET =
  'NAS 返回 Result=1 表示该设备还没有配置任何设备任务（不是错误，按空列表处理）'

/** 两个查询接口没有码表 */
export const HINT_NO_CODE_TABLE =
  '设备任务目录与任务清单这两个查询接口手册没给 Result 码表，未收录的码会显示原始数值，便于照手册排查'

// ---------------- 归一化与请求体组装 ----------------

/**
 * NAS 的 `DeviceTaskList` 响应 → 页面统一形态。
 * ⚠️ `Result === 1` = 该设备还没有配置设备任务：此时除 DataType / Result 外字段全部缺席，
 *    这里按空列表处理并把 `notConfigured` 标出来（不是错误）。
 */
export function normalizeDeviceTaskList(response) {
  const source = response && typeof response === 'object' ? response : {}
  return {
    deviceId: normalizeDeviceTaskId(source.DeviceID),
    notConfigured: Number(source.Result) === 1,
    rows: Array.isArray(source.Data) ? source.Data : []
  }
}

/**
 * 一条设备任务在页面里的统一形态（表格与弹窗都用它，避免各处自己读 NAS 字段）。
 * 只做「类型 + 数量 + 文案」层面的事实整理；文件名 / 设备名由页面用各自的 store 补。
 */
export function toDeviceTaskRow(row, { deviceType = '' } = {}) {
  const source = row || {}
  const taskType = Number(source.TaskType)
  return {
    ...source,
    taskIndex: Number(source.TaskIndex),
    indexLabel: describeTaskIndexLabel(deviceType, source.TaskIndex),
    taskType,
    typeText: formatTaskType(source.TaskType),
    /**
     * ⚠️ 手册的 `DeviceTaskList.Data[]` 字段表里**没有** `Disable`（后端 DTO 也没有这个字段）——
     * 也就是说「这条任务当前是启用还是禁用」从这个列表里**看不出来**，页面必须如实说明，
     * 不能凭 0/1 猜（`disableKnown` 为 false 时页面上显示「NAS 未回传」）。
     */
    disableKnown: source.Disable !== undefined && source.Disable !== null,
    disabled: Number(source.Disable) === 1,
    fileList: normalizeDeviceTaskIds(source.FileList),
    playerList: normalizeDeviceTaskIds(source.PlayerList),
    capturerId: normalizeDeviceTaskId(source.CapturerID),
    voiceText: String(source.VoiceText == null ? '' : source.VoiceText),
    endText: describeDeviceTaskEnd(source),
    volumeText: formatTaskVolume(source.TaskVolume),
    playModeText:
      taskType === TASK_TYPE_CAPTURE ? '采播（无播放模式）' : formatPlayMode(source.PlayMode),
    isTalk: taskType === TASK_TYPE_TALK,
    /** 对讲任务里第一个播放目标是被叫方 */
    callee: taskType === TASK_TYPE_TALK ? normalizeDeviceTaskId((source.PlayerList || [])[0]) : ''
  }
}

/**
 * 表单值 → 请求体（小驼峰）。
 *
 * ⚠️ 这里按「NAS 的字段语义」决定发哪些字段，而不是把表单原样倒出去：
 *   · `disable = 1` 时**只发 deviceId + taskIndex + disable**（手册明确禁用无需任务内容；
 *     后端在禁用时也只往 NAS 转这几个字段）；
 *   · `endMode = 0` 时不发 endTime（后端 `putIfNotNull` 也不会带上）；
 *   · `playMode` / `loopTimes` 只对文件(0) / 文字语音(7) 任务有意义，采播与对讲任务不发它们；
 *   · `capturerId` 只对采播(1) / 对讲(3) 任务有意义（**对讲任务留空 = 主叫方是设备自身**，不要发空串）；
 *   · 内容字段按类型二选一：`0` → fileList、`7` → voiceText；
 *   · 对讲任务的 `playerList` 只取第一个（手册：第一个是被叫方，只能有一个）。
 *
 * @param {object} form 表单值（taskIndex / disable / taskType / fileList / playerList / …）
 * @returns {object} 可直接交给 setDeviceTask 的请求体
 */
export function buildDeviceTaskPayload(form) {
  const source = form && typeof form === 'object' ? form : {}
  const payload = {
    deviceId: normalizeDeviceTaskId(source.deviceId),
    taskIndex: Number(source.taskIndex),
    disable: Number(source.disable) === 1 ? 1 : 0
  }
  // 禁用：手册明确不需要任务内容字段（重新启用时才要把内容发回去）
  if (payload.disable === 1) return payload

  const taskType = Number(source.taskType)
  payload.taskType = taskType
  payload.playerList =
    taskType === TASK_TYPE_TALK
      ? normalizeDeviceTaskIds(source.playerList).slice(0, 1)
      : normalizeDeviceTaskIds(source.playerList)
  payload.priority = Number(source.priority) || 0
  payload.autoPause = Number(source.autoPause) === 1 ? 1 : 0
  payload.autoStop = Number(source.autoStop) === 1 ? 1 : 0
  payload.taskVolume = Number(source.taskVolume) || 0

  const name = String(source.taskName == null ? '' : source.taskName).trim()
  if (name) payload.taskName = name

  const endMode = Number(source.endMode) || 0
  if (endMode === 3 || endMode === 4) {
    payload.endMode = endMode
    payload.endTime = String(source.endTime == null ? '' : source.endTime).trim()
  }

  if (taskType !== TASK_TYPE_CAPTURE && taskType !== TASK_TYPE_TALK) {
    payload.playMode = Number(source.playMode)
    payload.loopTimes = Number(source.loopTimes) || 0
  }
  if (taskType === TASK_TYPE_FILE) payload.fileList = normalizeDeviceTaskIds(source.fileList)
  if (taskType === TASK_TYPE_VOICE) {
    payload.voiceText = String(source.voiceText == null ? '' : source.voiceText)
  }
  if (taskType === TASK_TYPE_CAPTURE || taskType === TASK_TYPE_TALK) {
    const capturerId = normalizeDeviceTaskId(source.capturerId)
    if (capturerId) payload.capturerId = capturerId
  }

  return payload
}

/**
 * 把 NAS 的一条设备任务行**原样回写**成请求体（列表页的「禁用 / 重新启用」用）。
 *
 * 为什么需要它：`DeviceTaskSet` 是**整体设置** —— 重新启用一条任务时必须把任务内容一起发回去，
 * 只发 `deviceId + taskIndex + disable` 会把 NAS 上的内容清空。这里按行里的类型分支还原字段
 * （`TaskType≠0` 时 NAS 不回传 `CapturerID`、`EndMode=0` 时没有 `EndTime`，都不能凭空补）。
 *
 * @param {object} row NAS 行（或 `toDeviceTaskRow` 的产物）
 * @param {{deviceId: string, disable?: number, taskIndex?: number}} overrides 目标设备与开关
 * @returns {object} 可直接交给 setDeviceTask 的请求体
 */
export function deviceTaskToPayload(row, { deviceId, disable, taskIndex } = {}) {
  const source = row || {}
  const taskType = Number(source.TaskType)
  const form = {
    deviceId: normalizeDeviceTaskId(deviceId == null ? source.DeviceID : deviceId),
    taskIndex: Number(taskIndex == null ? source.TaskIndex : taskIndex),
    disable: Number(disable == null ? source.Disable : disable) === 1 ? 1 : 0,
    taskType,
    taskName: source.TaskName,
    priority: source.Priority,
    autoPause: source.AutoPause,
    autoStop: source.AutoStop,
    taskVolume: source.TaskVolume,
    endMode: source.EndMode,
    endTime: source.EndTime,
    playerList: source.PlayerList,
    fileList: source.FileList,
    voiceText: source.VoiceText,
    capturerId: source.CapturerID
  }
  if (taskType !== TASK_TYPE_CAPTURE && taskType !== TASK_TYPE_TALK) {
    form.playMode = source.PlayMode
    form.loopTimes = source.LoopTimes
  }
  return buildDeviceTaskPayload(form)
}

/** 新建任务时的表单初值（`taskIndex` 由页面用 `recommendTaskIndex` 推荐） */
export function createDeviceTaskForm({ deviceId = '', taskIndex = 0, deviceType = '' } = {}) {
  const types = supportTaskTypes(deviceType)
  return {
    deviceId: normalizeDeviceTaskId(deviceId),
    taskIndex: isValidDeviceTaskIndex(taskIndex) ? Number(taskIndex) : 0,
    // 设备任务默认「启用」：用户新建一条任务就是要让它生效
    disable: 0,
    taskName: '',
    priority: 0,
    autoPause: 0,
    autoStop: 0,
    taskType: types.length ? types[0] : TASK_TYPE_FILE,
    endMode: 0,
    endTime: '',
    /** `endMode=4` 的输入拆成两段（起始时分 + 小时数），拼装由 buildDeviceTaskEndTime 负责 */
    endTimeStart: '08:00',
    endTimeHours: 1,
    playMode: 2,
    loopTimes: 0,
    taskVolume: 0,
    capturerId: '',
    voiceText: '',
    fileList: [],
    playerList: []
  }
}

// ---------------- 校验（页面在提交前拦住明显不合法的数据） ----------------

/**
 * 校验一份待提交的设备任务，返回错误文案数组（空数组 = 可以提交）。
 * 判据与后端 `DeviceTaskSetRequestDto` 的校验注解 + 手册 P79 的设备类型表一一对应，只是把 400 提前：
 *   · `deviceId` 必须是 8 位十六进制；`taskIndex` 1~128；`disable` 只能是 0 / 1；
 *   · **`disable = 1` 时只校验上面三项**（手册：禁用不需要任何任务内容字段）；
 *   · `taskType` 必须是该设备类型支持的类型；
 *   · `playerList` 启用时必填（≤248，元素 8 位十六进制）；**对讲任务（3）只能有一个**（第一个是被叫方）；
 *   · `fileList`（类型 0）必填 ≤180，元素 4 位十六进制；`voiceText`（类型 7）必填 ≤358 GBK 字节；
 *   · `capturerId`（类型 1）必填，除非该设备带 ActCapturer 限定（手册：那台设备的采播源就是它自己）；
 *     类型 3 时可以不填，但填了必须等于 `deviceId`（后端 @AssertTrue，不一致直接 400）；
 *   · `endMode` 只能是 0 / 3 / 4，且 3 / 4 必须给合法 `endTime`；
 *   · `taskName` ≤31 GBK 字节、`priority` 0~15、`playMode` 0~4、`loopTimes` 0~31、`taskVolume` 0~127。
 *
 * @param {object} payload `buildDeviceTaskPayload` 的产物
 * @param {{deviceId?: string, deviceType?: string}} [context] 目标设备（`deviceId` 不传时取 payload.deviceId）
 * @returns {string[]} 错误文案数组
 */
export function validateDeviceTaskPayload(payload, context = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const errors = []
  const deviceId = normalizeDeviceTaskId(context.deviceId || source.deviceId)
  const deviceType = normalizeDeviceTaskCode(context.deviceType)

  if (!isValidDeviceId(deviceId)) {
    errors.push('设备 ID 必须是 8 位十六进制（例如 00001AB2）：请先选择要配置任务的设备')
  }
  if (!isValidDeviceTaskIndex(source.taskIndex)) {
    errors.push(
      `任务序号必须是 ${DEVICE_TASK_INDEX_MIN}~${DEVICE_TASK_MAX} 的整数（一个设备最多 ${DEVICE_TASK_MAX} 条设备任务）`
    )
  }
  const disable = Number(source.disable)
  if (disable !== 0 && disable !== 1) {
    errors.push('启用状态（disable）只能是 0 启用 / 1 禁用')
  }
  if (disable === 1) return errors // 禁用：手册明确不需要任何任务内容字段

  const taskType = Number(source.taskType)
  if (!isValidTaskTypeForDevice(deviceType, taskType)) {
    const allowed = supportTaskTypes(deviceType)
      .map((type) => TASK_TYPES[type] || type)
      .join('、')
    errors.push(
      allowed
        ? `这台设备（${describeDeviceTypeForTask(deviceType)}）不支持所选任务类型；它只支持：${allowed}`
        : `手册 P79 的类型表里没有 ${deviceType || '（未知）'} 这个设备类型 —— 无法判断它支持哪些任务类型，请先确认设备类型`
    )
  }

  const playerList = normalizeDeviceTaskIds(source.playerList)
  if (!playerList.length) {
    errors.push(
      taskType === TASK_TYPE_TALK ? '对讲任务必须选一个「被叫方」' : '播放目标（playerList）启用时必填，至少 1 项'
    )
  } else if (playerList.length > DEVICE_TASK_PLAYER_MAX) {
    errors.push(`播放目标最多 ${DEVICE_TASK_PLAYER_MAX} 项（当前 ${playerList.length} 项）`)
  } else if (playerList.some((id) => !isValidDeviceId(id))) {
    errors.push('播放目标里必须是 8 位十六进制终端 ID（例如 00001AB2）')
  }
  if (taskType === TASK_TYPE_TALK && playerList.length > 1) {
    errors.push(`对讲任务的播放目标只能有 1 个（第一个即被叫方，当前 ${playerList.length} 个）`)
  }

  const fileList = normalizeDeviceTaskIds(source.fileList)
  if (taskType === TASK_TYPE_FILE) {
    if (!fileList.length) {
      errors.push(
        needsAlarmFile(deviceType)
          ? '文件播放任务必须选择至少一个报警媒体文件'
          : '文件播放任务必须选择至少一个文件'
      )
    } else if (fileList.length > DEVICE_TASK_FILE_MAX) {
      errors.push(`播放内容最多 ${DEVICE_TASK_FILE_MAX} 项（当前 ${fileList.length} 项）`)
    } else if (fileList.some((id) => !/^[0-9A-F]{4}$/.test(id))) {
      errors.push('文件 ID 必须是 4 位十六进制（例如 00A2）')
    }
  }

  if (taskType === TASK_TYPE_VOICE) {
    const text = String(source.voiceText == null ? '' : source.voiceText).trim()
    if (!text) {
      errors.push('文字语音任务必须填写要播报的文本')
    } else {
      const bytes = gbkByteLength(text)
      if (bytes > DEVICE_TASK_VOICE_TEXT_MAX_BYTES) {
        errors.push(
          `文本不能超过 ${DEVICE_TASK_VOICE_TEXT_MAX_BYTES} 个 GBK 字节（当前 ${bytes} 字节，约 179 个汉字）`
        )
      }
    }
  }

  const capturerId = normalizeDeviceTaskId(source.capturerId)
  if (capturerId && !isValidDeviceId(capturerId)) {
    errors.push('采播器 ID 必须是 8 位十六进制的设备 ID')
  }
  if (taskType === TASK_TYPE_CAPTURE && !capturerId && !limitsDeviceAsCapturer(deviceType)) {
    errors.push('采播任务必须指定采播器（这台设备没有 ActCapturer 限定，不能默认取设备自身）')
  }
  if (taskType === TASK_TYPE_TALK && capturerId && capturerId !== deviceId) {
    errors.push(`对讲任务的 CapturerID 若填写必须等于设备自身（${deviceId}）：主叫方只能是它自己`)
  }

  const endMode = Number(source.endMode) || 0
  if (![0, 3, 4].includes(endMode)) {
    errors.push('结束模式只能是 0 不指定 / 3 持续时长 / 4 时段触发（设备任务没有「指定绝对时刻」）')
  } else if (endMode === 4 && !canUseEndMode4(deviceType)) {
    errors.push('这台设备类型不支持时段触发（endMode=4 仅特殊设备可用）')
  } else if (endMode === 3 || endMode === 4) {
    const endTime = String(source.endTime == null ? '' : source.endTime).trim()
    if (!endTime) {
      errors.push(endMode === 4 ? '时段触发必须给出「起始时分 + 小时数」' : '持续时长必须填 hh:mm:ss')
    } else if (!isValidDeviceTaskEndTime(endTime, endMode)) {
      errors.push(
        endMode === 4
          ? '时段触发的格式是 hh:mm:ss：前两位是起始时分（hh<24、mm<60），第三位是持续小时数（1~99）'
          : '持续时长必须是 hh:mm:ss（例 01:30:00 = 1 小时 30 分）'
      )
    }
  }

  const name = String(source.taskName == null ? '' : source.taskName).trim()
  if (name && gbkByteLength(name) > DEVICE_TASK_NAME_MAX_BYTES) {
    errors.push(
      `任务名不能超过 ${DEVICE_TASK_NAME_MAX_BYTES} 个 GBK 字节（当前 ${gbkByteLength(name)} 字节）`
    )
  }
  const priority = Number(source.priority)
  if (!(priority >= 0 && priority <= DEVICE_TASK_PRIORITY_MAX)) {
    errors.push(`优先等级必须是 0~${DEVICE_TASK_PRIORITY_MAX} 的整数`)
  }
  const volume = Number(source.taskVolume)
  if (!(volume >= 0 && volume <= DEVICE_TASK_VOLUME_MAX)) {
    errors.push(`任务音量必须是 0~${DEVICE_TASK_VOLUME_MAX} 的整数（0 = 最大 / 0dB、127 = 静音）`)
  }
  if (taskType !== TASK_TYPE_CAPTURE && taskType !== TASK_TYPE_TALK) {
    const playMode = Number(source.playMode)
    if (!(playMode >= 0 && playMode <= 4)) errors.push('播放模式必须是 0~4 的整数')
    const loopTimes = Number(source.loopTimes) || 0
    if (!(loopTimes >= 0 && loopTimes <= DEVICE_TASK_LOOP_TIMES_MAX)) {
      errors.push(`循环次数必须是 0（不限）~${DEVICE_TASK_LOOP_TIMES_MAX}`)
    }
  }

  return errors
}

/**
 * 「能保存、但很可能是配错了」的提醒（**不拦**提交，只在弹窗里黄字提示）。
 * 判定依据都是手册的「限定」列，NAS 侧不会报错，所以只能提示：
 *   · ActPlayer 限定的设备：播放目标里应包含设备自身；
 *   · 对讲任务：被叫方不应该是设备自身；
 *   · ActCapturer 限定的设备：采播任务里填的 capturerId 与设备自身不一致（手册说采播源就是它自己）；
 *   · 手输的分组写法 FFFFFFxx / 播放列表引用 FFxx。
 */
export function deviceTaskWarnings(payload, context = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const deviceId = normalizeDeviceTaskId(context.deviceId || source.deviceId)
  const deviceType = normalizeDeviceTaskCode(context.deviceType)
  const taskType = Number(source.taskType)
  const warnings = []
  if (Number(source.disable) === 1) return warnings

  const playerList = normalizeDeviceTaskIds(source.playerList)
  if (limitsDeviceAsPlayer(deviceType) && deviceId && !playerList.includes(deviceId)) {
    warnings.push(`${HINT_ACT_PLAYER}（当前播放目标里没有 ${deviceId}）`)
  }
  const groupIds = playerList.filter((id) => looksLikeGroupId(id))
  if (groupIds.length) {
    warnings.push(`播放目标里有分组写法（${groupIds.join('、')}）：${HINT_PLAYER_ID}`)
  }
  if (taskType === TASK_TYPE_TALK && playerList[0] === deviceId) {
    warnings.push(`对讲任务的第一个播放目标是「被叫方」，不应该填设备自身（${deviceId}）`)
  }

  const capturerId = normalizeDeviceTaskId(source.capturerId)
  if (
    taskType === TASK_TYPE_CAPTURE &&
    capturerId &&
    limitsDeviceAsCapturer(deviceType) &&
    capturerId !== deviceId
  ) {
    warnings.push(`${HINT_CAPTURER_SELF}（当前填的是 ${capturerId}）`)
  }

  const playlistRefs = normalizeDeviceTaskIds(source.fileList).filter((id) => looksLikePlayListRef(id))
  if (playlistRefs.length) {
    warnings.push(`播放内容里有 FFxx（${playlistRefs.join('、')}）：${HINT_FILE_ID}`)
  }
  if (Number(source.endMode) === 4) warnings.push(HINT_END_MODE_4)

  return warnings
}

// ---------------- 候选项（从设备 / 媒体列表生成，尽量只能选到真实存在的对象） ----------------

/** 按 value 去重（同一个 ID 出现在多个列表里时，保留第一次出现的来源说明） */
function dedupeOptions(options) {
  const result = []
  const seen = new Set()
  for (const option of options) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    result.push(option)
  }
  return result
}

/** 设备对象 → 下拉选项（value = 8 位 ID，label = 名称（ID），另带类型与来源说明） */
function toDeviceOption(device, source) {
  const value = normalizeDeviceTaskId(device && device.DeviceID)
  if (!isValidDeviceId(value)) return null
  const deviceName = (device && device.DevName) || '未命名'
  return {
    value,
    deviceName,
    label: `${deviceName}（${value}）`,
    deviceType: normalizeDeviceTaskCode(device && device.DeviceType),
    typeText: getDeviceTypeName(device && device.DeviceType) || '',
    source
  }
}

/** 一组设备列表 → 选项数组（ID 不是 8 位十六进制的直接跳过） */
function toDeviceOptions(devices, source) {
  return (Array.isArray(devices) ? devices : [])
    .map((device) => toDeviceOption(device, source))
    .filter(Boolean)
}

/**
 * 「播放目标」候选项：手册的设备任务字段表只写**终端设备 ID**，所以四类设备列表全给。
 * ⚠️ 分组写法 `FFFFFFxx` 不在这里（那是临时 / 定时任务 PlayerList 的用法），但允许手输并给出提示。
 */
export function buildTaskPlayerOptions(lists = {}) {
  const options = [
    ['player', '播放终端'],
    ['capturer', '被动采播器'],
    ['actCapturer', '主动采播设备'],
    ['actRequester', '主动插播设备']
  ].flatMap(([key, label]) => toDeviceOptions(lists[key], label))
  return dedupeOptions(options)
}

/** 「对讲被叫方」候选项：只给手册类型表里支持对讲（类型 3）的设备 */
export function buildTalkPlayerOptions(lists = {}) {
  return dedupeOptions(
    buildTaskPlayerOptions(lists).filter((item) => TALK_CAPABLE_TYPE_CODES.includes(item.deviceType))
  )
}

/**
 * 「加入设备任务目录」的候选设备：四类设备列表里，类型属于手册 P79 类型表的那些。
 * ⚠️ 只在本地筛：后端没有「按 DeviceType 筛设备」的接口，所以页面进入时要先把四类列表拉全。
 */
export function buildTaskDeviceCandidates(lists = {}) {
  return dedupeOptions(
    buildTaskPlayerOptions(lists).filter((item) => SUPPORT_TASK_TYPE_CODES.includes(item.deviceType))
  )
}

/**
 * 「采播器」候选项：四类设备都可能当采播源（主动采播器 / 被动采播器 / 对讲设备 / 软件）。
 * ⚠️ 目标设备**自己**永远排在最前：它是 ActCapturer 限定设备的默认采播源（CapturerID 留空即取它）。
 */
export function buildTaskCapturerOptions(lists = {}, { deviceId = '', deviceName = '' } = {}) {
  const selfId = normalizeDeviceTaskId(deviceId)
  const self = isValidDeviceId(selfId)
    ? [
        {
          value: selfId,
          deviceName: deviceName || '本设备',
          label: `${deviceName || '本设备'}（${selfId}）· 本设备`,
          deviceType: '',
          typeText: '',
          source: '本设备'
        }
      ]
    : []
  return dedupeOptions([...self, ...buildTaskPlayerOptions(lists)])
}

/**
 * 「播放内容」候选项：4 位文件 ID。
 * ⚠️ 形如 `FFxx` 的文件 ID 会被 NAS 当成「引用播放列表 xx」而不是文件（与播放列表模块同一套口径），
 *    这里**标出来但不隐藏**（历史数据里可能真有这种 ID），由用户决定。
 */
export function buildTaskFileOptions(files) {
  return (Array.isArray(files) ? files : [])
    .map((file) => {
      const value = normalizeDeviceTaskId(file && file.FileID)
      if (!/^[0-9A-F]{4}$/.test(value)) return null
      const fileName = (file && file.FileName) || '（无文件名）'
      const playlistRef = looksLikePlayListRef(value)
      return {
        value,
        fileName,
        label: `${fileName}（${value}）`,
        disabled: playlistRef,
        hint: playlistRef ? 'FFxx 会被 NAS 当成播放列表引用，不能当文件用' : ''
      }
    })
    .filter(Boolean)
}

/** 内部：设备对象 → 8 位 ID（拿不到就是空串） */
function deviceKeyOf(device) {
  const id = normalizeDeviceTaskId(device && device.DeviceID)
  return isValidDeviceId(id) ? id : ''
}

/** 「设备 ID → 设备对象」的索引（列表页把任务里的 ID 换成名称） */
export function buildDeviceTaskDeviceIndex(lists = {}) {
  const index = {}
  for (const key of ['player', 'capturer', 'actCapturer', 'actRequester']) {
    for (const device of Array.isArray(lists[key]) ? lists[key] : []) {
      const id = deviceKeyOf(device)
      if (id && !index[id]) index[id] = device
    }
  }
  return index
}

/** 设备 ID → 展示文案（查不到就只显示 ID，并标注；分组写法单独说明） */
export function describeTaskPlayerId(deviceId, deviceIndex = {}) {
  const id = normalizeDeviceTaskId(deviceId)
  if (!isValidDeviceId(id)) return '（非法设备 ID）'
  if (looksLikeGroupId(id)) return `${id}（分组写法：设备任务只支持终端 ID）`
  const device = deviceIndex[id]
  return device ? `${id} · ${device.DevName || '未命名'}` : `${id}（设备列表里没有这台设备）`
}

/**
 * 文件 ID → 展示文案。
 * ⚠️ 报警媒体与系统媒体的 FileID **取值范围重叠**，所以来源列表由调用方按设备类型传进来。
 */
export function describeTaskFileId(fileId, files = []) {
  const id = normalizeDeviceTaskId(fileId)
  if (!/^[0-9A-F]{4}$/.test(id)) return '（非法文件 ID）'
  const hit = (Array.isArray(files) ? files : []).find(
    (file) => normalizeDeviceTaskId(file && file.FileID) === id
  )
  return hit ? `${id} · ${hit.FileName || '（无文件名）'}` : `${id}（列表里没有这个文件）`
}









