// src/constants/task.js —— 任务管理模块的枚举字典与纯函数
//
// 取值来源：上游约定见后端 docs/impl-notes.md §三「任务运行管理」（NAS 手册 P52-68）与
// §七「任务优先级」（P81-84）；对外接口契约见 docs/API.md「任务管理模块」。
// 响应字段是 NAS 风格大驼峰（TaskID / TaskSN / TaskType / TaskState / TaskPriority …）。
//
// ⚠️ 三条必须记住的口径：
//   1) **提交端只支持 0 文件播放 / 1 采播 / 7 文字语音**：手册 P62 的类型表里没有对讲任务 3
//      （后端 TempTaskRequestDto 用 @AllowedValues 挡了一道），所以提交表单不给「对讲」选项；
//      但**运行端**（TaskExecList / TaskExecWithDevice）会出现 3；
//   2) `TaskID + TaskSN` 是任务唯一标识：控制任务（停止 / 调音量 / 暂停恢复 / 下一曲）必须**成对**给出，
//      且 `TaskSN` 不能是 `00000000`（手册：为 0 时命令无效）；
//   3) `TaskState` 的语义手册自相矛盾（字段表：0 正在播放 / 1 暂停中 / 2 尚未执行；备注：排队中为 0），
//      本项目**原样展示原始数值 + 手册原文**，不翻译成语义化结论，也不要拿它做业务判断。

import { formatVolume, getDeviceState, isValidDeviceId } from '@/constants/device'
import { looksLikeGroupId } from '@/constants/group'
import { isValidFileId } from '@/constants/media'
import { looksLikePlayListRef } from '@/constants/playlist'

// ---------------- 任务类型 ----------------

/** 任务类型（手册 P53 / P62） */
export const TASK_TYPES = {
  0: '文件播放',
  1: '采播',
  3: '对讲',
  7: '文字语音'
}

export const TASK_TYPE_FILE = 0
export const TASK_TYPE_CAPTURE = 1
export const TASK_TYPE_TALK = 3
export const TASK_TYPE_VOICE = 7

/**
 * **提交端**可选的类型（0 / 1 / 7）——表单的单选项与各自需要的字段说明。
 * ⚠️ 对讲任务（3）不在这里：手册 P62 的类型表没有它，提交会报错（它是运行端才出现的类型）。
 */
export const SUBMITTABLE_TASK_TYPES = [
  {
    value: TASK_TYPE_FILE,
    label: '文件播放',
    hint: '按 FileList 播放：放系统媒体文件（4 位 FileID），也可以放播放列表引用（FFxx）。'
  },
  {
    value: TASK_TYPE_CAPTURE,
    label: '采播',
    hint: '把指定采播器的实时音频广播给播放终端；必须指定结束时间，否则可能一直采下去。'
  },
  {
    value: TASK_TYPE_VOICE,
    label: '文字语音',
    hint: '把文本转成语音播出去（文本 ≤358 个 GBK 字节，约 179 个汉字）。'
  }
]

/** 取任务类型中文名（未知值原样显示，便于排障） */
export function formatTaskType(taskType) {
  const value = Number(taskType)
  if (taskType === null || taskType === undefined || taskType === '' || Number.isNaN(value)) {
    return '未知'
  }
  return TASK_TYPES[value] ? `${value} · ${TASK_TYPES[value]}` : `未知类型（${value}）`
}

// ---------------- 任务状态 ----------------

/**
 * 任务状态 `TaskState`。
 * ⚠️ 手册对它的说明**自相矛盾**：字段表写「0 正在播放、1 暂停中、2 尚未执行（延时等待中）」，
 *    同一处的备注又写「排队中为 0」（后端 docs/impl-notes.md 记为 M5，本项目原样透传）。
 * 这里**只抄手册原文**，不做「0 = 播放中」这类语义化翻译，也不要用它做业务判断 ——
 * 运行中任务列表本身只列出正在执行（含挂起等待）的任务。
 */
export const TASK_STATES = {
  0: '正在播放',
  1: '暂停中',
  2: '尚未执行（延时等待中）'
}

