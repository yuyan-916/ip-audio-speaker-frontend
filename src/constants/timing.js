// src/constants/timing.js —— 定时任务 / 定时程序模块的枚举字典与纯函数（不含请求）
//
// 取值来源：后端 `docs/impl-notes.md` §四（定时任务，NAS 手册 P34-44）/ §五（定时程序，P44-52），
// 对外契约见 `backend/docs/API.md` 的「定时任务模块」。响应字段是 NAS 风格大驼峰：
// TaskIndex / Disable / TaskType / StartMode / EndMode / StartDate / StartTime / EndDate / EndTime /
// WeekDay / **PreOnAMP** / PlayMode / LoopTimes / TaskVolume / **CapturerID** / VoiceText / FileList / PlayerList。
//
// ⚠️ 定时任务与「任务管理（/tasks）」里的**临时任务是两套东西**，别把两边的枚举互相套用：
//   · 类型只有 0 文件播放 / 1 采播 / 7 文字语音（**没有对讲 3**）；
//   · `startMode` 只有 0 按星期循环 / 1 指定绝对时刻（没有 2 即时开始、3 等待指定时长）；
//   · `endMode` 只有 0 不指定 / 1 指定时刻结束（没有 3 持续指定时长）；
//   · 多出 `disable`（0 使能 / 1 禁用）、`preOnAmp`（提前开功放的秒数 0~15）、`weekDay`（7 位 0/1 串）。
// ⚠️ 三条 NAS 侧无法校验、只能写进 UI 的口径：
//   1) 定时任务**先配置、到时自动执行**：创建时不校验文件是否存在 / 设备是否在线，**只有真正执行时才检索**
//      —— 「能建成功」不等于「能放出来」；
//   2) 定时任务**只用系统媒体文件**（FileList 里的 ID 必须是**系统媒体**的 ID，报警 / 分控媒体的 ID 语法合法但不会响）；
//   3) `WeekDay` 从左到右是 **周日…周六**（顺序反直觉，最容易写反），且**不能是 `0000000`**。

import {
  TASK_FILE_MAX,
  TASK_LOOP_TIMES_MAX,
  TASK_NAME_MAX_BYTES,
  TASK_PLAYER_MAX,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_FILE,
  TASK_TYPE_VOICE,
  TASK_VOLUME_MAX,
  VOICE_TEXT_MAX_BYTES,
  formatTaskType,
  formatTaskVolume,
  isValidTaskDate,
  isValidTaskTime,
  normalizeTaskFileIds,
  normalizeTaskPlayerIds
} from '@/constants/task'

/** 定时任务的三种类型：0 文件播放 / 1 采播 / 7 文字语音（与临时任务同名同义，少的只有「对讲 3」） */
export const TIMING_TASK_TYPES = {
  [TASK_TYPE_FILE]: '文件播放',
  [TASK_TYPE_CAPTURE]: '采播',
  [TASK_TYPE_VOICE]: '文字语音'
}

/** 表单里的类型单选项（hint 说明该类型必须提供的「内容」字段） */
export const TIMING_TASK_TYPE_OPTIONS = [
  {
    value: TASK_TYPE_FILE,
    label: '文件播放',
    hint: '按 FileList 播放：放**系统媒体**文件（4 位 FileID），也可以放播放列表引用（FFxx）。'
  },
  {
    value: TASK_TYPE_CAPTURE,
    label: '采播',
    hint: '把指定采播器的实时音频广播给播放终端；必须指定结束时刻（否则采播会一直占着采播器与终端）。'
  },
  {
    value: TASK_TYPE_VOICE,
    label: '文字语音',
    hint: '把文本转成语音播出去（文本 ≤358 个 GBK 字节，约 179 个汉字）。'
  }
]

/** 取任务类型中文名：类型名与临时任务一致，直接复用 constants/task.js 的实现（含 `0 · 文件播放` 前缀） */
export const formatTimingTaskType = formatTaskType

// ---------------- 类型常量透出 ----------------
//
// 定时任务的类型与临时任务**同名同义**（0 文件播放 / 1 采播 / 7 文字语音），直接透出 constants/task.js 的常量，
// 让只用 timing 模块的组件不必再 import 一次 constants/task.js（少的那一个只有「对讲 3」）。

export { TASK_TYPE_CAPTURE, TASK_TYPE_FILE, TASK_TYPE_VOICE }

// ---------------- 数量与长度上限 ----------------
//
// ⚠️ 下面这套上限与临时任务**完全同口径**（手册里也是同一张字段表），所以直接引用 constants/task.js
//    的常量而不是再抄一遍数值，免得两处数值漂移；只有 preOnAmp / playMode 是定时任务侧新增的。

