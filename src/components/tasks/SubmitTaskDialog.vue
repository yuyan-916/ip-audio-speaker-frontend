<script setup>
// src/components/tasks/SubmitTaskDialog.vue —— 提交临时任务（文件播放 / 采播 / 文字语音）
//
// 接口：POST /api/tasks/submit（字段表见 api/task.js）
//
// ⚠️ 提交端**不支持** taskType=3（对讲）：手册 P62 的类型表里没有它（后端 @AllowedValues 也会拒），
//    所以这里只给 0 / 1 / 7 三个选项 —— 但运行端列表里会出现 3，别以为它是脏数据。
// ⚠️ 三种类型需要的「内容」字段不一样（后端 @AssertTrue 校验）：
//    0 → fileList（4 位 FileID 或 FFxx 播放列表引用，1~180 项）
//    1 → capturerId（有且只有一台采播器）
//    7 → voiceText（≤358 个 GBK 字节，约 179 个汉字）
//    三者都必须给 playerList（8 位终端 ID 或 FFFFFFxx 分组引用，1~248 项）。
// ⚠️ `playMode` / `loopTimes` **只对 0 与 7 有意义**：采播任务带上它们后端会直接拒，
//    所以这两项只在文件 / 文字语音类型下出现，组装 payload 时也做了同样的分支。
// ⚠️ **「采播 / 随机播放 / 循环但不限次数」本项目强制要求结束时间**：手册 P64 只说「原则上必须」，
//    但这类任务不结束就会一直占着采播器与终端，UI 层直接拦掉（判断收在 constants/task.js
//    的 describeEndTimeRequirement 里，三处共用一套口径）。
// ⚠️ 开始时间本项目固定用「即时开始」（startMode=2，缺省，所以 payload 里干脆不发）：
//    定时 / 预约属于「定时任务」模块，放在这里做会与那边语义打架。
//
// 分工：弹窗只负责**收集 + 校验 + 组装 payload**，并把提交结果（TaskID / TaskSN）展示出来供复制；
// 真正的请求由页面（TaskListView）调 store 发出，成功结果通过 `result` prop 回传 ——
// 与分组 / 播放列表弹窗一致（媒体上传弹窗是唯一例外，它要自己串行管理上传队列）。

import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { gbkByteLength, getDeviceState } from '@/constants/device'
import { toTaskPlayerId } from '@/constants/group'
import { looksLikePlayListRef, toTaskFileListRef } from '@/constants/playlist'
import {
  PLAY_MODE_OPTIONS,
  SUBMITTABLE_TASK_TYPES,
  TASK_FILE_MAX,
  TASK_LOOP_TIMES_MAX,
  TASK_NAME_MAX_BYTES,
  TASK_PLAYER_MAX,
  TASK_PRIORITY_MAX,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_FILE,
  TASK_TYPE_VOICE,
  TASK_VOLUME_MAX,
  VOICE_TEXT_MAX_BYTES,
  // ⚠️ 模板里用 END_MODES 渲染「结束时间」单选项（v-for="(label, value) in END_MODES"），
  //    漏了这行时它在模板里是 undefined，单选项会**静默变成空**（Vue 只在控制台警告，不报错）。
  END_MODES,
  describeEndTimeRequirement,
  describeTaskFile,
  formatTaskVolume,
  isValidTaskDate,
  isValidTaskTime,
  normalizeTaskFileIds,
  normalizeTaskPlayerIds,
  taskIdKind
} from '@/constants/task'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 系统媒体文件（NAS 原始字段），文件任务的候选之一 */
  files: { type: Array, default: () => [] },
  /** 播放列表（NAS 原始字段），文件任务里以 FFxx 引用 */
  playLists: { type: Array, default: () => [] },
  /** 播放终端（设备管理里的「播放终端」列表） */
  players: { type: Array, default: () => [] },
  /** 采播器（设备管理里的「被动采播器」列表） */
  capturers: { type: Array, default: () => [] },
  /** 终端分组，用于把 FFFFFFxx 显示成分组名 */
  groups: { type: Array, default: () => [] },
  /** 是否正在提交（页面在发请求） */
  submitting: { type: Boolean, default: false },
  /** 最近一次提交成功的结果 { taskId, taskSn }；null 表示本次还没提交过 */
  result: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