/** `TaskState` 的展示：**原始数值在前**、手册原文在后（不做语义推断，见 TASK_STATES） */
export function describeTaskState(taskState) {
  const value = Number(taskState)
  if (taskState === null || taskState === undefined || taskState === '' || Number.isNaN(value)) {
    return { text: '未知', tag: 'info' }
  }
  // 统一用 info 灰标签：颜色本身会暗示语义，而这里刻意不给语义
  return { text: `${value}（手册：${TASK_STATES[value] || '未列出该取值'}）`, tag: 'info' }
}

/** 页面里对 `TaskState` 的统一提示文案（手册矛盾，本页原样展示） */
export const TASK_STATE_HINT =
  'TaskState 手册自相矛盾（字段表：0 正在播放 / 1 暂停中 / 2 尚未执行；备注：排队中为 0），本页原样展示原始数值，不做语义推断。'

// ---------------- 播放模式与循环 ----------------

/**
 * 播放模式（手册 P54 / P63 一致）。
 * ⚠️ 提交时缺省是 **2 顺序播放**；`playMode` / `loopTimes` 只对文件任务(0) 与文字语音任务(7) 有意义，
 *    采播任务带上它们会被后端拒（@AssertTrue）。
 */
export const PLAY_MODES = {
  0: '单曲播放',
  1: '单曲循环',
  2: '顺序播放',
  3: '列表循环',
  4: '随机播放'
}

/** 给 el-radio-group / el-select 用的选项数组 */
export const PLAY_MODE_OPTIONS = Object.entries(PLAY_MODES).map(([value, label]) => ({
  value: Number(value),
  label
}))

/** 取播放模式中文名（未知值原样显示） */
export function formatPlayMode(playMode) {
  const value = Number(playMode)
  if (playMode === null || playMode === undefined || playMode === '' || Number.isNaN(value)) {
    return '未知'
  }
  return PLAY_MODES[value] || `未知模式（${value}）`
}

/** 循环类播放模式（1 单曲循环 / 3 列表循环）：配合 loopTimes=0（不限）时需要显式结束时间 */
export function isLoopPlayMode(playMode) {
  const value = Number(playMode)
  return value === 1 || value === 3
}

/** 循环次数上限（手册 P63：0 不限、1~31；>31 会被强制成 0） */
export const TASK_LOOP_TIMES_MAX = 31

// ---------------- 启停模式 ----------------

/**
 * 开始时间模式（**提交端**）：1 指定绝对时刻 / 2 即时开始（缺省）/ 3 等待指定时长后再开始。
 * ⚠️ 提交端不支持 0（按星期循环，那是定时任务的模式，会报错）。
 * 本项目的提交弹窗固定用 2 即时开始：定时 / 预约交给「定时任务」模块，避免两处语义混淆。
 */
export const START_MODES = {
  1: '指定绝对时刻',
  2: '即时开始',
  3: '等待指定时长后再开始'
}

/**
 * 结束时间模式（**提交端**）：0 不指定 / 1 指定绝对时刻 / 3 持续指定时长后结束。
 * （运行端只会看到 0 / 1：提交时的 3 在任务开始后会被服务器改写成 1。）
 */
export const END_MODES = {
  0: '不指定（任务会一直运行到被停止）',
  1: '指定绝对时刻结束',
  3: '持续指定时长后结束'
}

/** 日期 / 时间的格式（NAS 要求 `YY-MM-DD` 与 `hh:mm:ss`，两端都按这个写） */
export const TASK_DATE_PATTERN = /^\d{2}-\d{2}-\d{2}$/
export const TASK_TIME_PATTERN = /^\d{2}:\d{2}:\d{2}$/

/** 日期是否合法（`YY-MM-DD`） */
export function isValidTaskDate(value) {
  return TASK_DATE_PATTERN.test(String(value == null ? '' : value).trim())
}

/** 时间是否合法（`hh:mm:ss`；EndMode=3 时它表示**时长**，格式相同） */
export function isValidTaskTime(value) {
  return TASK_TIME_PATTERN.test(String(value == null ? '' : value).trim())
}