/** 任务名上限：31 个 GBK 字节（中文 / 全角按 2 字节计） */
export const TIMING_TASK_NAME_MAX_BYTES = TASK_NAME_MAX_BYTES
/**
 * ⚠️ 程序名上限是 **39 个字符**（不是字节！手册 P44-46 与后端 `@Size(max = 39)` 都是「字符」），
 * 与任务名的「31 个 GBK 字节」**不是一套口径**，别拿 gbkByteLength 来校验程序名。
 * 程序名只用于显示、**不作为标识**（留空也正常）。
 */
export const TIMING_PROGRAM_NAME_MAX_CHARS = 39
/** 文字语音文本上限：358 个 GBK 字节（约 179 个汉字） */
export const TIMING_VOICE_TEXT_MAX_BYTES = VOICE_TEXT_MAX_BYTES
/** 一个任务的播放内容（FileList）上限：180 项 */
export const TIMING_FILE_MAX = TASK_FILE_MAX
/** 一个任务的播放目标（PlayerList）上限：248 项 */
export const TIMING_PLAYER_MAX = TASK_PLAYER_MAX
/** 任务音量上限：0~127（0 = 0dB 最大、数值越大越小声、127 = 静音） */
export const TIMING_VOLUME_MAX = TASK_VOLUME_MAX
/** 循环次数上限：0 不限、1~31 */
export const TIMING_LOOP_TIMES_MAX = TASK_LOOP_TIMES_MAX
/** 播放模式上限：0~4（0 单曲 / 1 单曲循环 / 2 顺序 / 3 列表循环 / 4 随机），仅文件与文字语音任务 */
export const TIMING_PLAY_MODE_MAX = 4
/** 提前打开功放的秒数上限：0~15（终端功放上电到出声有延迟，提前开能避免前几秒被吞掉） */
export const TIMING_PRE_ON_AMP_MAX = 15

/** 日期 / 时间格式与临时任务一致（`YY-MM-DD` / `hh:mm:ss`），共用同一套校验 */
export const isValidTimingDate = isValidTaskDate
export const isValidTimingTime = isValidTaskTime
/** 任务音量文案：与临时任务共用一套口径（0 = 最大、127 = 静音） */
export const formatTimingVolume = formatTaskVolume

/** 提前开功放字段的提示文案（表单用） */
export const TIMING_PRE_ON_AMP_HINT =
  '提前打开功放的秒数 0~15：终端功放上电到出声有延迟，提前开可以避免任务开头几秒被吞掉。'

// ---------------- 定时程序与任务序号 ----------------

/** 系统固定 16 套定时程序（ProgramName / ProgramComb 的元素个数也是它） */
export const TIMING_PROGRAM_COUNT = 16
export const TIMING_PROGRAM_INDEX_MIN = 1
export const TIMING_PROGRAM_INDEX_MAX = 16
/** 单个程序内的定时任务序号上限：1~248（**新建时由 NAS 分配，不能自己填**） */
export const TIMING_TASK_INDEX_MAX = 248

/** 程序序号是否合法（1~16） */
export function isValidProgramIndex(value) {
  const num = Number(value)
  return Number.isInteger(num) && num >= TIMING_PROGRAM_INDEX_MIN && num <= TIMING_PROGRAM_INDEX_MAX
}

/** 任务序号是否合法（1~248；只有编辑 / 删除才需要） */
export function isValidTimingTaskIndex(value) {
  const num = Number(value)
  return Number.isInteger(num) && num >= 1 && num <= TIMING_TASK_INDEX_MAX
}

/**
 * 生成 16 个程序的下拉选项。
 * 程序名只是辅助显示（**不作为标识**，空名也正常），所以空名时只显示序号。
 *
 * @param {string[]} programNames NAS `ProgramName` 数组（可缺省）
 * @returns {Array<{value: number, label: string}>}
 */
export function programOptions(programNames = []) {
  const names = Array.isArray(programNames) ? programNames : []
  return Array.from({ length: TIMING_PROGRAM_COUNT }, (_, index) => {
    const value = index + 1
    const name = String(names[index] == null ? '' : names[index]).trim()
    return { value, label: name ? `程序 ${value}｜${name}` : `程序 ${value}` }
  })
}

/** 单个程序的可读标签：`程序 3｜夏季` / `程序 3` */
export function programLabel(programIndex, programNames = []) {
  const names = Array.isArray(programNames) ? programNames : []
  const value = Number(programIndex)
  const name = isValidProgramIndex(value)
    ? String(names[value - 1] == null ? '' : names[value - 1]).trim()
    : ''
  return name ? `程序 ${value}｜${name}` : `程序 ${value}`
}