// ---------------- 表单状态 ----------------
const taskType = ref(TASK_TYPE_FILE)
const taskName = ref('')
const priority = ref(0)
const autoPause = ref(false)
const autoStop = ref(false)

/** 文件任务的播放内容（有序：顺序播放 / 列表循环时数组顺序就是播放顺序） */
const fileIds = ref([])
const fileKeyword = ref('')

/** 采播任务的采播器（单个设备 ID） */
const capturerId = ref('')

/** 文字语音任务的文本 */
const voiceText = ref('')

/** 播放参数：只对文件播放(0) 与文字语音(7) 有意义；缺省值与手册一致 */
const playMode = ref(2)
const loopTimes = ref(0)
/** 任务音量：0 = 0dB（最大），数值越大越小声 */
const taskVolume = ref(0)

/** 播放目标：8 位终端 ID 或 FFFFFFxx 分组引用 */
const playerIds = ref([])

/** 结束时间：0 不指定 / 1 指定绝对时刻 / 3 持续指定时长 */
const endMode = ref(0)
const endDate = ref('')
const endTime = ref('')

// 每次打开都重置成「新建」状态：提交任务是独立的一次操作，不该复用上次的输入
// （上次的 TaskID / TaskSN 由页面在打开时一起清掉）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    taskType.value = TASK_TYPE_FILE
    taskName.value = ''
    priority.value = 0
    autoPause.value = false
    autoStop.value = false
    fileIds.value = []
    fileKeyword.value = ''
    capturerId.value = ''
    voiceText.value = ''
    playMode.value = 2
    loopTimes.value = 0
    taskVolume.value = 0
    playerIds.value = []
    endMode.value = 0
    endDate.value = ''
    endTime.value = ''
  }
)

const isFileTask = computed(() => Number(taskType.value) === TASK_TYPE_FILE)
const isCaptureTask = computed(() => Number(taskType.value) === TASK_TYPE_CAPTURE)
const isVoiceTask = computed(() => Number(taskType.value) === TASK_TYPE_VOICE)
const currentType = computed(
  () => SUBMITTABLE_TASK_TYPES.find((item) => item.value === taskType.value) || SUBMITTABLE_TASK_TYPES[0]
)

// ---------------- 文件任务：候选（系统媒体 + 播放列表） ----------------

/**
 * 候选条目：系统媒体文件 + 播放列表引用。
 * ⚠️ 形如 `FFxx` 的**系统媒体文件**不能出现在候选里：手册规定 FileList 里 `FFxx` 一律被当成
 *    播放列表引用（两种写法都是 4 位十六进制，无法区分），列出来只会让用户以为在放这个文件。
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

/** 候选列表：按关键字过滤，并去掉已选项（已选的会出现在右侧有序列表里） */
const filteredCandidates = computed(() => {
  const text = fileKeyword.value.trim().toLowerCase()
  const selected = new Set(fileIds.value)
  return fileCandidates.value.filter((item) => {
    if (selected.has(item.value)) return false
    if (!text) return true
    return [item.value, item.label].some((field) => String(field).toLowerCase().includes(text))
  })
})

/** 已选内容（补出类型与名称；查不到名称也照旧显示，只是没有名字） */
const selectedFiles = computed(() =>
  fileIds.value.map((id) => ({
    value: id,
    ...describeTaskFile(id, { mediaFiles: props.files, playLists: props.playLists })
  }))
)

/** 播放内容引用的类型文案（describeTaskFile 的 kind → 中文） */
const FILE_KIND_TEXT = { file: '文件', playlist: '列表', invalid: '非法' }

/** 已选条目的类型文案 */
function fileKindText(kind) {
  return FILE_KIND_TEXT[kind] || '未知'
}

const canAddMoreFiles = computed(() => fileIds.value.length < TASK_FILE_MAX)

function addFile(fileId) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  if (!id || fileIds.value.includes(id) || !canAddMoreFiles.value) return
  fileIds.value.push(id)
}

/** 一次把候选里还能加的条目全加进来（最多加到 180 项上限） */
function addAllCandidates() {
  const room = TASK_FILE_MAX - fileIds.value.length
  filteredCandidates.value.slice(0, Math.max(room, 0)).forEach((item) => addFile(item.value))
}

function removeFile(index) {
  fileIds.value.splice(index, 1)
}