/**
 * 这个任务是否**必须**指定结束时间（UI 层强制，后端只做「原则上」的建议，不做校验）。
 *
 * 手册 P64 的三条建议，本项目一律升级为强制（否则任务可能永远不结束、也没法回收终端）：
 *   · 采播任务；
 *   · 随机播放（无法靠「放完一轮」自然结束）；
 *   · 循环播放但循环次数为「不限」。
 *
 * @param {{taskType?: number, playMode?: number, loopTimes?: number}} task 待提交任务的取值
 * @returns {{required: boolean, reason: string}} reason 为空串表示不强制
 */
export function describeEndTimeRequirement({ taskType, playMode, loopTimes } = {}) {
  if (Number(taskType) === TASK_TYPE_CAPTURE) {
    return { required: true, reason: '采播任务必须指定结束时间，否则采播会一直占用采播器与播放终端' }
  }
  if (Number(playMode) === 4) {
    return { required: true, reason: '随机播放无法靠「放完一轮」自然结束，必须指定结束时间' }
  }
  if (isLoopPlayMode(playMode) && Number(loopTimes) === 0) {
    return { required: true, reason: '循环播放且循环次数为「不限」时，必须指定结束时间' }
  }
  return { required: false, reason: '' }
}

// ---------------- 音量 ----------------

/** 任务音量上限：0~127（0 = 0dB 最大、数值越大越小声、127 = 静音） */
export const TASK_VOLUME_MAX = 127

/**
 * 任务音量格式化。
 *
 * ⚠️ 口径与设备基础音量**完全一致**（同一套衰减量语义）：**0 = 0dB（最大）、127 = 静音**；
 *    终端实际音量 = 基础音量 + 任务音量。所以这里直接复用 constants/device.js 的 formatVolume，
 *    免得两个模块出现两种含义。
 * ⚠️ 唯一的差别在**运行端**：列表里的 `TaskVolume` 手册写「<128 正常播放、≥128 静音」，
 *    也就是说运行中的任务音量可能超过提交时的上限（127），这种值一律标注成静音。
 *
 * @param {number|string} volume 音量值
 * @returns {string} 展示文案（缺失时返回 '-'）
 */
export function formatTaskVolume(volume) {
  const value = Number(volume)
  if (volume === null || volume === undefined || volume === '' || Number.isNaN(value)) return '-'
  if (value > TASK_VOLUME_MAX) return `${value}（超过 127：手册标注为静音）`
  return formatVolume(value)
}

// ---------------- 长度 / 数量上限 ----------------

/** 任务名长度上限：31 个 **GBK 字节**（与设备名同口径；中文 / 全角按 2 字节计） */
export const TASK_NAME_MAX_BYTES = 31

/** 文字语音内容上限：358 个 **GBK 字节**（约 179 个汉字，手册 P63） */
export const VOICE_TEXT_MAX_BYTES = 358

/** 一个任务的播放内容（FileList）上限：180 项 */
export const TASK_FILE_MAX = 180

/** 一个任务的播放目标（PlayerList）上限：248 项 */
export const TASK_PLAYER_MAX = 248

/**
 * 优先等级上限：0~15（越大越高；**超过 15 会被 NAS 强制成 15**）。
 * ⚠️ 它只是「同一任务类内」的排队依据，不等于最终 `TaskPriority`
 *    （高 4 位是任务类主优先级，见下方 parseTaskPriority）。
 */
export const TASK_PRIORITY_MAX = 15

// ---------------- ID 校验 ----------------

/** 任务 ID / 任务序列号的正则：8 位十六进制 */
export const TASK_ID_PATTERN = /^[0-9A-Fa-f]{8}$/

/** TaskSN 的禁用值：手册明确「为 0 时命令无效」 */
export const TASK_SN_ZERO = '00000000'

/** 全 0 的 TaskID：管理软件 / 定时任务提交的任务用这个值（HTTP API 提交的是 00000001~00000008） */
export const TASK_ID_ZERO = '00000000'

/** 任务 ID 是否合法（8 位十六进制） */
export function isValidTaskId(taskId) {
  return TASK_ID_PATTERN.test(String(taskId == null ? '' : taskId).trim())
}

/** 任务序列号是否合法（8 位十六进制，且不能是 00000000） */
export function isValidTaskSn(taskSn) {
  const value = String(taskSn == null ? '' : taskSn).trim().toUpperCase()
  return TASK_ID_PATTERN.test(value) && value !== TASK_SN_ZERO
}