// ---------------- 星期（WeekDay） ----------------

/** 星期的展示顺序：与 `WeekDay` 串的位序**一致** —— 左→右 = 周日…周六 */
export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
/** 全 0 的星期串：NAS 会拒绝（`0000000` 表示哪一天都不执行） */
export const WEEKDAY_EMPTY = '0000000'
/** 每天 */
export const WEEKDAY_EVERY = '1111111'
export const WEEKDAY_PATTERN = /^[01]{7}$/

/** 按星期循环模式的提示（表单用：把「从左到右是周日…周六」写清楚） */
export const WEEKDAY_HINT =
  '勾选框顺序是 日 一 二 三 四 五 六，对应 WeekDay 字符串从左到右的 7 位（1 = 执行、0 = 不执行）；至少要勾一天。'

/** 星期串是否可用（7 位 0/1 且不全为 0） */
export function isValidWeekDay(value) {
  const text = String(value == null ? '' : value).trim()
  return WEEKDAY_PATTERN.test(text) && text !== WEEKDAY_EMPTY
}

/** 星期串 → 勾选项下标数组（0 = 周日 … 6 = 周六；非法串返回空数组） */
export function weekDayToIndexes(value) {
  const text = String(value == null ? '' : value).trim()
  if (!WEEKDAY_PATTERN.test(text)) return []
  return WEEKDAY_LABELS.map((_, index) => index).filter((index) => text[index] === '1')
}

/** 勾选项下标数组 → 星期串（补齐 7 位；越界 / 重复自动忽略） */
export function weekDayFromIndexes(indexes) {
  const picked = new Set((Array.isArray(indexes) ? indexes : []).map((item) => Number(item)))
  return WEEKDAY_LABELS.map((_, index) => (picked.has(index) ? '1' : '0')).join('')
}

/**
 * 星期串的可读文案：`每天` / `周一、三` / `周一~五` / `（未选任何一天）` / `（星期串非法：x）`。
 * 连续的星期会合成区间（`周一~五`），避免「一、二、三、四、五」这种长串。
 */
export function describeWeekDay(value) {
  const text = String(value == null ? '' : value).trim()
  if (!text) return '（缺少星期设置）'
  if (!WEEKDAY_PATTERN.test(text)) return `（星期串非法：${text}）`
  if (text === WEEKDAY_EMPTY) return '（未选任何一天）'
  if (text === WEEKDAY_EVERY) return '每天'
  const parts = []
  let start = -1
  for (let index = 0; index <= WEEKDAY_LABELS.length; index += 1) {
    const hit = index < WEEKDAY_LABELS.length && text[index] === '1'
    if (hit && start < 0) start = index
    if (!hit && start >= 0) {
      parts.push(
        start === index - 1
          ? `周${WEEKDAY_LABELS[start]}`
          : `周${WEEKDAY_LABELS[start]}~${WEEKDAY_LABELS[index - 1]}`
      )
      start = -1
    }
  }
  return parts.join('、')
}

// ---------------- 启停模式（定时任务专属，取值域比临时任务窄） ----------------

/** 开始时间模式：⚠️ **没有** 2 即时开始 / 3 等待指定时长（那是提交临时任务才有的） */
export const TIMING_START_MODES = {
  0: '按星期循环',
  1: '指定绝对时刻'
}

/** 结束时间模式：⚠️ **没有** 3 持续指定时长 */
export const TIMING_END_MODES = {
  0: '不指定',
  1: '指定时刻结束'
}

/** 表单里的开始模式单选项 */
export const TIMING_START_MODE_OPTIONS = [
  { value: 0, label: '按星期循环', hint: '每周在勾选的星期 + 开始时刻执行（必须勾至少一天）。' },
  { value: 1, label: '指定绝对时刻', hint: '只在「开始日期 + 开始时刻」那一刻执行（必须给开始日期）。' }
]

/** 表单里的结束模式单选项 */
export const TIMING_END_MODE_OPTIONS = [
  { value: 0, label: '不指定', hint: '任务自然结束（文件放完 / 循环次数用完）。' },
  { value: 1, label: '指定时刻结束', hint: '到结束时刻强制结束；绝对时刻开始时还要给结束日期。' }
]

/** 取开始模式文案 */
export function formatTimingStartMode(value) {
  const num = Number(value)
  if (value === null || value === undefined || value === '' || Number.isNaN(num)) return '未知'
  return TIMING_START_MODES[num] || `未知模式（${num}）`
}

