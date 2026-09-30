<script setup>
// src/components/timing/TimingTaskFormDialog.vue —— 定时任务的新建 / 编辑弹窗
//
// 接口：POST /api/timing/tasks/new（新建）/ POST /api/timing/tasks/edit（编辑，**必须带 taskIndex**）
// 字段表见 backend/docs/API.md「新建定时任务」，上游语义见 backend/docs/impl-notes.md §四。
//
// ⚠️ 与「提交临时任务」弹窗（components/tasks/SubmitTaskDialog.vue）**不是一套**，别照抄那边的枚举：
//   · 类型只有 0 文件播放 / 1 采播 / 7 文字语音（没有对讲 3）；
//   · `startMode` 只有 0 按星期循环 / 1 指定绝对时刻（没有 2 即时开始、3 等待指定时长）；
//   · `endMode` 只有 0 不指定 / 1 指定时刻结束（没有 3 持续指定时长）；
//   · 多出 `disable`（0 使能 / 1 禁用）、`preOnAmp`（提前开功放 0~15 秒）、`weekDay`（7 位 0/1 串）；
//   · 没有 priority / autoPause / autoStop（那是临时任务才有的字段）。
// ⚠️ `WeekDay` 从左到右是 **周日…周六**（反直觉！），勾选框顺序也必须按 日 一 二 三 四 五 六 排，
//    且不能全 0（NAS 会拒）—— 最常见的误操作就是「按周一到周日 的顺序勾」。
// ⚠️ NAS 的 edit 是**整体设置**：少发的字段等于清空，所以编辑时把整条任务的内容一起发回去
//    （连 `disable` / `preOnAmp` / `taskVolume` 都显式给出），避免「只改个时间」把播放内容清掉。
// ⚠️ 任务名必填（后端对删除接口的 `taskName` 有 @NotBlank）：名字留空的话这条任务以后**删不掉**，
//    所以这里直接拦掉，而不是留给 NAS 报错。
// ⚠️ 播放内容只支持**系统媒体文件**：候选来自 media store 的 system 列表 + 播放列表引用（FFxx），
//    报警媒体 / 分控媒体的文件不出现（NAS 不校验，但放出来不会响）。
// ⚠️ 采播任务**必须指定结束时刻**（本项目与临时任务同一口径）：否则采播会一直占着采播器与终端；
//    它还不能带 playMode / loopTimes（后端 @AssertTrue 会拒），所以这两项只在非采播类型下出现。
//
// 分工（与 SubmitTaskDialog 一致）：弹窗负责收集 + 校验 + 组装 payload，请求由页面调 store 发出。

import { computed, ref, watch } from 'vue'
import { gbkByteLength, getDeviceState, isValidDeviceId } from '@/constants/device'
import { toTaskPlayerId } from '@/constants/group'
import { looksLikePlayListRef, toTaskFileListRef } from '@/constants/playlist'
import {
  PLAY_MODE_OPTIONS,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_FILE,
  TASK_TYPE_VOICE,
  describeTaskFile,
  describeTaskPlayer,
  normalizeTaskFileIds,
  normalizeTaskPlayerIds
} from '@/constants/task'
import {
  TIMING_END_MODE_OPTIONS,
  TIMING_FILE_MAX,
  TIMING_LOOP_TIMES_MAX,
  TIMING_PLAY_MODE_MAX,
  TIMING_PLAYER_MAX,
  TIMING_PRE_ON_AMP_HINT,
  TIMING_PRE_ON_AMP_MAX,
  TIMING_START_MODE_OPTIONS,
  TIMING_SYSTEM_MEDIA_HINT,
  TIMING_TASK_NAME_MAX_BYTES,
  TIMING_TASK_TYPE_OPTIONS,
  TIMING_VOICE_TEXT_MAX_BYTES,
  TIMING_VOLUME_MAX,
  WEEKDAY_HINT,
  WEEKDAY_LABELS,
  describeWeekDay,
  formatTimingVolume,
  isValidProgramIndex,
  isValidTimingDate,
  isValidTimingTime,
  isValidWeekDay,
  weekDayFromIndexes,
  weekDayToIndexes
} from '@/constants/timing'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 要编辑的任务（NAS 原始行）；null = 新建 */
  task: { type: Object, default: null },
  /** 新建时的程序号（编辑时以任务自带的 ProgramIndex 为准） */
  programIndex: { type: Number, default: 1 },
  /** 程序下拉选项（由 constants/timing.js 的 programOptions 生成） */
  programs: { type: Array, default: () => [] },
  /** 候选：**系统媒体**文件（NAS MediaList 行） */
  files: { type: Array, default: () => [] },
  /** 候选：播放列表（任务里引用要写成 FFxx） */
  playLists: { type: Array, default: () => [] },
  /** 候选：播放终端（NAS 设备行） */
  players: { type: Array, default: () => [] },
  /** 候选：终端分组 */
  groups: { type: Array, default: () => [] },
  /** 候选：被动采播器 */
  capturers: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isEdit = computed(() => Boolean(props.task && props.task.TaskIndex))