/**
 * 任务 ID 的来源判定。
 * 手册：`TaskID` 是 8 位十六进制，**HTTP API 提交的临时任务固定是 `00000001`~`00000008`**（按用户索引），
 * 管理软件 / 定时任务用 `00000000`，分控软件等其它来源是别的值。
 * 用途：列出「这条任务是不是我们（本后端）提交的」——只有这些任务才可能被我们的控制接口有效控制。
 *
 * @param {string} taskId 任务 ID
 * @returns {{kind: 'invalid'|'managed'|'api'|'other', short: string, text: string}}
 */
export function taskIdKind(taskId) {
  const id = String(taskId == null ? '' : taskId).trim().toUpperCase()
  if (!TASK_ID_PATTERN.test(id)) {
    return {
      kind: 'invalid',
      short: 'ID 非法',
      text: `任务 ID 必须是 8 位十六进制（当前：${id || '空'}）`
    }
  }
  if (id === TASK_ID_ZERO) {
    return {
      kind: 'managed',
      short: '管理软件 / 定时',
      text: '00000000：管理软件 / 定时任务提交的任务（不是 HTTP API 提交的临时任务）'
    }
  }
  if (/^0000000[1-8]$/.test(id)) {
    return {
      kind: 'api',
      short: 'HTTP API',
      text: 'HTTP API 提交的临时任务（00000001~00000008，对应用户索引）'
    }
  }
  return {
    kind: 'other',
    short: '其它来源',
    text: '分控软件 / 其它来源提交的任务（不是本后端提交的临时任务）'
  }
}

// ---------------- 任务类（TaskClass）与任务优先级 ----------------

/**
 * 任务类的 13 类定义 + 3 个保留值（手册 §七「任务优先级」，P81-84）。
 *
 * 为什么要在这里维护：`TaskPriority` 的高 4 位（bit15~12）就是「任务类主优先级」，而任务类由**来源**决定 ——
 * **本后端（HTTP API）提交的临时任务固定属于第 11 类「第三方软件插播」**，所以用户能调的只有低位。
 * ⚠️ 手册对第 5 类的用词前后不一致（一处写「消防控制设备」、另一处写「消防紧急报警设备」），此处两个都保留。
 */
export const TASK_CLASSES = {
  1: '自动定时任务',
  2: '普通寻呼对讲话筒',
  3: '主动采播设备',
  4: '紧急主动采播设备',
  5: '消防控制设备 / 消防紧急报警设备',
  6: '无线电遥控设备',
  7: '网络点播设备',
  8: '管理软件插播',
  9: '分控软件插播',
  10: '特定寻呼话筒',
  11: '第三方软件插播（HTTP API 提交的临时任务固定属于此类）',
  12: '对讲面板',
  13: '主动（对讲）终端',
  14: '保留勿用',
  15: '保留勿用',
  16: '保留勿用'
}

/** 取任务类名称（未知值原样显示） */
export function getTaskClassName(taskClass) {
  const value = Number(taskClass)
  if (taskClass === null || taskClass === undefined || taskClass === '' || Number.isNaN(value)) {
    return '未知'
  }
  return TASK_CLASSES[value] || `未定义的任务类（${value}）`
}

/**
 * 拆解 `TaskPriority`（**4 位十六进制**，例：`3001`）。
 *
 * 结构（手册 P81）：「任务类主优先级 + 优先级 + 顺序号」
 *   · bit15~12 **任务类主优先级**：由任务来源（任务类）决定，用户不可配置；
 *   · bit11~8  **优先级**：就是提交任务时填的 `priority`（0~15，越大越高）；
 *   · bit7~0   **顺序号**：同一提交者内部的序号（手册 P82 例子里，HTTP API 用户 00000001 的顺序号是 01）。
 *
 * ⚠️ 所以「把 priority 调到 15」只在**同一个任务类内**起作用，抢不过更高任务类（消防 / 紧急采播 / 寻呼话筒）。
 *
 * @param {string|number} taskPriority NAS 原始值（4 位 hex 字符串）
 * @returns {{raw: string, classPriority: number, applyLevel: number, orderSn: number}|null} 非法值返回 null
 */