/** 取结束模式文案 */
export function formatTimingEndMode(value) {
  const num = Number(value)
  if (value === null || value === undefined || value === '' || Number.isNaN(num)) return '未知'
  return TIMING_END_MODES[num] || `未知模式（${num}）`
}

// ---------------- 使能状态（Disable） ----------------

/**
 * `Disable` 的两种取值。
 * ⚠️ 「禁用」只是**不执行**：任务仍留在程序里、仍占着序号，不是删除。
 */
export const TIMING_DISABLE_STATES = {
  0: { text: '使能', tag: 'success', hint: '到时正常执行' },
  1: { text: '禁用', tag: 'info', hint: '保留在程序里但不执行' }
}

/** 使能状态文案（未知值原样显示） */
export function describeTimingDisable(disable) {
  const num = Number(disable)
  if (disable === null || disable === undefined || disable === '' || Number.isNaN(num)) {
    return { text: '未知', tag: 'info' }
  }
  return TIMING_DISABLE_STATES[num] || { text: `未知取值（${num}）`, tag: 'warning' }
}

/** 这条定时任务是否被禁用（缺省 0 使能） */
export function isTimingTaskDisabled(task) {
  return Number(task && task.Disable) === 1
}

// ---------------- 当前执行程序（CurrentProgram，取值 1~24） ----------------

export const CURRENT_PROGRAM_MIN = 1
export const CURRENT_PROGRAM_MAX = 24
/** 20 = 无程序（系统不执行任何定时任务） */
export const CURRENT_PROGRAM_NONE = 20
/** 17~19 是三个**固定组合**（不是程序序号，改不了它们的含义） */
export const FIXED_PROGRAM_COMB_LABELS = {
  17: '程序 1~8 固定组合',
  18: '程序 9~16 固定组合',
  19: '程序 1~16 全体组合'
}
/** 21~24 = 自定义组合 1~4，对应 ProgramComb 数组的第 1~4 个编码 */
export const CUSTOM_PROGRAM_COMB_MIN = 21

/** 当前执行程序取值是否合法（1~24） */
export function isValidCurrentProgram(value) {
  const num = Number(value)
  return Number.isInteger(num) && num >= CURRENT_PROGRAM_MIN && num <= CURRENT_PROGRAM_MAX
}

/**
 * 描述「当前执行程序」这个取值（**它不只是程序序号**，17~24 是组合 / 空）。
 *
 * @param {number} currentProgram NAS `CurrentProgram`
 * @param {string[]} programNames `ProgramName` 数组（用于把序号翻成名字）
 * @returns {{value: number, text: string, tag: string}} tag 给 el-tag 用
 */
export function describeCurrentProgram(currentProgram, programNames = []) {
  const value = Number(currentProgram)
  if (!isValidCurrentProgram(value)) {
    return { value: Number.isNaN(value) ? null : value, text: '（未读取）', tag: 'info' }
  }
  if (value >= CURRENT_PROGRAM_MIN && value <= TIMING_PROGRAM_INDEX_MAX) {
    return { value, text: programLabel(value, programNames), tag: 'success' }
  }
  if (FIXED_PROGRAM_COMB_LABELS[value]) {
    return { value, text: FIXED_PROGRAM_COMB_LABELS[value], tag: 'success' }
  }
  if (value === CURRENT_PROGRAM_NONE) {
    return { value, text: '无程序（不执行任何定时任务）', tag: 'info' }
  }
  return { value, text: `自定义组合 ${value - CUSTOM_PROGRAM_COMB_MIN + 1}`, tag: 'success' }
}

/** 生成「当前执行程序」下拉选项（1~16 带程序名，17~24 用固定文案） */
export function currentProgramOptions(programNames = []) {
  const names = Array.isArray(programNames) ? programNames : []
  const fixed = Object.entries(FIXED_PROGRAM_COMB_LABELS).map(([value, label]) => ({
    value: Number(value),
    label
  }))
  const custom = [0, 1, 2, 3].map((offset) => ({
    value: CUSTOM_PROGRAM_COMB_MIN + offset,
    label: `自定义组合 ${offset + 1}（用程序组合编码 ${offset + 1}）`
  }))
  return [
    ...programOptions(names),
    ...fixed,
    { value: CURRENT_PROGRAM_NONE, label: '无程序（不执行任何定时任务）' },
    ...custom
  ]
}

// ---------------- 程序组合编码（ProgramComb，固定 4 条） ----------------