/** 空表单：缺省「按星期循环 + 周一到周五」，这是排课 / 打铃最常见的组合 */
function createEmptyForm(programIndex = 1) {
  return {
    programIndex: Number(programIndex) || 1,
    taskType: TASK_TYPE_FILE,
    taskName: '',
    disable: 0,
    startMode: 0,
    weekDayIndexes: [1, 2, 3, 4, 5],
    startDate: '',
    startTime: '',
    endMode: 0,
    endDate: '',
    endTime: '',
    preOnAmp: 0,
    playMode: 2,
    loopTimes: 0,
    taskVolume: 0,
    fileIds: [],
    capturerId: '',
    voiceText: '',
    playerIds: [],
    /** 播放内容搜索框（纯 UI，不进 payload） */
    fileKeyword: ''
  }
}

/** 把 NAS 行填回表单（编辑用；`WeekDay` 全 0 时勾选框是空的，得由用户自己补勾） */
function createFormFromTask(task, fallbackProgramIndex = 1) {
  const base = createEmptyForm(fallbackProgramIndex)
  if (!task) return base
  const type = Number(task.TaskType)
  return {
    ...base,
    programIndex: Number(task.ProgramIndex == null ? fallbackProgramIndex : task.ProgramIndex),
    taskType:
      type === TASK_TYPE_CAPTURE
        ? TASK_TYPE_CAPTURE
        : type === TASK_TYPE_VOICE
          ? TASK_TYPE_VOICE
          : TASK_TYPE_FILE,
    taskName: String(task.TaskName == null ? '' : task.TaskName),
    disable: Number(task.Disable) === 1 ? 1 : 0,
    startMode: Number(task.StartMode) === 1 ? 1 : 0,
    weekDayIndexes: weekDayToIndexes(task.WeekDay),
    startDate: String(task.StartDate == null ? '' : task.StartDate).trim(),
    startTime: String(task.StartTime == null ? '' : task.StartTime).trim(),
    endMode: Number(task.EndMode) === 1 ? 1 : 0,
    endDate: String(task.EndDate == null ? '' : task.EndDate).trim(),
    endTime: String(task.EndTime == null ? '' : task.EndTime).trim(),
    // ⚠️ 响应侧字段是 PreOnAMP（AMP 全大写）与 CapturerID
    preOnAmp: Number.isInteger(Number(task.PreOnAMP)) ? Number(task.PreOnAMP) : 0,
    playMode: Number.isInteger(Number(task.PlayMode)) ? Number(task.PlayMode) : 2,
    loopTimes: Number.isInteger(Number(task.LoopTimes)) ? Number(task.LoopTimes) : 0,
    taskVolume: Number.isInteger(Number(task.TaskVolume)) ? Number(task.TaskVolume) : 0,
    fileIds: normalizeTaskFileIds(task.FileList),
    capturerId: String(task.CapturerID == null ? '' : task.CapturerID).trim().toUpperCase(),
    voiceText: String(task.VoiceText == null ? '' : task.VoiceText),
    playerIds: normalizeTaskPlayerIds(task.PlayerList)
  }
}

const form = ref(createEmptyForm(props.programIndex))

// 每次打开都重新初始化：新建给缺省值，编辑把这条任务的内容铺回表单
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.value = props.task
      ? createFormFromTask(props.task, props.programIndex)
      : createEmptyForm(props.programIndex)
  }
)

const isFileTask = computed(() => Number(form.value.taskType) === TASK_TYPE_FILE)
const isCaptureTask = computed(() => Number(form.value.taskType) === TASK_TYPE_CAPTURE)
const isVoiceTask = computed(() => Number(form.value.taskType) === TASK_TYPE_VOICE)
const isAbsoluteStart = computed(() => Number(form.value.startMode) === 1)
const currentType = computed(
  () =>
    TIMING_TASK_TYPE_OPTIONS.find((item) => item.value === Number(form.value.taskType)) ||
    TIMING_TASK_TYPE_OPTIONS[0]
)

/** 勾选框状态 → WeekDay 字符串（左→右 = 周日…周六） */
const weekDayString = computed(() => weekDayFromIndexes(form.value.weekDayIndexes))
const weekDayOk = computed(() => isValidWeekDay(weekDayString.value))
/** 勾选情况的可读说明（表单里实时显示，避免「按周一到周日勾反了」） */
const weekDayText = computed(() => describeWeekDay(weekDayString.value))

/** 当前选中的开始 / 结束模式（取它们的 hint 显示在下方） */
const currentStartOption = computed(
  () => TIMING_START_MODE_OPTIONS.find((item) => item.value === Number(form.value.startMode)) || TIMING_START_MODE_OPTIONS[0]
)
const currentEndOption = computed(
  () => TIMING_END_MODE_OPTIONS.find((item) => item.value === Number(form.value.endMode)) || TIMING_END_MODE_OPTIONS[0]
)