export function parseTaskPriority(taskPriority) {
  const raw = String(taskPriority == null ? '' : taskPriority).trim().toUpperCase()
  if (!/^[0-9A-F]{4}$/.test(raw)) return null
  const value = Number.parseInt(raw, 16)
  return {
    raw,
    classPriority: (value >> 12) & 0xf,
    applyLevel: (value >> 8) & 0xf,
    orderSn: value & 0xff
  }
}

// ---------------- 任务控制命令 ----------------

/** 任务控制命令字（`taskCmd`，手册 P66-68） */
export const TASK_COMMANDS = {
  1: '停止指定任务（TaskID + TaskSN）',
  2: '停止所有 TaskID 匹配的任务（只需 TaskID）',
  6: '停止所有正在运行的任务',
  7: '设定指定任务的音量',
  9: '指定任务的进度控制'
}

/** 命令字 9 的动作（`TaskCmdPara`，手册 P67） */
export const TASK_PROGRESS_ACTIONS = {
  0: '无动作（服务器会忽略该命令）',
  1: '暂停 / 恢复',
  2: '上一曲',
  3: '下一曲',
  4: '修改播放模式'
}

/**
 * 控制弹窗里**暴露**的操作（手册允许的命令字里，本项目只开放这 4 个）：
 *   · 命令字 2（停止所有同 TaskID 的任务）没暴露：只需 TaskID 就能一次停一批，语义容易和「停止全部」混淆；
 *   · 命令字 6（停止全部）由列表页的「停止全部」按钮走独立接口 POST /api/tasks/stop-all。
 * 把 needVolume / 说明文案放在这里，免得魔法数字与文案散落在组件里。
 */
export const TASK_CONTROL_OPTIONS = [
  {
    key: 'stop',
    label: '停止任务',
    taskCmd: 1,
    desc: '把这条任务停掉（TaskID + TaskSN 都要对；任务停止后这两个值就失效了，需要重新提交任务）。'
  },
  {
    key: 'volume',
    label: '调整任务音量',
    taskCmd: 7,
    needVolume: true,
    desc: '只改这条任务自己的音量：0 = 最大（0dB）、127 = 静音，数值越大越小声。'
  },
  {
    key: 'pause',
    label: '暂停 / 恢复',
    taskCmd: 9,
    taskCmdPara: 1,
    desc: '一条命令兼管暂停与恢复：对暂停中的任务再发一次就继续播。'
  },
  {
    key: 'next',
    label: '下一曲',
    taskCmd: 9,
    taskCmdPara: 3,
    desc: '跳到当前播放内容的下一条（FileList / 播放列表里还有下一条时才有效）。'
  }
]

/** 控制任务必须成对给出 TaskID + TaskSN 的提示（TaskSN 为 00000000 时 NAS 会拒绝） */
export const TASK_CONTROL_HINT =
  '控制任务必须同时给 TaskID 与 TaskSN（TaskSN 不能是 00000000，否则命令无效）；只有 TaskID 00000001~00000008 才是 HTTP API 提交的临时任务。'

// ---------------- 轮询 ----------------

/** 运行中任务的轮询间隔：默认 5 秒（列表页可开关；离开页面必须 stopPolling） */
export const TASK_POLL_INTERVAL_MS = 5000

// ---------------- 表单 / 列表的展示辅助 ----------------

/** 播放内容规范化：去重 + 大写 + 丢掉非法值，保持顺序（提交前用） */
export function normalizeTaskFileIds(fileList) {
  const seen = new Set()
  const result = []
  ;(Array.isArray(fileList) ? fileList : []).forEach((item) => {
    const id = String(item == null ? '' : item).trim().toUpperCase()
    if (!isValidFileId(id) || seen.has(id)) return
    seen.add(id)
    result.push(id)
  })
  return result
}

/** 播放目标规范化：8 位十六进制（终端 或 FFFFFFxx 分组），去重 + 大写 + 丢非法值，保持顺序 */
export function normalizeTaskPlayerIds(playerList) {
  const seen = new Set()
  const result = []
  ;(Array.isArray(playerList) ? playerList : []).forEach((item) => {
    const id = String(item == null ? '' : item).trim().toUpperCase()
    if (!isValidDeviceId(id) || seen.has(id)) return
    seen.add(id)
    result.push(id)
  })
  return result
}