/** 组合编码固定 4 条 */
export const PROGRAM_COMB_COUNT = 4
/** 每条编码固定 16 位 0/1（左→右对应程序 1~16，1 = 组合里包含它） */
export const PROGRAM_COMB_PATTERN = /^[01]{16}$/
export const EMPTY_PROGRAM_COMB = '0'.repeat(16)

export const PROGRAM_COMB_HINT =
  '16 位 0/1 从左到右对应程序 1~16（1 = 组合里包含它）；把「当前执行程序」设成 21~24 就是用自定义组合 1~4。'

/** 单条组合编码是否合法（16 位 0/1） */
export function isValidProgramComb(value) {
  return PROGRAM_COMB_PATTERN.test(String(value == null ? '' : value).trim())
}

/** 把任意输入整理成 4 条合法编码（缺的补空编码，多的裁掉，非法串丢掉） */
export function normalizeProgramCombs(combs) {
  const list = Array.isArray(combs) ? combs : []
  return Array.from({ length: PROGRAM_COMB_COUNT }, (_, index) => {
    const text = String(list[index] == null ? '' : list[index]).trim()
    return isValidProgramComb(text) ? text : EMPTY_PROGRAM_COMB
  })
}

/** 组合编码 → 包含的程序号数组（例：`1100…0` → `[1, 2]`） */
export function combProgramNumbers(comb) {
  const text = String(comb == null ? '' : comb).trim()
  if (!isValidProgramComb(text)) return []
  return text
    .split('')
    .map((bit, index) => (bit === '1' ? index + 1 : 0))
    .filter((value) => value > 0)
}

/** 组合编码的可读文案：`程序 1、程序 2` / `（空组合：不含任何程序）` */
export function describeProgramComb(comb, programNames = []) {
  const numbers = combProgramNumbers(comb)
  if (!numbers.length) return '（空组合：不含任何程序）'
  return numbers.map((value) => programLabel(value, programNames)).join('、')
}

// ---------------- 静默时段（SilenceTime） ----------------

/** 静默时段的四个时间字段（NAS **未设置时回的是空对象 `{}`**） */
export const SILENCE_TIME_FIELDS = ['startDate', 'startTime', 'endDate', 'endTime']

export const SILENCE_TIME_HINT =
  '静默期内 NAS **不执行任何定时任务**（期间的定时设置一律被忽略）；要清除静默时段，在「配置程序」里勾上这一段并选「清除静默时段」。'

/** 静默时段是否已设置（四个字段齐全才算；只填一半是脏数据，按「未设置」处理并提示） */
export function isSilenceTimeSet(silenceTime) {
  if (!silenceTime || typeof silenceTime !== 'object') return false
  return SILENCE_TIME_FIELDS.every((key) =>
    Boolean(String(silenceTime[key] == null ? '' : silenceTime[key]).trim())
  )
}

/** 取出静默时段的四个字段（缺失补空串，方便直接绑到表单） */
export function normalizeSilenceTime(silenceTime) {
  const source = silenceTime && typeof silenceTime === 'object' ? silenceTime : {}
  return {
    startDate: String(source.startDate == null ? '' : source.startDate).trim(),
    startTime: String(source.startTime == null ? '' : source.startTime).trim(),
    endDate: String(source.endDate == null ? '' : source.endDate).trim(),
    endTime: String(source.endTime == null ? '' : source.endTime).trim()
  }
}

/** 静默时段的可读文案：`24-10-12 13:00:00 → 24-10-15 10:00:00` / `未设置（不静默）` */
export function describeSilenceTime(silenceTime) {
  const value = normalizeSilenceTime(silenceTime)
  if (!isSilenceTimeSet(value)) {
    const filled = SILENCE_TIME_FIELDS.filter((key) => value[key])
    return {
      set: false,
      text: filled.length ? `字段不完整（只填了 ${filled.length}/4 个）` : '未设置（不静默）'
    }
  }
  return { set: true, text: `${value.startDate} ${value.startTime} → ${value.endDate} ${value.endTime}` }
}

/**
 * 校验「要写入的静默时段」四个字段，返回第一条问题（'' 表示通过）。
 * 空时段请用「清除」而不是发空字段 —— 所以这里全空也算问题。
 */
export function silenceTimeProblem(draft) {
  const value = normalizeSilenceTime(draft)
  if (!value.startDate && !value.startTime && !value.endDate && !value.endTime) {
    return '要么四个时间字段都填，要么整段清除（选「清除静默时段」）'
  }
  if (!isValidTimingDate(value.startDate)) return '静默开始日期应形如 24-10-12'
  if (!isValidTimingTime(value.startTime)) return '静默开始时刻应形如 13:00:00'
  if (!isValidTimingDate(value.endDate)) return '静默结束日期应形如 24-10-15'
  if (!isValidTimingTime(value.endTime)) return '静默结束时刻应形如 10:00:00'
  return ''
}