// 切到采播类型时强制「指定时刻结束」（采播不结束会一直占着采播器与终端）
watch(isCaptureTask, (capture) => {
  if (capture && Number(form.value.endMode) !== 1) form.value.endMode = 1
})

// ---------------- 播放内容候选（系统媒体 + 播放列表引用） ----------------

/**
 * 候选条目：系统媒体文件 + 播放列表引用。
 * ⚠️ 形如 `FFxx` 的**系统媒体文件**不能出现在候选里：FileList 里 `FFxx` 一律被当成播放列表引用
 *    （两种写法都是 4 位十六进制，无法区分），列出来只会让用户以为在放这个文件。
 */
const fileCandidates = computed(() => {
  const fileItems = (props.files || [])
    .filter((item) => !looksLikePlayListRef(item && item.FileID))
    .map((item) => ({
      value: String((item && item.FileID) || '').trim().toUpperCase(),
      label: String((item && item.FileName) || ''),
      kind: 'file'
    }))
    .filter((item) => item.value)

  const playListItems = (props.playLists || [])
    .map((item) => ({
      value: toTaskFileListRef(item && item.PlayListID),
      label: String((item && item.PlayListName) || ''),
      kind: 'playlist'
    }))
    .filter((item) => item.value)

  return [...fileItems, ...playListItems]
})

/** 被排除的「形如 FFxx 的系统媒体文件」数量（提示用，免得用户以为候选里少了几条） */
const ambiguousFileCount = computed(
  () => (props.files || []).filter((item) => looksLikePlayListRef(item && item.FileID)).length
)

/** 候选列表：按关键字过滤，并去掉已选项（已选的会出现在右侧有序清单里） */
const filteredCandidates = computed(() => {
  const text = form.value.fileKeyword.trim().toLowerCase()
  const selected = new Set(form.value.fileIds)
  return fileCandidates.value.filter((item) => {
    if (selected.has(item.value)) return false
    if (!text) return true
    return [item.value, item.label].some((field) => String(field).toLowerCase().includes(text))
  })
})

/** 已选内容（补出类型与名称；查不到名称也照旧显示，只是没有名字） */
const selectedFiles = computed(() =>
  form.value.fileIds.map((id) => ({
    value: id,
    ...describeTaskFile(id, { mediaFiles: props.files, playLists: props.playLists })
  }))
)

/** 引用的类型文案（describeTaskFile 的 kind → 中文） */
const FILE_KIND_TEXT = { file: '文件', playlist: '列表', invalid: '非法' }
function fileKindText(kind) {
  return FILE_KIND_TEXT[kind] || '未知'
}

const canAddMoreFiles = computed(() => form.value.fileIds.length < TIMING_FILE_MAX)

function addFile(fileId) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  if (!id || form.value.fileIds.includes(id) || !canAddMoreFiles.value) return
  form.value.fileIds.push(id)
}

/** 一次把候选里还能加的条目全加进来（最多到 180 项上限） */
function addAllCandidates() {
  const room = TIMING_FILE_MAX - form.value.fileIds.length
  filteredCandidates.value.slice(0, Math.max(room, 0)).forEach((item) => addFile(item.value))
}

function removeFile(index) {
  form.value.fileIds.splice(index, 1)
}

/** 上移 / 下移：顺序播放与列表循环时数组顺序就是播放顺序，必须可调 */
function moveFile(index, offset) {
  const target = index + offset
  if (target < 0 || target >= form.value.fileIds.length) return
  const [item] = form.value.fileIds.splice(index, 1)
  form.value.fileIds.splice(target, 0, item)
}

// ---------------- 播放目标 / 采播器 ----------------

const playerOptions = computed(() =>
  (props.players || [])
    .map((item) => {
      const id = String((item && item.DeviceID) || '').trim().toUpperCase()
      const state = getDeviceState(item && item.State)
      return {
        value: id,
        label: `${(item && item.DevName) || '未命名'}（${id}）`,
        stateText: state.text,
        stateTag: state.tag,
        online: Number(item && item.State) === 0
      }
    })
    .filter((item) => item.value)
)

const groupOptions = computed(() =>
  (props.groups || [])
    .map((item) => {
      const value = toTaskPlayerId(item && item.GroupID)
      const memberCount = Array.isArray(item && item.PlayerList) ? item.PlayerList.length : 0
      return {
        value,
        label: `${(item && item.GroupName) || '未命名分组'}（${value}）`,
        memberCount
      }
    })
    .filter((item) => item.value)
)

/** 已选目标的展示信息（终端 / 分组 / 列表里查不到的） */
const selectedPlayers = computed(() =>
  form.value.playerIds.map((id) => describeTaskPlayer(id, { devices: props.players, groups: props.groups }))
)

/** 已选里不在线的终端数（离线终端不会真正播放，但任务可以先建） */
const offlinePlayerCount = computed(() =>
  form.value.playerIds.filter((id) => {
    const hit = playerOptions.value.find((item) => item.value === id)
    return Boolean(hit) && !hit.online
  }).length
)