/** 上移 / 下移：顺序播放与列表循环时数组顺序就是播放顺序，所以顺序必须可调 */
function moveFile(index, offset) {
  const target = index + offset
  if (target < 0 || target >= fileIds.value.length) return
  const [item] = fileIds.value.splice(index, 1)
  fileIds.value.splice(target, 0, item)
}

// ---------------- 播放目标（终端 + 分组） ----------------

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
const selectedPlayers = computed(() => {
  const byId = Object.fromEntries(
    [...playerOptions.value, ...groupOptions.value].map((item) => [item.value, item])
  )
  return playerIds.value.map((id) => {
    const hit = byId[id]
    return {
      value: id,
      label: hit ? hit.label : `${id}（不在当前终端 / 分组列表里）`,
      kind: hit ? (hit.memberCount === undefined ? 'terminal' : 'group') : 'unknown',
      online: hit ? hit.online : undefined
    }
  })
})

/** 已选里不在线的终端数（离线终端不会真正播放，但任务可以先提交） */
const offlinePlayerCount = computed(
  () => selectedPlayers.value.filter((item) => item.online === false).length
)

/** 已选里在终端 / 分组列表都找不到的 ID 数（设备已删除等，NAS 侧仍记着它） */
const unknownPlayerCount = computed(
  () => selectedPlayers.value.filter((item) => item.kind === 'unknown').length
)

/** 全选在线终端（分组不自动勾：一不小心就把整组加进来，容易超 248 项） */
function selectOnlinePlayers() {
  const merged = playerIds.value.slice()
  playerOptions.value
    .filter((item) => item.online)
    .forEach((item) => {
      if (!merged.includes(item.value) && merged.length < TASK_PLAYER_MAX) merged.push(item.value)
    })
  playerIds.value = merged
}

// ---------------- 采播任务 ----------------

const capturerOptions = computed(() =>
  (props.capturers || [])
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

/** 手输（allow-create）的采播器可能不在列表里：提示一条，但不拦提交（NAS 才是裁判） */
const selectedCapturer = computed(
  () => capturerOptions.value.find((item) => item.value === capturerId.value) || null
)

// ---------------- 文本长度与结束时间 ----------------

const nameBytes = computed(() => gbkByteLength(taskName.value))
const nameTooLong = computed(() => nameBytes.value > TASK_NAME_MAX_BYTES)
const voiceBytes = computed(() => gbkByteLength(voiceText.value))
const voiceTooLong = computed(() => voiceBytes.value > VOICE_TEXT_MAX_BYTES)

const endRequirement = computed(() =>
  describeEndTimeRequirement({
    taskType: taskType.value,
    playMode: playMode.value,
    loopTimes: loopTimes.value
  })
)
const endRequired = computed(() => endRequirement.value.required)

// 一旦变成「必须指定结束时间」而用户还停在「不指定」，自动切到「持续指定时长」，
// 免得他对着灰掉的提交按钮猜原因（时长仍然要他填）
watch(endRequired, (required) => {
  if (required && Number(endMode.value) === 0) endMode.value = 3
})

// ---------------- 校验与提交 ----------------

const errorText = computed(() => {
  if (nameTooLong.value) {
    return `任务名不能超过 ${TASK_NAME_MAX_BYTES} 个 GBK 字节（中文 / 全角按 2 字节计，当前 ${nameBytes.value} 字节）`
  }
  if (!playerIds.value.length) return '至少要选 1 个播放目标（终端或分组）'
  if (playerIds.value.length > TASK_PLAYER_MAX) {
    return `播放目标最多 ${TASK_PLAYER_MAX} 个（当前 ${playerIds.value.length} 个）`
  }

  if (isFileTask.value) {
    if (!fileIds.value.length) return '文件播放任务至少要选 1 项播放内容（文件或播放列表）'
    if (fileIds.value.length > TASK_FILE_MAX) {
      return `播放内容最多 ${TASK_FILE_MAX} 项（当前 ${fileIds.value.length} 项）`
    }
  }
  if (isCaptureTask.value && !String(capturerId.value || '').trim()) {
    return '采播任务必须选择一台采播器'
  }
  if (isVoiceTask.value) {
    if (!voiceText.value.trim()) return '文字语音任务必须填写要播报的文本'
    if (voiceTooLong.value) {
      return `文本不能超过 ${VOICE_TEXT_MAX_BYTES} 个 GBK 字节（当前 ${voiceBytes.value} 字节，约 179 个汉字）`
    }
  }

  if (endRequired.value && Number(endMode.value) === 0) {
    return `必须指定结束时间：${endRequirement.value.reason}`
  }
  if (Number(endMode.value) === 1) {
    if (!isValidTaskDate(endDate.value)) return '结束日期格式应为 YY-MM-DD（例如 26-09-30）'
    if (!isValidTaskTime(endTime.value)) return '结束时刻格式应为 hh:mm:ss（例如 18:30:00）'
  }
  if (Number(endMode.value) === 3 && !isValidTaskTime(endTime.value)) {
    return '持续时长格式应为 hh:mm:ss（例如 01:30:00 表示 1 小时 30 分）'
  }

  return ''
})

const canSubmit = computed(() => !errorText.value)

/**
 * 组装请求体（小驼峰）。
 * 只带该类型有意义的字段：采播任务带 playMode / loopTimes 会被后端拒；
 * endMode=0（不指定）是缺省值，所以干脆不发这几个时间字段。
 */
function buildPayload() {
  const payload = {
    taskType: Number(taskType.value),
    playerList: normalizeTaskPlayerIds(playerIds.value),
    priority: Number(priority.value) || 0,
    autoPause: autoPause.value ? 1 : 0,
    autoStop: autoStop.value ? 1 : 0,
    // 0 = 0dB（最大）；不填也等价，但显式给出来更直白
    taskVolume: Number(taskVolume.value) || 0
  }

  const name = taskName.value.trim()
  if (name) payload.taskName = name

  if (isFileTask.value) payload.fileList = normalizeTaskFileIds(fileIds.value)
  if (isCaptureTask.value) payload.capturerId = String(capturerId.value || '').trim().toUpperCase()
  if (isVoiceTask.value) payload.voiceText = voiceText.value.trim()

  // 播放模式 / 循环次数只对文件播放与文字语音有意义
  if (!isCaptureTask.value) {
    payload.playMode = Number(playMode.value)
    payload.loopTimes = Number(loopTimes.value) || 0
  }

  if (Number(endMode.value) === 1) {
    payload.endMode = 1
    payload.endDate = endDate.value.trim()
    payload.endTime = endTime.value.trim()
  } else if (Number(endMode.value) === 3) {
    payload.endMode = 3
    // EndMode=3 时 EndTime 的语义是「持续时长」，没有日期字段
    payload.endTime = endTime.value.trim()
  }

  return payload
}

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', buildPayload())
}