// ---------------- 自动切换设置（AutoProgram） ----------------

/** 自动切换设置最多 7 条（`AutoProgIdx` 1~7，**不能重复**，重复会被 NAS 判 Result=4） */
export const AUTO_PROGRAM_MAX = 7
export const AUTO_PROG_IDX_MIN = 1
export const AUTO_PROG_IDX_MAX = 7

export const AUTO_PROGRAM_HINT =
  '最多 7 条：进入时段即执行对应程序，时段外执行「当前执行程序」；多条时段重叠时 **AutoProgIdx 小的优先**。'

/** 整理自动切换条目（只保留字段结构，不做业务校验 —— 校验见 autoProgramProblem） */
export function normalizeAutoPrograms(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    autoProgIdx: Number(row && row.autoProgIdx),
    programIndex: Number(row && row.programIndex),
    startDate: String((row && row.startDate) == null ? '' : row.startDate).trim(),
    startTime: String((row && row.startTime) == null ? '' : row.startTime).trim(),
    endDate: String((row && row.endDate) == null ? '' : row.endDate).trim(),
    endTime: String((row && row.endTime) == null ? '' : row.endTime).trim()
  }))
}

/** 一条自动切换设置的可读文案 */
export function describeAutoProgram(item, programNames = []) {
  const row = item || {}
  const idx = Number(row.AutoProgIdx == null ? row.autoProgIdx : row.AutoProgIdx)
  const target = Number(row.ProgramIndex == null ? row.programIndex : row.ProgramIndex)
  const startDate = String(row.StartDate == null ? row.startDate : row.StartDate || '').trim()
  const startTime = String(row.StartTime == null ? row.startTime : row.StartTime || '').trim()
  const endDate = String(row.EndDate == null ? row.endDate : row.EndDate || '').trim()
  const endTime = String(row.EndTime == null ? row.endTime : row.EndTime || '').trim()
  return `序号 ${idx}：${programLabel(target, programNames)}　${startDate} ${startTime} → ${endDate} ${endTime}`
}

/**
 * 校验自动切换条目，返回第一条问题（'' 表示通过）。
 * 空数组是**合法**的（`autoProgram: []` = 清除全部自动切换设置），所以这里不报错。
 */
export function autoProgramProblem(rows) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length > AUTO_PROGRAM_MAX) {
    return `最多 ${AUTO_PROGRAM_MAX} 条自动切换设置（当前 ${list.length} 条）`
  }
  const seen = new Set()
  for (let index = 0; index < list.length; index += 1) {
    const row = normalizeAutoPrograms([list[index]])[0]
    const no = index + 1
    if (!Number.isInteger(row.autoProgIdx) || row.autoProgIdx < AUTO_PROG_IDX_MIN || row.autoProgIdx > AUTO_PROG_IDX_MAX) {
      return `第 ${no} 条：序号（AutoProgIdx）必须是 ${AUTO_PROG_IDX_MIN}~${AUTO_PROG_IDX_MAX} 的整数`
    }
    if (seen.has(row.autoProgIdx)) {
      return `第 ${no} 条：序号 ${row.autoProgIdx} 与前面的条目重复（NAS 会报 Result=4）`
    }
    seen.add(row.autoProgIdx)
    if (!isValidCurrentProgram(row.programIndex)) {
      return `第 ${no} 条：程序号必须是 ${CURRENT_PROGRAM_MIN}~${CURRENT_PROGRAM_MAX} 的整数`
    }
    if (!isValidTimingDate(row.startDate)) return `第 ${no} 条：开始日期应形如 24-11-01`
    if (!isValidTimingTime(row.startTime)) return `第 ${no} 条：开始时刻应形如 08:00:00`
    if (!isValidTimingDate(row.endDate)) return `第 ${no} 条：结束日期应形如 24-11-02`
    if (!isValidTimingTime(row.endTime)) return `第 ${no} 条：结束时刻应形如 20:00:00`
  }
  return ''
}

// ---------------- 定时程序操作（清除 / 复制 / 剪切） ----------------

/**
 * 三个程序级操作（`POST /api/timing/program/set` 的 `action`）。
 * ⚠️ 复制与剪切**会覆盖目标程序原有的全部定时任务**，所以 UI 必须二次确认（`programSetWarning`）。
 * 三者都只影响程序内的**任务**，不改程序名 / 程序组合 / 静默时段 / 自动切换。
 */