/**
 * 描述一条播放内容引用（4 位）。
 *
 * ⚠️ 形如 `FFxx` 的值是**播放列表引用**而不是文件 ID：手册规定 FileList 里这两种写法可以混用，
 *    而 `FF` 开头的**系统媒体文件**会被 NAS 当成播放列表引用 —— 所以系统媒体里形如 FFxx 的文件
 *    不能在文件任务里直接引用（与播放列表模块同一套口径）。
 *
 * @param {string} fileId 4 位十六进制（文件）或 FFxx（播放列表）
 * @param {{mediaFiles?: Array, playLists?: Array}} sources 系统媒体文件与播放列表（NAS 原始字段）
 * @returns {{fileId: string, kind: 'file'|'playlist'|'invalid', name: string, known: boolean}}
 */
export function describeTaskFile(fileId, { mediaFiles = [], playLists = [] } = {}) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  if (!isValidFileId(id)) {
    return { fileId: id, kind: 'invalid', name: '', known: false }
  }
  if (looksLikePlayListRef(id)) {
    const refId = id.slice(2)
    const playList = (Array.isArray(playLists) ? playLists : []).find(
      (item) => String(item.PlayListID == null ? '' : item.PlayListID).trim().toUpperCase() === refId
    )
    return {
      fileId: id,
      kind: 'playlist',
      name: playList ? String(playList.PlayListName || '') : '',
      known: Boolean(playList)
    }
  }
  const file = (Array.isArray(mediaFiles) ? mediaFiles : []).find(
    (item) => String(item.FileID == null ? '' : item.FileID).trim().toUpperCase() === id
  )
  return {
    fileId: id,
    kind: 'file',
    name: file ? String(file.FileName || '') : '',
    known: Boolean(file)
  }
}

/**
 * 描述一个播放目标（8 位）：终端设备 ID，或 `FFFFFFxx` 分组引用。
 * 查不到对象的**不隐藏**，而是标注出来（设备 / 分组可能已删除，但任务里仍留着它的 ID）。
 *
 * @param {string} playerId 8 位十六进制
 * @param {{devices?: Array, groups?: Array}} sources 播放终端列表与分组列表（NAS 原始字段）
 * @returns {{playerId: string, kind: 'terminal'|'group'|'invalid', name: string, known: boolean,
 *   state: object|null}}
 */
export function describeTaskPlayer(playerId, { devices = [], groups = [] } = {}) {
  const id = String(playerId == null ? '' : playerId).trim().toUpperCase()
  if (!isValidDeviceId(id)) {
    return { playerId: id, kind: 'invalid', name: '', known: false, state: null }
  }
  if (looksLikeGroupId(id)) {
    const groupId = id.slice(-2)
    const group = (Array.isArray(groups) ? groups : []).find(
      (item) => String(item.GroupID == null ? '' : item.GroupID).trim().toUpperCase() === groupId
    )
    return {
      playerId: id,
      kind: 'group',
      name: group ? String(group.GroupName || '') : '',
      known: Boolean(group),
      state: null
    }
  }
  const device = (Array.isArray(devices) ? devices : []).find(
    (item) => String(item.DeviceID == null ? '' : item.DeviceID).trim().toUpperCase() === id
  )
  return {
    playerId: id,
    kind: 'terminal',
    name: device ? String(device.DevName || '') : '',
    known: Boolean(device),
    state: device ? getDeviceState(device.State) : null
  }
}

/**
 * «指定设备参与的任务» 查询结果的判空。
 *
 * ⚠️ 手册 P58-60：查不到相关任务时**响应里除 `DataType` / `Result` 外字段全部缺席**
 *    （不是字段存在但为空，而是根本没有这些 key），所以不能直接读 `TaskName` 之类。
 *
 * @param {object|null} result GET /api/tasks/with-device/{deviceId} 的响应
 * @returns {boolean} 是否真的返回了一条任务
 */
export function hasTaskWithDevice(result) {
  if (!result) return false
  return Boolean(
    result.TaskID || result.TaskSN || result.TaskName || result.CapturerID || result.PlayerID
  )
}