/** 复制：提交成功后的 TaskID / TaskSN 必须抄走（控制这条任务时要成对使用） */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${text}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="提交临时任务"
    width="880px"
    top="6vh"
    :close-on-click-modal="false"
  >
    <el-form label-position="top" class="task-form" @submit.prevent="handleConfirm">
      <!-- 1. 任务类型：只有 0 / 1 / 7（没有对讲 3） -->
      <el-form-item label="任务类型">
        <el-radio-group v-model="taskType" :disabled="submitting">
          <el-radio-button v-for="item in SUBMITTABLE_TASK_TYPES" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <p class="task-form__hint">{{ currentType.hint }}（提交端不支持「对讲」任务）</p>

      <!-- 2.1 文件播放：左侧候选（系统媒体 + 播放列表），右侧有序清单 -->
      <el-form-item
        v-if="isFileTask"
        :label="`播放内容（已选 ${fileIds.length} / ${TASK_FILE_MAX} 项，顺序即播放顺序）`"
      >
        <div class="task-form__picker">
          <div class="task-form__col">
            <el-input
              v-model="fileKeyword"
              size="small"
              placeholder="搜索文件名 / 文件 ID / 播放列表名"
              clearable
            />
            <ul class="task-form__list">
              <li v-for="item in filteredCandidates" :key="item.value" class="task-form__row">
                <span class="task-form__row-main">
                  <el-tag size="small" effect="plain" :type="item.kind === 'playlist' ? 'warning' : 'info'">
                    {{ item.kind === 'playlist' ? '播放列表' : '媒体文件' }}
                  </el-tag>
                  <span class="task-form__row-name">{{ item.label || '（无名称）' }}</span>
                  <span class="task-form__mono">{{ item.value }}</span>
                </span>
                <el-button
                  size="small"
                  text
                  type="primary"
                  :disabled="!canAddMoreFiles"
                  @click="addFile(item.value)"
                >
                  添加
                </el-button>
              </li>
              <li v-if="!filteredCandidates.length" class="task-form__empty">没有可添加的候选</li>
            </ul>
            <div class="task-form__col-foot">
              <span class="task-form__hint">候选共 {{ fileCandidates.length }} 项</span>
              <el-button
                size="small"
                :disabled="!canAddMoreFiles || !filteredCandidates.length"
                @click="addAllCandidates"
              >
                把当前候选全部添加
              </el-button>
            </div>
          </div>
          <div class="task-form__col">
            <p class="task-form__hint">已选清单（顺序播放 / 列表循环时按这里的顺序播）</p>
            <ul class="task-form__list">
              <li v-for="(item, index) in selectedFiles" :key="item.fileId" class="task-form__row">
                <span class="task-form__row-main">
                  <span class="task-form__index">{{ index + 1 }}</span>
                  <el-tag
                    size="small"
                    effect="plain"
                    :type="item.kind === 'playlist' ? 'warning' : item.kind === 'file' ? 'info' : 'danger'"
                  >
                    {{ fileKindText(item.kind) }}
                  </el-tag>
                  <span class="task-form__row-name" :class="{ 'task-form__row-name--muted': !item.known }">
                    {{ item.name || '（名称未知）' }}
                  </span>
                  <span class="task-form__mono">{{ item.fileId }}</span>
                </span>
                <span class="task-form__row-actions">
                  <el-button size="small" text :disabled="index === 0" @click="moveFile(index, -1)">上移</el-button>
                  <el-button
                    size="small"
                    text
                    :disabled="index === selectedFiles.length - 1"
                    @click="moveFile(index, 1)"
                  >
                    下移
                  </el-button>
                  <el-button size="small" text type="danger" @click="removeFile(index)">移除</el-button>
                </span>
              </li>
              <li v-if="!selectedFiles.length" class="task-form__empty">还没选播放内容</li>
            </ul>
          </div>
        </div>
      </el-form-item>
      <p v-if="isFileTask && ambiguousFileCount" class="task-form__warn">
        有 {{ ambiguousFileCount }} 个系统媒体文件的 ID 形如 FFxx：手册规定 FileList 里 FFxx 一律按「播放列表引用」
        解释，所以它们不能直接放进文件任务（想播它们请先编进播放列表）。
      </p>

      <!-- 2.2 采播：选一台采播器 -->
      <el-form-item v-if="isCaptureTask" label="采播器（设备管理里的「被动采播器」，一次只能选一台）">
        <el-select
          v-model="capturerId"
          class="task-form__select"
          placeholder="选择采播器；也可直接输入 8 位设备 ID"
          filterable
          allow-create
          default-first-option
          clearable
          :disabled="submitting"
        >
          <el-option v-for="item in capturerOptions" :key="item.value" :value="item.value" :label="item.label">
            <span class="task-form__row-main">
              <span class="task-form__row-name">{{ item.label }}</span>
              <el-tag size="small" effect="plain" :type="item.stateTag">{{ item.stateText }}</el-tag>
            </span>
          </el-option>
        </el-select>
      </el-form-item>
      <p v-if="isCaptureTask && capturerId && !selectedCapturer" class="task-form__warn">
        采播器 {{ capturerId }} 不在当前设备列表里（可能是历史 / 已删除的设备，或手输有误）。
        提交不会被拦，但 NAS 会以它的实际状态为准。
      </p>

      <!-- 2.3 文字语音：文本 + 实时 GBK 字节计数 -->
      <el-form-item v-if="isVoiceTask" label="播报文本">
        <el-input
          v-model="voiceText"
          type="textarea"
          :rows="4"
          placeholder="例如：请注意，三层设备检修，请勿靠近。"
          :disabled="submitting"
        />
      </el-form-item>
      <p
        v-if="isVoiceTask"
        class="task-form__counter"
        :class="{ 'task-form__counter--error': voiceTooLong }"
      >
        GBK 字节 {{ voiceBytes }} / {{ VOICE_TEXT_MAX_BYTES }}（约 179 个汉字；中文 / 全角按 2 字节计，超出 NAS 会截断）
      </p>

      <!-- 3. 播放参数：只对文件播放与文字语音有意义 -->
      <template v-if="!isCaptureTask">
        <el-form-item label="播放模式">
          <el-radio-group v-model="playMode" :disabled="submitting">
            <el-radio v-for="item in PLAY_MODE_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="`循环次数（0 = 不限，1~${TASK_LOOP_TIMES_MAX}；只在循环类播放模式下有效，超过 ${TASK_LOOP_TIMES_MAX} NAS 会当成 0）`">
          <el-input-number v-model="loopTimes" :min="0" :max="TASK_LOOP_TIMES_MAX" :disabled="submitting" />
        </el-form-item>
      </template>
      <p v-else class="task-form__hint">
        采播任务没有播放模式与循环次数（带上这两个字段后端会直接拒，所以表单里不出现）。
      </p>

      <el-form-item :label="`任务音量（0 = 最大 / 0dB，${TASK_VOLUME_MAX} = 静音）：${formatTaskVolume(taskVolume)}`">
        <el-slider
          v-model="taskVolume"
          :min="0"
          :max="TASK_VOLUME_MAX"
          :step="1"
          show-input
          :disabled="submitting"
        />
      </el-form-item>
      <p class="task-form__hint">
        任务音量与设备基础音量是同一套衰减口径：终端实际音量 = 基础音量 + 任务音量（数值越大越小声）。
      </p>

      <!-- 4. 播放目标：终端 ID 或 FFFFFFxx 分组引用，至少 1 个 -->
      <el-form-item :label="`播放目标（已选 ${playerIds.length} / ${TASK_PLAYER_MAX} 个，终端或分组）`">
        <el-select
          v-model="playerIds"
          class="task-form__select"
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
              <span class="task-form__row-main">
                <span class="task-form__row-name">{{ item.label }}</span>
                <el-tag size="small" effect="plain" :type="item.stateTag">{{ item.stateText }}</el-tag>
              </span>
            </el-option>
          </el-option-group>
          <el-option-group label="终端分组（引用分组 = 发给组内所有终端）">
            <el-option v-for="item in groupOptions" :key="item.value" :value="item.value" :label="item.label">
              <span class="task-form__row-main">
                <span class="task-form__row-name">{{ item.label }}</span>
                <span class="task-form__hint">含 {{ item.memberCount }} 个终端</span>
              </span>
            </el-option>
          </el-option-group>
        </el-select>
        <div class="task-form__col-foot">
          <el-button size="small" :disabled="submitting" @click="selectOnlinePlayers">加入全部在线终端</el-button>
          <el-button size="small" :disabled="submitting || !playerIds.length" @click="playerIds = []">清空</el-button>
        </div>
      </el-form-item>
      <p v-if="offlinePlayerCount" class="task-form__warn">
        已选目标里有 {{ offlinePlayerCount }} 个终端当前离线：任务可以提交，但这些终端现在收不到声音。
      </p>
      <p v-if="unknownPlayerCount" class="task-form__warn">
        已选目标里有 {{ unknownPlayerCount }} 个 ID 在设备 / 分组列表里查不到（设备可能已删除）：NAS 侧仍会按这个 ID 下发。
      </p>

      <!-- 5. 通用字段 -->
      <el-form-item :label="`任务名（可选，≤ ${TASK_NAME_MAX_BYTES} 个 GBK 字节）`">
        <el-input
          v-model="taskName"
          placeholder="留空时 NAS 命名为 HTTP API Requested Task"
          clearable
          :disabled="submitting"
        />
      </el-form-item>
      <p v-if="taskName" class="task-form__counter" :class="{ 'task-form__counter--error': nameTooLong }">
        GBK 字节 {{ nameBytes }} / {{ TASK_NAME_MAX_BYTES }}
      </p>

      <el-form-item :label="`优先等级（0 ~ ${TASK_PRIORITY_MAX}，越大越优先）`">
        <el-input-number v-model="priority" :min="0" :max="TASK_PRIORITY_MAX" :disabled="submitting" />
      </el-form-item>
      <p class="task-form__hint">
        优先等级只在「同一任务类内」排队：HTTP API 提交的临时任务固定属于第 11 类「第三方软件插播」，
        抢不过消防 / 紧急采播 / 寻呼话筒等更高任务类的任务。
      </p>

      <el-form-item label="自动暂停 / 自动停止（缺省都是「否」）">
        <div class="task-form__switches">
          <el-switch v-model="autoPause" active-text="自动暂停" :disabled="submitting" />
          <el-switch v-model="autoStop" active-text="自动停止" :disabled="submitting" />
        </div>
      </el-form-item>
      <p class="task-form__hint">
        手册只给出这两个开关的取值（0 否 / 1 是）与缺省值，没有展开语义，这里如实透传。
      </p>

      <!-- 6. 结束时间 -->
      <el-form-item label="结束时间（开始时间固定「即时开始」；定时 / 预约请用「定时任务」模块）">
        <el-radio-group v-model="endMode" :disabled="submitting">
          <el-radio v-for="(label, value) in END_MODES" :key="value" :value="Number(value)">{{ label }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="Number(endMode) === 1" label="结束日期 / 时刻（YY-MM-DD 与 hh:mm:ss）">
        <div class="task-form__inline">
          <el-input v-model="endDate" placeholder="26-09-30" class="task-form__datetime" :disabled="submitting" />
          <el-input v-model="endTime" placeholder="18:30:00" class="task-form__datetime" :disabled="submitting" />
        </div>
      </el-form-item>
      <el-form-item v-if="Number(endMode) === 3" label="持续时长（hh:mm:ss，例如 01:30:00 = 1 小时 30 分）">
        <el-input v-model="endTime" placeholder="01:30:00" class="task-form__datetime" :disabled="submitting" />
      </el-form-item>
      <p v-if="endRequired" class="task-form__warn">
        本项目强制要求结束时间：{{ endRequirement.reason }}。
      </p>
      <p v-else class="task-form__hint">
        不指定结束时任务会一直运行，直到在下面的「正在运行的任务」里把它停掉。
      </p>
      <p class="task-form__hint">
        ⚠️ 提交成功 ≠ 一定会出声：文件不存在、采播器启动失败、终端不在线都会让任务「一开始就退出」，看起来像凭空消失。
      </p>

      <!-- 7. 提交结果：控制这条任务必须成对回传 TaskID + TaskSN -->
      <el-alert v-if="result && result.taskId" type="success" :closable="false" class="task-form__alert">
        <template #title>提交成功 —— TaskID / TaskSN 是控制这条任务的唯一凭据，请先复制保存</template>
        <div class="task-form__result">
          <span>TaskID <span class="task-form__mono">{{ result.taskId }}</span></span>
          <el-button size="small" text type="primary" @click="copyText(result.taskId)">复制 TaskID</el-button>
          <span>TaskSN <span class="task-form__mono">{{ result.taskSn }}</span></span>
          <el-button size="small" text type="primary" @click="copyText(result.taskSn)">复制 TaskSN</el-button>
        </div>
        <p class="task-form__hint">{{ taskIdKind(result.taskId).text }}</p>
      </el-alert>
    </el-form>
    <template #footer>
      <div class="task-form__footer">
        <span class="task-form__footer-error">{{ errorText }}</span>
        <span class="task-form__footer-actions">
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
            {{ submitting ? '提交中…' : '提交任务' }}
          </el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.task-form__hint {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.task-form__warn {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.task-form__counter {
  margin: -12px 0 14px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.task-form__counter--error {
  color: var(--el-color-danger);
}

.task-form__select {
  width: 100%;
}

.task-form__picker {
  display: flex;
  gap: 12px;
  width: 100%;
}

.task-form__col {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.task-form__col-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
}

.task-form__col-foot .task-form__hint {
  margin: 0;
}

.task-form__list {
  height: 260px;
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.task-form__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  font-size: 12px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.task-form__row-main {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.task-form__row-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-form__row-name--muted {
  color: var(--el-text-color-placeholder);
}

.task-form__row-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}

.task-form__index {
  flex: 0 0 22px;
  color: var(--el-text-color-placeholder);
}

.task-form__mono {
  flex: 0 0 auto;
  font-family: Consolas, Monaco, 'Courier New', monospace;
}

.task-form__empty {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.task-form__inline {
  display: flex;
  gap: 8px;
}

.task-form__datetime {
  width: 160px;
}

.task-form__switches {
  display: flex;
  gap: 24px;
}

.task-form__alert {
  margin-bottom: 8px;
}

.task-form__result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  font-size: 12px;
}

.task-form__alert .task-form__hint {
  margin: 6px 0 0;
}

.task-form__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-form__footer-error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
  text-align: left;
}

.task-form__footer-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>