export const TIMING_PROGRAM_ACTIONS = [
  {
    value: 'CLEAR',
    label: '清除程序',
    danger: true,
    needTarget: false,
    summary: '删除该程序内的**全部**定时任务（最多 248 条）。程序名等其他参数不变。'
  },
  {
    value: 'COPY',
    label: '复制程序',
    danger: false,
    needTarget: true,
    summary: '把源程序的任务**整体复制**到目标程序；目标程序原有的任务会被**覆盖**，源程序保持不变。'
  },
  {
    value: 'CUT',
    label: '剪切程序',
    danger: true,
    needTarget: true,
    summary: '把源程序的任务**搬**到目标程序；目标程序原有的任务会被**覆盖**，源程序的任务被清空。'
  }
]

/** 取操作的元信息（非法值返回 null） */
export function findTimingProgramAction(action) {
  const key = String(action == null ? '' : action).trim().toUpperCase()
  return TIMING_PROGRAM_ACTIONS.find((item) => item.value === key) || null
}

/** 操作说明下方的统一提示 */
export const TIMING_PROGRAM_SET_NOTE =
  '这三个操作都只动「程序内的定时任务」，不改程序名 / 程序组合 / 静默时段 / 自动切换；被覆盖掉的旧任务无法找回。'

/**
 * 校验程序操作参数，返回第一条问题（'' 表示通过）。
 * 与后端 `TimingProgramOperateRequestDto` 的规则一致：COPY / CUT 必须给目标程序且不能与源相同。
 */
export function programSetProblem({ action, programIndex, programIndex1 } = {}) {
  const meta = findTimingProgramAction(action)
  if (!meta) return '请选择要执行的操作（清除 / 复制 / 剪切）'
  if (!isValidProgramIndex(programIndex)) {
    return `源程序号必须是 ${TIMING_PROGRAM_INDEX_MIN}~${TIMING_PROGRAM_INDEX_MAX} 的整数`
  }
  if (!meta.needTarget) return ''
  if (!isValidProgramIndex(programIndex1)) {
    return `目标程序号必须是 ${TIMING_PROGRAM_INDEX_MIN}~${TIMING_PROGRAM_INDEX_MAX} 的整数`
  }
  if (Number(programIndex1) === Number(programIndex)) return '目标程序不能与源程序相同'
  return ''
}

/**
 * 生成二次确认文案（页面的警告条与 `ElMessageBox.confirm` 共用一份，避免两处口径不一致）。
 *
 * @param {string} action CLEAR / COPY / CUT
 * @param {string} sourceLabel 源程序标签
 * @param {string} targetLabel 目标程序标签
 * @returns {string}
 */
export function programSetWarning(action, sourceLabel, targetLabel) {
  const meta = findTimingProgramAction(action)
  if (!meta) return ''
  if (meta.value === 'CLEAR') {
    return `确定要清除「${sourceLabel}」内的全部定时任务吗？此操作不可撤销（程序名等其他参数不受影响）。`
  }
  const verb = meta.value === 'COPY' ? '复制' : '剪切'
  const extra = meta.value === 'CUT' ? '（源程序会被清空）' : ''
  return `确定要把「${sourceLabel}」的定时任务${verb}${extra}到「${targetLabel}」吗？目标程序「${targetLabel}」原有的全部定时任务会被覆盖，且无法找回。`
}

// ---------------- 列表展示辅助 ----------------

/** 定时任务列表页的总体提示（「先配置、到时执行」这条口径必须显眼） */
export const TIMING_TASK_HINT =
  '定时任务是「先配置、到时自动执行」：NAS 创建时**不校验文件是否存在、设备是否在线**，只有真正执行时才检索 —— 所以「能建成功」不代表「能放出来」。'

/** 定时任务只能使用系统媒体文件 */
export const TIMING_SYSTEM_MEDIA_HINT = '定时任务的播放内容只支持**系统媒体文件**（报警 / 分控媒体不会响）。'

/**
 * 触发时间的可读文案。
 * @param {object} task NAS 行（StartMode / StartDate / StartTime / WeekDay）
 * @returns {string} `每天 08:10:00` / `每周一、三、五 08:10:00` / `绝对时刻 26-09-30 08:10:00`
 */