/** 已选里在终端 / 分组列表都找不到的 ID 数（设备已删除等，NAS 侧仍记着它） */
const unknownPlayerCount = computed(
  () => selectedPlayers.value.filter((item) => item.kind === 'terminal' && !item.known).length
)

/** 全选在线终端（分组不自动勾：一不小心就把整组加进来，容易超 248 项） */
function selectOnlinePlayers() {
  const merged = form.value.playerIds.slice()
  playerOptions.value
    .filter((item) => item.online)
    .forEach((item) => {
      if (!merged.includes(item.value) && merged.length < TIMING_PLAYER_MAX) merged.push(item.value)
    })
  form.value.playerIds = merged
}

const capturerOptions = computed(() =>
  (props.capturers || [])
    .map((item) => {
      const id = String((item && item.DeviceID) || '').trim().toUpperCase()
      const state = getDeviceState(item && item.State)
      return {
        value: id,
        label: `${(item && item.DevName) || '未命名'}（${id}）`,
        stateText: state.text,
        stateTag: state.tag
      }
    })
    .filter((item) => item.value)
)

/** 手输的采播器可能不在列表里：提示一条，但不拦提交（NAS 才是裁判） */
const selectedCapturer = computed(
  () => capturerOptions.value.find((item) => item.value === form.value.capturerId) || null
)

// ---------------- 长度、校验与提交 ----------------

const nameBytes = computed(() => gbkByteLength(form.value.taskName))
const nameTooLong = computed(() => nameBytes.value > TIMING_TASK_NAME_MAX_BYTES)
const voiceBytes = computed(() => gbkByteLength(form.value.voiceText))
const voiceTooLong = computed(() => voiceBytes.value > TIMING_VOICE_TEXT_MAX_BYTES)

/** 整数范围判断（表单里的 el-input-number 本身有 min/max，这里再兜一道，与后端 @Min/@Max 对齐） */
function inRange(value, min, max) {
  const num = Number(value)
  return Number.isInteger(num) && num >= min && num <= max
}

const errorText = computed(() => {
  if (!isValidProgramIndex(form.value.programIndex)) return '程序号必须是 1~16 的整数'
  if (!form.value.taskName.trim()) {
    return '任务名不能为空（NAS 删除任务时要用它确认目标，留空的名字以后删不掉）'
  }
  if (nameTooLong.value) {
    return `任务名不能超过 ${TIMING_TASK_NAME_MAX_BYTES} 个 GBK 字节（中文 / 全角按 2 字节计，当前 ${nameBytes.value} 字节）`
  }

  if (!isValidTimingTime(form.value.startTime)) return '开始时刻格式应为 hh:mm:ss（例如 08:10:00）'
  if (isAbsoluteStart.value) {
    if (!isValidTimingDate(form.value.startDate)) return '绝对时刻开始时必须给开始日期，格式 YY-MM-DD（例如 26-09-30）'
  } else if (!weekDayOk.value) {
    return '按星期循环至少要勾一天（WeekDay 不能是 0000000，NAS 会拒）'
  }

  if (Number(form.value.endMode) === 1) {
    if (!isValidTimingTime(form.value.endTime)) return '结束时刻格式应为 hh:mm:ss（例如 08:12:00）'
    if (isAbsoluteStart.value && !isValidTimingDate(form.value.endDate)) {
      return '绝对时刻开始时还要给结束日期，格式 YY-MM-DD'
    }
  } else if (isCaptureTask.value) {
    return '采播任务必须指定结束时刻（否则会一直占用采播器与播放终端）'
  }

  if (isFileTask.value) {
    if (!form.value.fileIds.length) return '文件播放任务至少要放 1 项内容（系统媒体文件或播放列表）'
    if (form.value.fileIds.length > TIMING_FILE_MAX) {
      return `播放内容最多 ${TIMING_FILE_MAX} 项（当前 ${form.value.fileIds.length} 项）`
    }
  }
  if (isCaptureTask.value && !isValidDeviceId(form.value.capturerId)) {
    return '采播任务必须选一台采播器（8 位十六进制设备 ID）'
  }
  if (isVoiceTask.value) {
    if (!form.value.voiceText.trim()) return '文字语音任务必须填写要播报的文本'
    if (voiceTooLong.value) {
      return `文本不能超过 ${TIMING_VOICE_TEXT_MAX_BYTES} 个 GBK 字节（当前 ${voiceBytes.value} 字节，约 179 个汉字）`
    }
  }

  if (!form.value.playerIds.length) return '至少要选 1 个播放目标（终端或分组）'
  if (form.value.playerIds.length > TIMING_PLAYER_MAX) {
    return `播放目标最多 ${TIMING_PLAYER_MAX} 个（当前 ${form.value.playerIds.length} 个）`
  }

  if (!inRange(form.value.preOnAmp, 0, TIMING_PRE_ON_AMP_MAX)) {
    return `提前开功放必须是 0~${TIMING_PRE_ON_AMP_MAX} 的整数`
  }
  if (!inRange(form.value.taskVolume, 0, TIMING_VOLUME_MAX)) {
    return `任务音量必须是 0~${TIMING_VOLUME_MAX} 的整数（0 = 最大、${TIMING_VOLUME_MAX} = 静音）`
  }
  if (!isCaptureTask.value) {
    if (!inRange(form.value.playMode, 0, TIMING_PLAY_MODE_MAX)) return '播放模式必须是 0~4'
    if (!inRange(form.value.loopTimes, 0, TIMING_LOOP_TIMES_MAX)) {
      return `循环次数必须是 0~${TIMING_LOOP_TIMES_MAX} 的整数（0 = 不限）`
    }
  }
  return ''
})

const canSubmit = computed(() => !errorText.value)

/**
 * 组装请求体（小驼峰）。
 * 只带该类型有意义的字段：采播任务带 playMode / loopTimes 会被后端拒；
 * `endMode=0`（不指定）是缺省值，所以干脆不发结束时间字段。
 * 编辑时补上 `taskIndex`（新建时由 NAS 分配，**不能传**）。
 */
function buildPayload() {
  const startMode = isAbsoluteStart.value ? 1 : 0
  const taskType = Number(form.value.taskType)
  const payload = {
    programIndex: Number(form.value.programIndex),
    taskType,
    startMode,
    startTime: form.value.startTime.trim(),
    disable: Number(form.value.disable) === 1 ? 1 : 0,
    // 显式给出，避免「不传」被理解成缺省值（preOnAmp 缺省 0、taskVolume 缺省 0 = 最大）
    preOnAmp: Number(form.value.preOnAmp) || 0,
    taskVolume: Number(form.value.taskVolume) || 0,
    playerList: normalizeTaskPlayerIds(form.value.playerIds)
  }
  payload.taskName = form.value.taskName.trim()

  if (startMode === 1) {
    payload.startDate = form.value.startDate.trim()
  } else {
    payload.weekDay = weekDayString.value
  }

  if (Number(form.value.endMode) === 1) {
    payload.endMode = 1
    payload.endTime = form.value.endTime.trim()
    // EndDate 只在绝对时刻开始时才有意义（按星期循环时结束时刻是「每一次执行的当日时刻」）
    if (startMode === 1) payload.endDate = form.value.endDate.trim()
  }

  if (taskType === TASK_TYPE_FILE) payload.fileList = normalizeTaskFileIds(form.value.fileIds)
  if (taskType === TASK_TYPE_CAPTURE) payload.capturerId = form.value.capturerId.trim().toUpperCase()
  if (taskType === TASK_TYPE_VOICE) payload.voiceText = form.value.voiceText.trim()

  // 播放模式 / 循环次数只对文件播放与文字语音有意义
  if (taskType !== TASK_TYPE_CAPTURE) {
    payload.playMode = Number(form.value.playMode)
    payload.loopTimes = Number(form.value.loopTimes) || 0
  }

  if (isEdit.value) payload.taskIndex = Number(props.task.TaskIndex)
  return payload
}

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', buildPayload())
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? `编辑定时任务（程序 ${form.programIndex} · 任务 ${props.task.TaskIndex}）` : '新建定时任务'"
    width="880px"
    top="6vh"
    :close-on-click-modal="false"
  >
    <el-alert type="info" :closable="false" show-icon class="timing-form__alert">
      <template #title>定时任务「先配置、到时自动执行」</template>
      NAS 创建时<strong>不校验文件是否存在、设备是否在线</strong>，只有真正执行时才检索；播放内容只支持<strong>系统媒体文件</strong>；
      定时任务与「任务管理」里的临时任务是两套东西（这里没有优先级 / 自动暂停 / 自动停止）。
    </el-alert>

    <el-form label-position="top" class="timing-form" @submit.prevent="handleConfirm">
      <!-- 1. 归属程序 / 使能状态 / 类型 -->
      <div class="timing-form__inline">
        <el-form-item label="所属程序" class="timing-form__grow">
          <el-select v-model="form.programIndex" :disabled="submitting">
            <el-option v-for="item in programs" :key="item.value" :value="item.value" :label="item.label" />
          </el-select>
        </el-form-item>
        <el-form-item label="使能状态" class="timing-form__grow">
          <el-radio-group v-model="form.disable" :disabled="submitting">
            <el-radio-button :value="0">使能</el-radio-button>
            <el-radio-button :value="1">禁用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </div>
      <p class="timing-form__hint">
        禁用只是「暂不执行」：任务仍留在程序里、仍占着任务序号；编辑时改程序号等于把这条任务挪到另一套程序。
      </p>

      <el-form-item label="任务类型">
        <el-radio-group v-model="form.taskType" :disabled="submitting">
          <el-radio-button v-for="item in TIMING_TASK_TYPE_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <p class="timing-form__hint">{{ currentType.hint }}</p>

      <el-form-item :label="`任务名（必填，≤ ${TIMING_TASK_NAME_MAX_BYTES} 个 GBK 字节）`">
        <el-input v-model="form.taskName" placeholder="例如：上课铃" clearable :disabled="submitting" />
      </el-form-item>
      <p class="timing-form__counter" :class="{ 'timing-form__counter--error': nameTooLong }">
        GBK 字节 {{ nameBytes }} / {{ TIMING_TASK_NAME_MAX_BYTES }} ——
        NAS 删除任务时要用这个名字确认目标，所以必须填、且同一个程序内不要重名。
      </p>

      <!-- 2. 触发时间：按星期循环 / 指定绝对时刻 -->
      <el-form-item label="开始方式">
        <el-radio-group v-model="form.startMode" :disabled="submitting">
          <el-radio v-for="item in TIMING_START_MODE_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <p class="timing-form__hint">{{ currentStartOption.hint }}（定时任务没有「即时开始 / 等待时长」这两种模式）</p>

      <el-form-item v-if="!isAbsoluteStart" label="星期（顺序是 日 一 二 三 四 五 六）">
        <div class="timing-form__block">
          <el-checkbox-group v-model="form.weekDayIndexes" :disabled="submitting">
            <el-checkbox-button v-for="(label, index) in WEEKDAY_LABELS" :key="index" :value="index">
              {{ label }}
            </el-checkbox-button>
          </el-checkbox-group>
          <p class="timing-form__counter" :class="{ 'timing-form__counter--error': !weekDayOk }">
            WeekDay = {{ weekDayString }}（{{ weekDayText }}）{{ weekDayOk ? '' : '：至少勾一天，NAS 会拒全 0' }}
          </p>
        </div>
      </el-form-item>
      <p v-if="!isAbsoluteStart" class="timing-form__hint">{{ WEEKDAY_HINT }}</p>

      <div class="timing-form__inline">
        <el-form-item
          v-if="isAbsoluteStart"
          label="开始日期（YY-MM-DD）"
          class="timing-form__grow"
        >
          <el-input v-model="form.startDate" placeholder="26-09-30" :disabled="submitting" />
        </el-form-item>
        <el-form-item label="开始时刻（hh:mm:ss）" class="timing-form__grow">
          <el-input v-model="form.startTime" placeholder="08:10:00" :disabled="submitting" />
        </el-form-item>
      </div>

      <!-- 3. 结束方式：只有「不指定 / 指定时刻结束」 -->
      <el-form-item label="结束方式">
        <el-radio-group v-model="form.endMode" :disabled="submitting || isCaptureTask">
          <el-radio v-for="item in TIMING_END_MODE_OPTIONS" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <p class="timing-form__hint">{{ currentEndOption.hint }}</p>
      <p v-if="isCaptureTask" class="timing-form__warn">
        采播任务必须指定结束时刻（与临时任务同一口径）：采播不会自然结束，不指定结束时间会一直占着采播器与播放终端。
      </p>
      <div v-if="Number(form.endMode) === 1" class="timing-form__inline">
        <el-form-item v-if="isAbsoluteStart" label="结束日期（YY-MM-DD）" class="timing-form__grow">
          <el-input v-model="form.endDate" placeholder="26-09-30" :disabled="submitting" />
        </el-form-item>
        <el-form-item label="结束时刻（hh:mm:ss）" class="timing-form__grow">
          <el-input v-model="form.endTime" placeholder="08:12:00" :disabled="submitting" />
        </el-form-item>
      </div>
      <p v-if="Number(form.endMode) === 1 && !isAbsoluteStart" class="timing-form__hint">
        按星期循环时结束时刻是「每一次执行的当日时刻」（所以不发 EndDate，与 NAS 口径一致）。
      </p>

      <!-- 4.1 文件播放：左侧候选（系统媒体 + 播放列表），右侧有序清单 -->
      <el-form-item
        v-if="isFileTask"
        :label="`播放内容（已选 ${form.fileIds.length} / ${TIMING_FILE_MAX} 项，顺序即播放顺序）`"
      >
        <div class="timing-form__picker">
          <div class="timing-form__col">
            <el-input
              v-model="form.fileKeyword"
              size="small"
              placeholder="搜索文件名 / 文件 ID / 播放列表名"
              clearable
            />
            <ul class="timing-form__list">
              <li v-for="item in filteredCandidates" :key="item.value" class="timing-form__row">
                <span class="timing-form__row-main">
                  <el-tag size="small" effect="plain" :type="item.kind === 'playlist' ? 'warning' : 'info'">
                    {{ item.kind === 'playlist' ? '播放列表' : '系统媒体' }}
                  </el-tag>
                  <span class="timing-form__row-name">{{ item.label || '（未命名）' }}</span>
                  <span class="timing-form__row-id">{{ item.value }}</span>
                </span>
                <el-button size="small" text type="primary" :disabled="submitting" @click="addFile(item.value)">
                  加入
                </el-button>
              </li>
              <li v-if="!filteredCandidates.length" class="timing-form__empty">
                没有可加入的候选（候选已全部加入，或系统媒体列表为空）
              </li>
            </ul>
            <div class="timing-form__col-foot">
              <el-button size="small" :disabled="submitting || !filteredCandidates.length" @click="addAllCandidates">
                全部加入
              </el-button>
            </div>
          </div>
          <div class="timing-form__col">
            <p class="timing-form__col-title">已选内容（{{ form.fileIds.length }} 项）</p>
            <ul class="timing-form__list timing-form__list--tall">
              <li v-for="(item, index) in selectedFiles" :key="item.value" class="timing-form__row">
                <span class="timing-form__row-main">
                  <span class="timing-form__row-index">{{ index + 1 }}</span>
                  <el-tag size="small" effect="plain" :type="item.kind === 'playlist' ? 'warning' : 'info'">
                    {{ fileKindText(item.kind) }}
                  </el-tag>
                  <span class="timing-form__row-name">{{ item.name || '（不在当前候选里）' }}</span>
                  <span class="timing-form__row-id">{{ item.value }}</span>
                </span>
                <span class="timing-form__row-actions">
                  <el-button size="small" text :disabled="submitting || index === 0" @click="moveFile(index, -1)">
                    上移
                  </el-button>
                  <el-button
                    size="small"
                    text
                    :disabled="submitting || index === form.fileIds.length - 1"
                    @click="moveFile(index, 1)"
                  >
                    下移
                  </el-button>
                  <el-button size="small" text type="danger" :disabled="submitting" @click="removeFile(index)">
                    移除
                  </el-button>
                </span>
              </li>
              <li v-if="!form.fileIds.length" class="timing-form__empty">还没有加入任何内容</li>
            </ul>
          </div>
        </div>
      </el-form-item>
      <p v-if="isFileTask" class="timing-form__hint">
        {{ TIMING_SYSTEM_MEDIA_HINT }}
        <template v-if="ambiguousFileCount">
          另有 {{ ambiguousFileCount }} 个系统媒体文件形如 <code>FFxx</code>，在 FileList 里会被当成「播放列表引用」，
          所以没有放进候选（要放它们请改用对应的播放列表）。
        </template>
      </p>

      <!-- 4.2 采播：选一台被动采播器 -->
      <el-form-item v-if="isCaptureTask" label="采播器（被动采播设备，选一台）">
        <el-select
          v-model="form.capturerId"
          class="timing-form__select"
          placeholder="选择采播器（也可直接输入 8 位十六进制设备 ID）"
          filterable
          allow-create
          clearable
          :disabled="submitting"
        >
          <el-option v-for="item in capturerOptions" :key="item.value" :value="item.value" :label="item.label">
            <span class="timing-form__row-main">
              <span class="timing-form__row-name">{{ item.label }}</span>
              <el-tag size="small" effect="plain" :type="item.stateTag">{{ item.stateText }}</el-tag>
            </span>
          </el-option>
        </el-select>
      </el-form-item>
      <p v-if="isCaptureTask && form.capturerId && !selectedCapturer" class="timing-form__warn">
        采播器 {{ form.capturerId }} 不在当前设备列表里（可能是历史 / 已删除的设备，或输入有误）。
        表单不会拦，但 NAS 执行时会以它的实际状态为准。
      </p>

      <!-- 4.3 文字语音：文本 + 实时 GBK 字节计数 -->
      <el-form-item v-if="isVoiceTask" label="播报文本">
        <el-input
          v-model="form.voiceText"
          type="textarea"
          :rows="4"
          placeholder="例如：请注意，三层设备检修，请勿靠近。"
          :disabled="submitting"
        />
      </el-form-item>
      <p
        v-if="isVoiceTask"
        class="timing-form__counter"
        :class="{ 'timing-form__counter--error': voiceTooLong }"
      >
        GBK 字节 {{ voiceBytes }} / {{ TIMING_VOICE_TEXT_MAX_BYTES }}（约 179 个汉字；中文 / 全角按 2 字节计，超出 NAS 会截断）
      </p>

      <!-- 5. 播放目标：终端 ID 或 FFFFFFxx 分组引用，至少 1 个 -->
      <el-form-item :label="`播放目标（已选 ${form.playerIds.length} / ${TIMING_PLAYER_MAX} 个，终端或分组）`">
        <el-select
          v-model="form.playerIds"
          class="timing-form__select"
          placeholder="选择播放终端，或引用一个终端分组"
          multiple
          filterable
          clearable
          collapse-tags
          collapse-tags-tooltip
          :disabled="submitting"
        >
          <el-option-group label="播放终端">
            <el-option v-for="item in playerOptions" :key="item.value" :value="item.value" :label="item.label">
              <span class="timing-form__row-main">
                <span class="timing-form__row-name">{{ item.label }}</span>
                <el-tag size="small" effect="plain" :type="item.stateTag">{{ item.stateText }}</el-tag>
              </span>
            </el-option>
          </el-option-group>
          <el-option-group label="终端分组（引用分组 = 发给组内所有终端）">
            <el-option v-for="item in groupOptions" :key="item.value" :value="item.value" :label="item.label">
              <span class="timing-form__row-main">
                <span class="timing-form__row-name">{{ item.label }}</span>
                <span class="timing-form__hint">含 {{ item.memberCount }} 个终端</span>
              </span>
            </el-option>
          </el-option-group>
        </el-select>
        <div class="timing-form__col-foot">
          <el-button size="small" :disabled="submitting" @click="selectOnlinePlayers">加入全部在线终端</el-button>
          <el-button size="small" :disabled="submitting || !form.playerIds.length" @click="form.playerIds = []">
            清空
          </el-button>
        </div>
      </el-form-item>
      <p class="timing-form__hint">
        播放目标的顺序不影响结果（不像播放内容那样有序）；分组会以 <code>FFFFFFxx</code> 的形式发给 NAS。
      </p>
      <p v-if="offlinePlayerCount" class="timing-form__warn">
        已选目标里有 {{ offlinePlayerCount }} 个终端当前离线：任务可以建，但这些终端到点收不到声音。
      </p>
      <p v-if="unknownPlayerCount" class="timing-form__warn">
        已选目标里有 {{ unknownPlayerCount }} 个 ID 在终端 / 分组列表里查不到（设备可能已删除）：NAS 侧仍会按这个 ID 下发。
      </p>

      <!-- 6. 播放参数：音量 / 提前开功放对三种类型都有效；播放模式 / 循环次数只对文件与文字语音有效 -->
      <el-form-item :label="`任务音量（0 = 最大 / 0dB，${TIMING_VOLUME_MAX} = 静音）：${formatTimingVolume(form.taskVolume)}`">
        <el-slider
          v-model="form.taskVolume"
          :min="0"
          :max="TIMING_VOLUME_MAX"
          :step="1"
          show-input
          :disabled="submitting"
        />
      </el-form-item>
      <p class="timing-form__hint">
        音量是衰减量口径：终端实际音量 = 基础音量 + 任务音量（数值越大越小声）。
      </p>

      <el-form-item :label="`提前打开功放（0 ~ ${TIMING_PRE_ON_AMP_MAX} 秒）`">
        <el-input-number v-model="form.preOnAmp" :min="0" :max="TIMING_PRE_ON_AMP_MAX" :disabled="submitting" />
      </el-form-item>
      <p class="timing-form__hint">{{ TIMING_PRE_ON_AMP_HINT }}（这是定时任务特有的字段，临时任务没有）</p>

      <template v-if="!isCaptureTask">
        <el-form-item label="播放模式">
          <el-radio-group v-model="form.playMode" :disabled="submitting">
            <el-radio v-for="item in PLAY_MODE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="`循环次数（0 = 不限，1~${TIMING_LOOP_TIMES_MAX}；只在循环类播放模式下有效）`">
          <el-input-number v-model="form.loopTimes" :min="0" :max="TIMING_LOOP_TIMES_MAX" :disabled="submitting" />
        </el-form-item>
      </template>
      <p v-else class="timing-form__hint">
        采播任务没有播放模式与循环次数（带上这两个字段后端会直接拒，所以表单里不出现）。
      </p>


    </el-form>

    <template #footer>
      <div class="timing-form__footer">
        <span v-if="errorText" class="timing-form__footer-error">⚠ {{ errorText }}</span>
        <span v-else class="timing-form__footer-hint">
          {{ isEdit ? '保存会用表单里的内容整体覆盖这条任务（NAS 的 edit 是整体设置）。' : '新建成功后 NAS 会分配任务序号。' }}
        </span>
        <span class="timing-form__footer-actions">
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
            {{ isEdit ? '保存修改' : '新建任务' }}
          </el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.timing-form__hint {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.timing-form__warn {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.timing-form__counter {
  margin: -12px 0 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing-form__counter--error {
  color: var(--el-color-danger);
}

.timing-form__alert {
  margin-bottom: 8px;
}

.timing-form__select {
  width: 100%;
}

.timing-form__grow {
  flex: 1 1 0;
  min-width: 0;
  margin-right: 12px;
}

.timing-form__grow:last-child {
  margin-right: 0;
}

.timing-form__inline {
  display: flex;
  gap: 8px;
}

.timing-form__block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timing-form__block .timing-form__counter {
  margin: 0;
}

.timing-form__picker {
  display: flex;
  gap: 12px;
  width: 100%;
}

.timing-form__col {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--app-radius);
}

.timing-form__col-title {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing-form__col-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.timing-form__list {
  height: 220px;
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.timing-form__list--tall {
  height: 300px;
}

.timing-form__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  font-size: 12px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.timing-form__row-main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.timing-form__row-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-form__row-id {
  flex: 0 0 auto;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  color: var(--el-text-color-placeholder);
}

.timing-form__row-index {
  flex: 0 0 22px;
  color: var(--el-text-color-placeholder);
}

.timing-form__row-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}

.timing-form__empty {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.timing-form__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.timing-form__footer-error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
  text-align: left;
}

.timing-form__footer-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  text-align: left;
}

.timing-form__footer-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