export function describeTimingTrigger(task) {
  const source = task || {}
  const time = String(source.StartTime == null ? '' : source.StartTime).trim() || '（缺开始时间）'
  if (Number(source.StartMode) === 1) {
    const date = String(source.StartDate == null ? '' : source.StartDate).trim()
    return `绝对时刻 ${date || '（缺开始日期）'} ${time}`
  }
  const weekDay = String(source.WeekDay == null ? '' : source.WeekDay).trim()
  if (!WEEKDAY_PATTERN.test(weekDay) || weekDay === WEEKDAY_EMPTY) {
    return `按星期循环 ${time}（星期设置异常：${weekDay || '空'}）`
  }
  return `${weekDay === WEEKDAY_EVERY ? '每天' : `每${describeWeekDay(weekDay)}`} ${time}`
}

/**
 * 结束方式的可读文案。
 * ⚠️ `EndDate` 只在**绝对时刻开始**时才有意义（按星期循环时结束时刻是「每一次执行的当日时刻」）。
 */
export function describeTimingEnd(task) {
  const source = task || {}
  if (Number(source.EndMode) !== 1) return '不指定（任务自然结束）'
  const time = String(source.EndTime == null ? '' : source.EndTime).trim() || '（缺结束时间）'
  const date = String(source.EndDate == null ? '' : source.EndDate).trim()
  if (Number(source.StartMode) === 1) return `到 ${date || '（缺结束日期）'} ${time} 结束`
  return `到当天 ${time} 结束`
}

/**
 * 把 NAS 的定时任务行**原样回写**成请求体（小驼峰）。
 *
 * 用途：列表页的「禁用 / 使能」开关 —— 它是「同一份内容只改一个字段」的编辑操作，
 * 必须把这条任务的全部内容一起发回去（NAS 的 edit 是**整体设置**，少发的字段等于清空）。
 * ⚠️ 字段映射的三处坑：
 *   · 响应侧是 `PreOnAMP`（AMP 全大写）与 `CapturerID`，请求侧必须写 `preOnAmp` / `capturerId`；
 *   · `EndDate` 只在 `startMode=1` 时回传（按星期循环的结束时刻不带日期）；
 *   · `playMode` / `loopTimes` **采播任务不能带**（后端 @AssertTrue 会拒）。
 *
 * @param {object} task NAS 行
 * @param {number} [programIndex] 覆盖程序号（缺省用行里的 ProgramIndex）
 * @returns {object} 可直接交给 editTimingTask 的请求体
 */
export function timingTaskToPayload(task, programIndex) {
  const source = task || {}
  const taskType = Number(source.TaskType)
  const startMode = Number(source.StartMode) === 1 ? 1 : 0
  const payload = {
    programIndex: Number(programIndex == null ? source.ProgramIndex : programIndex),
    taskType,
    startMode,
    startTime: String(source.StartTime == null ? '' : source.StartTime).trim(),
    // 0 使能 / 1 禁用；显式给出，避免「不传 = 保持原值」的歧义
    disable: Number(source.Disable) === 1 ? 1 : 0
  }
  if (isValidTimingTaskIndex(source.TaskIndex)) payload.taskIndex = Number(source.TaskIndex)

  const name = String(source.TaskName == null ? '' : source.TaskName).trim()
  if (name) payload.taskName = name

  if (startMode === 1) {
    payload.startDate = String(source.StartDate == null ? '' : source.StartDate).trim()
  } else {
    payload.weekDay = String(source.WeekDay == null ? '' : source.WeekDay).trim()
  }

  if (Number(source.EndMode) === 1) {
    payload.endMode = 1
    payload.endTime = String(source.EndTime == null ? '' : source.EndTime).trim()
    if (startMode === 1) payload.endDate = String(source.EndDate == null ? '' : source.EndDate).trim()
  }

  const preOnAmp = Number(source.PreOnAMP)
  if (Number.isInteger(preOnAmp)) payload.preOnAmp = preOnAmp
  const volume = Number(source.TaskVolume)
  if (Number.isInteger(volume)) payload.taskVolume = volume

  if (taskType !== TASK_TYPE_CAPTURE) {
    const playMode = Number(source.PlayMode)
    if (Number.isInteger(playMode)) payload.playMode = playMode
    const loopTimes = Number(source.LoopTimes)
    if (Number.isInteger(loopTimes)) payload.loopTimes = loopTimes
  }

  if (taskType === TASK_TYPE_FILE) payload.fileList = normalizeTaskFileIds(source.FileList)
  if (taskType === TASK_TYPE_CAPTURE) {
    payload.capturerId = String(source.CapturerID == null ? '' : source.CapturerID).trim().toUpperCase()
  }
  if (taskType === TASK_TYPE_VOICE) {
    payload.voiceText = String(source.VoiceText == null ? '' : source.VoiceText)
  }

  payload.playerList = normalizeTaskPlayerIds(source.PlayerList)
  return payload
}





