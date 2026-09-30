<script setup>
// src/components/deviceTasks/DeviceTaskFormDialog.vue —— 新建 / 编辑一条设备任务
//
// 契约：ip-audio-speaker-backend/docs/API.md「设备任务模块」（NAS 手册 P68-80，见 docs/impl-notes.md §六）。
//
// 这个弹窗承担四件事：
//   1) **任务类型只能从设备类型支持的那几个里选**（手册 P79 的类型表 → constants/deviceTask.js）；
//   2) 播放内容按类型分支：文件（4C / 3E 从**报警媒体**选，其余从系统媒体选，也可手输 4 位 FileID）/
//      采播（选一台采播器，带 ActCapturer 限定的设备可以留空 = 设备自身）/ 对讲（CapturerID 可留空，
//      主叫方是设备自身）/ 文字语音（≤358 GBK 字节）；
//   3) 播放目标默认多选；**对讲任务只能有一个（第一个即被叫方）**，所以对讲时换成单选；
//   4) 前端先按后端 DTO 的口径校验（格式 / 上限 / 类型是否支持 / endMode 与 endTime 配套），
//      再把「NAS 不会报错、但很可能是配错了」的情况（ActPlayer 限定、分组写法、FFxx）作为黄字提示。
//
// ⚠️ 编辑态是从**列表行**回填的（`GET /api/device-tasks/{deviceId}` 的元素）。手册的
//    `DeviceTaskList.Data[]` 字段表里**没有 `Disable`**，所以「当前是启用还是禁用」看不到：
//    弹窗里如实标注，并让用户自己选这次要下发启用（0）还是禁用（1）。
// ⚠️ 保存是**整体设置**（NAS 的 DeviceTaskSet 语义）：重新启用一条任务必须把内容一起发回去。

import { computed, ref, watch } from 'vue'
import { gbkByteLength, isValidDeviceId } from '@/constants/device'
import {
  PLAY_MODE_OPTIONS,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_FILE,
  TASK_TYPE_TALK,
  TASK_TYPE_VOICE,
  TASK_TYPES,
  formatTaskVolume
} from '@/constants/task'
import {
  DEVICE_TASK_FILE_MAX,
  DEVICE_TASK_INDEX_MIN,
  DEVICE_TASK_MAX,
  DEVICE_TASK_NAME_MAX_BYTES,
  DEVICE_TASK_PRIORITY_MAX,
  DEVICE_TASK_VOICE_TEXT_MAX_BYTES,
  DEVICE_TASK_VOLUME_MAX,
  HINT_ACT_PLAYER,
  HINT_ALARM_FILE,
  HINT_BOUND_DEVICE,
  HINT_CAPTURER_SELF,
  HINT_CATALOG_FIRST,
  HINT_DISABLE_ONLY,
  HINT_END_MODE_4,
  HINT_END_MODE_4_CONFIRM,
  HINT_FILE_ID,
  HINT_MAX_TASKS,
  HINT_PLAYER_ID,
  HINT_TALK_CAPTURER,
  HINT_TALK_FIRST_CALLEE,
  HINT_TRIGGER_NO_CHECK,
  buildDeviceTaskEndTime,
  buildDeviceTaskPayload,
  canUseEndMode4,
  createDeviceTaskForm,
  describeDeviceSupport,
  describeDeviceTypeForTask,
  describeTaskIndexLabel,
  deviceTaskWarnings,
  limitsDeviceAsCapturer,
  limitsDeviceAsPlayer,
  needsAlarmFile,
  needsDeviceTask,
  normalizeDeviceTaskIds,
  supportTaskTypes,
  validateDeviceTaskPayload
} from '@/constants/deviceTask'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 目标设备 ID（8 位十六进制） */
  deviceId: { type: String, default: '' },
  /** 目标设备类型（2 位十六进制，来自设备列表；拿不到时传空串） */
  deviceType: { type: String, default: '' },
  /** 目标设备名称（来自设备列表；目录接口本身没有名称字段，拿不到时传空串） */
  deviceName: { type: String, default: '' },
  /** 编辑时传 NAS 行；新建时传 null */
  task: { type: Object, default: null },
  /** 新建时推荐的任务序号（页面用 recommendTaskIndex 算；0 表示已满 128 条） */
  taskIndexSuggestion: { type: Number, default: 0 },
  /** 播放内容候选项（buildTaskFileOptions 的产物；4C / 3E 传的是**报警媒体**） */
  fileOptions: { type: Array, default: () => [] },
  /** 播放内容的来源说明（'系统媒体' / '报警媒体'） */
  fileSourceLabel: { type: String, default: '系统媒体' },
  /** 采播器候选项（buildTaskCapturerOptions 的产物） */
  capturerOptions: { type: Array, default: () => [] },
  /** 普通任务的播放目标候选项（buildTaskPlayerOptions 的产物） */
  playerOptions: { type: Array, default: () => [] },
  /** 对讲任务的被叫方候选项（buildTalkPlayerOptions 的产物） */
  talkPlayerOptions: { type: Array, default: () => [] },
  /** 父页面正在提交（保存按钮转圈） */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 表单值（元素都是 ID；`endMode=4` 的时间拆成「起始时分 + 小时数」两段） */
const form = ref(createDeviceTaskForm())
/** `endMode=4` 的强制确认（手册没给「特殊设备」的类型清单，只能让用户确认） */
const endMode4Confirmed = ref(false)

const deviceId = computed(() => String(props.deviceId || '').trim().toUpperCase())
const deviceType = computed(() => String(props.deviceType || '').trim().toUpperCase())
const isEdit = computed(() => Boolean(props.task))
const knownType = computed(() => needsDeviceTask(deviceType.value))

/** 该设备支持的任务类型（类型表的原始顺序） */
const allowedTypes = computed(() => supportTaskTypes(deviceType.value))
/** 类型单选项（label 用 constants/task.js 的字典，hint 说明该类型需要的「内容」字段） */
const typeOptions = computed(() =>
  allowedTypes.value.map((value) => ({
    value,
    label: TASK_TYPES[value] || `未知类型（${value}）`,
    hint: describeTaskTypeHint(value)
  }))
)
const currentTypeHint = computed(() => describeTaskTypeHint(form.value.taskType))

const isFileTask = computed(() => Number(form.value.taskType) === TASK_TYPE_FILE)
const isCaptureTask = computed(() => Number(form.value.taskType) === TASK_TYPE_CAPTURE)
const isTalkTask = computed(() => Number(form.value.taskType) === TASK_TYPE_TALK)
const isVoiceTask = computed(() => Number(form.value.taskType) === TASK_TYPE_VOICE)

/** 该设备带 ActCapturer 限定：采播内容来自设备自身，CapturerID 可以留空 */
const capturerSelf = computed(() => limitsDeviceAsCapturer(deviceType.value))
/** 该设备带 ActPlayer 限定：播放目标里应包含设备自身 */
const actPlayer = computed(() => limitsDeviceAsPlayer(deviceType.value))
/** 文件来自报警媒体（4C / 3E） */
const alarmFile = computed(() => needsAlarmFile(deviceType.value))
/** 该设备类型能否选 endMode=4（清单未知时一律可选，靠确认框兜） */
const endMode4Available = computed(() => canUseEndMode4(deviceType.value))

function describeTaskTypeHint(taskType) {
  const value = Number(taskType)
  if (value === TASK_TYPE_FILE) {
    return alarmFile.value
      ? '按 FileList 播放：这台设备的文件来自报警媒体（不是系统媒体）'
      : '按 FileList 播放：从系统媒体里选文件（4 位 FileID）'
  }
  if (value === TASK_TYPE_CAPTURE) {
    return capturerSelf.value
      ? '把采播器的实时音频广播给播放终端；这台设备就是采播源，采播器可以留空'
      : '把指定采播器的实时音频广播给播放终端；必须指定采播器'
  }
  if (value === TASK_TYPE_TALK) {
    return '对讲任务：设备自身是主叫方，播放目标的第一个是「被叫方」（只能有一个）'
  }
  return '把文本转成语音播出去（≤358 个 GBK 字节，约 179 个汉字）'
}

// ---------------- 表单填充 ----------------

/** `hh:mm:ss` 的第三段在 endMode=4 里是「小时数」，拆出来给两个输入框用 */
function splitEndTime(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(value == null ? '' : value).trim())
  if (!match) return null
  return { start: `${match[1]}:${match[2]}`, hours: Number(match[3]) }
}

/** 用一条 NAS 行铺表单（编辑态） */
function seedFromTask(task) {
  const base = createDeviceTaskForm({
    deviceId: deviceId.value,
    taskIndex: Number(task && task.TaskIndex),
    deviceType: deviceType.value
  })
  const source = task || {}
  const taskType = Number(source.TaskType)
  const endMode = Number(source.EndMode) || 0
  const endTime = String(source.EndTime == null ? '' : source.EndTime).trim()
  const split = endMode === 4 ? splitEndTime(endTime) : null
  const next = {
    ...base,
    // ⚠️ 列表里没有 Disable：默认按「启用」打开（保存就是要这条任务生效），用户可自行改成禁用
    disable: Number(source.Disable) === 1 ? 1 : 0,
    taskName: String(source.TaskName == null ? '' : source.TaskName),
    priority: Number.isInteger(Number(source.Priority)) ? Number(source.Priority) : 0,
    autoPause: Number(source.AutoPause) === 1 ? 1 : 0,
    autoStop: Number(source.AutoStop) === 1 ? 1 : 0,
    // 行里的类型理应合法；万一不在支持列表里（历史数据）也保留，由校验提示用户改
    taskType: Number.isInteger(taskType) ? taskType : base.taskType,
    endMode,
    endTime: endMode === 4 ? '' : endTime,
    endTimeStart: split ? split.start : base.endTimeStart,
    endTimeHours: split ? split.hours : base.endTimeHours,
    taskVolume: Number.isInteger(Number(source.TaskVolume)) ? Number(source.TaskVolume) : 0,
    capturerId: String(source.CapturerID == null ? '' : source.CapturerID).trim().toUpperCase(),
    voiceText: String(source.VoiceText == null ? '' : source.VoiceText),
    fileList: normalizeDeviceTaskIds(source.FileList),
    playerList: normalizeDeviceTaskIds(source.PlayerList)
  }
  if (taskType !== 1 && taskType !== 3) {
    next.playMode = Number.isInteger(Number(source.PlayMode)) ? Number(source.PlayMode) : 2
    next.loopTimes = Number.isInteger(Number(source.LoopTimes)) ? Number(source.LoopTimes) : 0
  }
  return next
}

// 每次打开：新建 → 重置成初值（序号用页面推荐值）；编辑 → 从行里回填
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    endMode4Confirmed.value = false
    form.value = props.task
      ? seedFromTask(props.task)
      : createDeviceTaskForm({
          deviceId: deviceId.value,
          taskIndex: props.taskIndexSuggestion,
          deviceType: deviceType.value
        })
  }
)

/**
 * 切换任务类型时清掉与新类型无关的内容，避免带着上一个类型的内容提交
 * （例如「文件任务 → 采播任务」后，FileList 不该再跟着发出去）。
 */
watch(
  () => form.value.taskType,
  (taskType, previous) => {
    const type = Number(taskType)
    if (previous === undefined || type === Number(previous)) return
    if (type === TASK_TYPE_CAPTURE || type === TASK_TYPE_TALK) form.value.fileList = []
    if (type === TASK_TYPE_TALK) form.value.playerList = form.value.playerList.slice(0, 1)
    if (type === TASK_TYPE_FILE || type === TASK_TYPE_VOICE) form.value.capturerId = ''
  }
)

// ---------------- 提交体、校验、提示 ----------------

/**
 * 实际发给 NAS 的请求体。
 * `endMode=4` 时浏览器里是两个输入框，这里先拼回 `hh:mm:ss` 再交给 `buildDeviceTaskPayload`。
 */
const payload = computed(() => {
  const source = { ...form.value, deviceId: deviceId.value }
  if (Number(source.endMode) === 4) {
    source.endTime = buildDeviceTaskEndTime({
      start: source.endTimeStart,
      hours: source.endTimeHours
    })
  }
  return buildDeviceTaskPayload(source)
})

/** 校验错误（空数组 = 可以保存）；判据与后端 DTO + 手册 P79 一致 */
const errors = computed(() =>
  validateDeviceTaskPayload(payload.value, { deviceId: deviceId.value, deviceType: deviceType.value })
)

/** 「能保存但可能配错了」的提示（不拦提交） */
const warnings = computed(() =>
  deviceTaskWarnings(payload.value, { deviceId: deviceId.value, deviceType: deviceType.value })
)

/** 已选但不在候选项里（设备 / 媒体列表没加载出来，或对象已被删除）：保存时原样保留，这里明确提示 */
function unknownOf(ids, options) {
  const known = new Set(options.map((item) => item.value))
  return ids.filter((id) => !known.has(id))
}
const unknownFiles = computed(() => unknownOf(normalizeDeviceTaskIds(form.value.fileList), props.fileOptions))
const playerOptionList = computed(() => (isTalkTask.value ? props.talkPlayerOptions : props.playerOptions))
const unknownPlayers = computed(() => unknownOf(form.value.playerList, playerOptionList.value))
const unknownCapturers = computed(() => unknownOf([form.value.capturerId].filter(Boolean), props.capturerOptions))

const nameBytes = computed(() => gbkByteLength(form.value.taskName))
const voiceBytes = computed(() => gbkByteLength(form.value.voiceText))
const volumeText = computed(() => formatTaskVolume(form.value.taskVolume))
/** 文件任务用哪个媒体列表的名称（提示文案里要用） */
const fileSourceLabel = computed(() => props.fileSourceLabel || '系统媒体')

/** 对讲任务的「被叫方」用单选控件（手册：PlayerList 的第一个是被叫方，只能有一个） */
const calleeId = computed({
  get: () => form.value.playerList[0] || '',
  set: (value) => {
    const id = String(value == null ? '' : value).trim().toUpperCase()
    form.value.playerList = id ? [id] : []
  }
})

/** ActPlayer 限定的设备：一键把自己加进播放目标（手册要求它自己也要出声） */
function addSelfToPlayers() {
  const id = deviceId.value
  if (!isValidDeviceId(id) || form.value.playerList.includes(id)) return
  form.value.playerList = [...form.value.playerList, id]
}

const canSubmit = computed(
  () =>
    Boolean(deviceId.value) &&
    !errors.value.length &&
    !props.submitting &&
    (Number(form.value.endMode) !== 4 || endMode4Confirmed.value)
)

/** 保存按钮的文案：禁用只需要 4 个字段，这里明确区分「禁用」与「保存（启用）」 */
const submitText = computed(() => {
  if (Number(form.value.disable) === 1) return isEdit.value ? '禁用这条任务' : '保存为禁用'
  return isEdit.value ? '保存（启用 / 修改）' : '创建并启用'
})

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', payload.value)
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? `编辑设备任务 #${form.taskIndex}` : '新建设备任务'"
    width="900px"
    top="6vh"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    destroy-on-close
  >
    <el-alert
      class="dvtask-form__alert"
      type="info"
      :closable="false"
      show-icon
      :title="isEdit ? '修改这台设备上的一条设备任务' : '为这台设备新建一条设备任务'"
    >
      <template #default>
        <p class="dvtask-form__hint-line">
          目标设备：<span class="dvtask-form__mono">{{ deviceId }}</span
          ><span v-if="deviceName"> · {{ deviceName }}</span>（{{ describeDeviceTypeForTask(deviceType) }}）
        </p>
        <p class="dvtask-form__hint-line">{{ describeDeviceSupport(deviceType) }}</p>
        <p class="dvtask-form__hint-line">{{ HINT_BOUND_DEVICE }}。</p>
        <p class="dvtask-form__hint-line">{{ HINT_CATALOG_FIRST }}；{{ HINT_MAX_TASKS }}。</p>
        <p class="dvtask-form__hint-line">{{ HINT_TRIGGER_NO_CHECK }}。</p>
      </template>
    </el-alert>

    <el-alert
      v-if="!knownType"
      class="dvtask-form__alert"
      type="warning"
      :closable="false"
      show-icon
      title="手册 P79 的设备类型表里没有这台设备的类型"
      description="拿不到设备类型（设备列表里没找到这台设备，或类型是手册之外的值）时无法判断它支持哪些任务类型；请先刷新设备列表确认，或者直接照手册确认这台设备支持的类型后再保存。"
    />

    <el-form label-position="top" @submit.prevent="handleConfirm">
      <div class="dvtask-form__inline">
        <el-form-item :label="`任务序号（${DEVICE_TASK_INDEX_MIN}~${DEVICE_TASK_MAX}）`">
          <el-input-number
            v-model="form.taskIndex"
            :min="DEVICE_TASK_INDEX_MIN"
            :max="DEVICE_TASK_MAX"
            :disabled="submitting || isEdit"
          />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-radio-group v-model="form.disable" :disabled="submitting">
            <el-radio-button :value="0">启用（要填任务内容）</el-radio-button>
            <el-radio-button :value="1">禁用（只发序号 + 状态）</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </div>
      <p class="dvtask-form__hint">
        {{ describeTaskIndexLabel(deviceType, form.taskIndex) }}：
        {{ isEdit ? '编辑时不能改序号（序号是这条任务的标识，要换序号请新建一条）。' : '序号就是这条任务的标识，同一个设备上不能重复。' }}
      </p>
      <p v-if="isEdit" class="dvtask-form__warn">
        NAS 的设备任务清单（DeviceTaskList）里没有 Disable 字段，所以打开这条任务时看不到它当前是启用还是禁用：
        上面默认按「启用」打开，保存会按你的选择下发（想停用它请选「禁用」）。
      </p>
      <p class="dvtask-form__hint">{{ HINT_DISABLE_ONLY }}。</p>

      <el-form-item :label="`任务名（可选，≤ ${DEVICE_TASK_NAME_MAX_BYTES} 个 GBK 字节）`">
        <el-input v-model="form.taskName" placeholder="留空时 NAS 命名为 Device Task XXX（XXX 即任务序号）" clearable :disabled="submitting" />
      </el-form-item>
      <p v-if="form.taskName" class="dvtask-form__counter" :class="{ 'dvtask-form__counter--error': nameBytes > DEVICE_TASK_NAME_MAX_BYTES }">
        GBK 字节 {{ nameBytes }} / {{ DEVICE_TASK_NAME_MAX_BYTES }}
      </p>

      <el-form-item label="任务类型（只能选这台设备支持的类型）">
        <el-radio-group v-model="form.taskType" :disabled="submitting">
          <el-radio-button v-for="item in typeOptions" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <p class="dvtask-form__hint">{{ currentTypeHint }}。</p>

      <!-- 文件播放：4C / 3E 从报警媒体选，其余从系统媒体选 -->
      <template v-if="isFileTask">
        <el-form-item :label="`播放内容（${fileSourceLabel}，已选 ${form.fileList.length} / ${DEVICE_TASK_FILE_MAX} 项）`">
          <el-select
            v-model="form.fileList"
            class="dvtask-form__select"
            multiple
            filterable
            allow-create
            default-first-option
            collapse-tags
            collapse-tags-tooltip
            :reserve-keyword="false"
            :disabled="submitting"
            :placeholder="`从${fileSourceLabel}里选择；也可直接输入 4 位文件 ID`"
            no-data-text="没有可选的候选文件（先到「媒体文件」页确认列表）"
          >
            <el-option v-for="item in fileOptions" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled">
              <span class="dvtask-form__option">{{ item.label }}</span>
              <el-tag v-if="item.disabled" type="warning" size="small" effect="plain">{{ item.hint }}</el-tag>
            </el-option>
          </el-select>
          <div class="dvtask-form__sub">{{ alarmFile ? HINT_ALARM_FILE : `候选来自「媒体文件」页的${fileSourceLabel}` }}；{{ HINT_FILE_ID }}。</div>
        </el-form-item>
      </template>

      <!-- 文字语音 -->
      <template v-if="isVoiceTask">
        <el-form-item label="播报文本">
          <el-input v-model="form.voiceText" type="textarea" :rows="3" :disabled="submitting" placeholder="要播出来的文字（≤358 个 GBK 字节，约 179 个汉字）" />
        </el-form-item>
        <p class="dvtask-form__counter" :class="{ 'dvtask-form__counter--error': voiceBytes > DEVICE_TASK_VOICE_TEXT_MAX_BYTES }">
          GBK 字节 {{ voiceBytes }} / {{ DEVICE_TASK_VOICE_TEXT_MAX_BYTES }}（中文 / 全角按 2 字节计）
        </p>
      </template>

      <!-- 采播 / 对讲：采播器 -->
      <template v-if="isCaptureTask || isTalkTask">
        <el-form-item :label="capturerSelf ? '采播器（可留空 = 设备自身）' : '采播器（必选）'">
          <el-select
            v-model="form.capturerId"
            class="dvtask-form__select"
            filterable
            allow-create
            clearable
            default-first-option
            :reserve-keyword="false"
            :disabled="submitting"
            placeholder="选择采播器；也可直接输入 8 位设备 ID"
          >
            <el-option v-for="item in capturerOptions" :key="item.value" :label="item.label" :value="item.value">
              <span class="dvtask-form__option">{{ item.label }}</span>
              <span v-if="item.typeText" class="dvtask-form__option-type">{{ item.typeText }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <p class="dvtask-form__hint">{{ isTalkTask ? HINT_TALK_CAPTURER : HINT_CAPTURER_SELF }}。</p>
      </template>
      <!-- 播放目标：对讲任务只能有一个（第一个 = 被叫方） -->
      <el-form-item v-if="isTalkTask" label="被叫方（对讲任务只能有一个）">
        <el-select
          v-model="calleeId"
          class="dvtask-form__select"
          filterable
          allow-create
          clearable
          default-first-option
          :reserve-keyword="false"
          :disabled="submitting"
          placeholder="选择被叫方；也可直接输入 8 位设备 ID"
          no-data-text="没有可选的对讲设备（支持对讲的类型：5F / 6F / 9F / 6E）"
        >
          <el-option v-for="item in talkPlayerOptions" :key="item.value" :label="item.label" :value="item.value">
            <span class="dvtask-form__option">{{ item.label }}</span>
            <span v-if="item.typeText" class="dvtask-form__option-type">{{ item.typeText }}</span>
          </el-option>
        </el-select>
        <div class="dvtask-form__sub">{{ HINT_TALK_FIRST_CALLEE }}；{{ HINT_TALK_CAPTURER }}。</div>
      </el-form-item>

      <el-form-item v-else :label="`播放目标（已选 ${form.playerList.length} / ${DEVICE_TASK_PLAYER_MAX} 项）`">
        <el-select
          v-model="form.playerList"
          class="dvtask-form__select"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :reserve-keyword="false"
          :disabled="submitting"
          placeholder="选择要出声的终端；也可直接输入 8 位设备 ID"
          no-data-text="没有可选的候选设备（先刷新设备列表；也可直接输入 8 位设备 ID）"
        >
          <el-option v-for="item in playerOptions" :key="item.value" :label="item.label" :value="item.value">
            <span class="dvtask-form__option">{{ item.label }}</span>
            <span class="dvtask-form__option-type">{{ item.typeText || item.source }}</span>
          </el-option>
        </el-select>
        <div class="dvtask-form__col-foot">
          <el-button v-if="actPlayer" size="small" :disabled="submitting" @click="addSelfToPlayers">把本设备加入播放目标</el-button>
          <el-button size="small" :disabled="submitting || !form.playerList.length" @click="form.playerList = []">清空</el-button>
        </div>
        <div class="dvtask-form__sub">{{ HINT_PLAYER_ID }}。</div>
        <p v-if="actPlayer" class="dvtask-form__warn">{{ HINT_ACT_PLAYER }}。</p>
      </el-form-item>

      <!-- 播放模式 / 循环：只对文件播放与文字语音有意义 -->
      <template v-if="!isCaptureTask && !isTalkTask">
        <el-form-item label="播放模式">
          <el-radio-group v-model="form.playMode" :disabled="submitting">
            <el-radio v-for="item in PLAY_MODE_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="`循环次数（0 = 不限，1~${DEVICE_TASK_LOOP_TIMES_MAX}）`">
          <el-input-number v-model="form.loopTimes" :min="0" :max="DEVICE_TASK_LOOP_TIMES_MAX" :disabled="submitting" />
        </el-form-item>
        <p class="dvtask-form__hint">采播任务与对讲任务没有播放模式 / 循环次数，切换类型后这里会隐藏并且不发送。</p>
      </template>

      <div class="dvtask-form__inline">
        <el-form-item :label="`任务音量（0~${DEVICE_TASK_VOLUME_MAX}，0 = 最大 / 0dB、127 = 静音）`">
          <el-input-number v-model="form.taskVolume" :min="0" :max="DEVICE_TASK_VOLUME_MAX" :disabled="submitting" />
          <span class="dvtask-form__sub">{{ volumeText }}</span>
        </el-form-item>
        <el-form-item :label="`优先等级（0~${DEVICE_TASK_PRIORITY_MAX}，越大越优先）`">
          <el-input-number v-model="form.priority" :min="0" :max="DEVICE_TASK_PRIORITY_MAX" :disabled="submitting" />
        </el-form-item>
      </div>
      <p class="dvtask-form__hint">
        优先等级只在「同一任务类内」比较（这里填的是 0~15 的数值，与运行任务里 4 位十六进制的 TaskPriority 不是同一个字段）。
      </p>

      <el-form-item label="自动暂停 / 自动停止（缺省都是「否」）">
        <div class="dvtask-form__switches">
          <el-switch v-model="form.autoPause" :active-value="1" :inactive-value="0" active-text="自动暂停" :disabled="submitting" />
          <el-switch v-model="form.autoStop" :active-value="1" :inactive-value="0" active-text="自动停止" :disabled="submitting" />
        </div>
      </el-form-item>

      <!-- 结束方式：只有 0 / 3 / 4，没有「指定绝对时刻」 -->
      <el-form-item label="结束时间（设备任务触发即执行，没有开始时间）">
        <el-radio-group v-model="form.endMode" :disabled="submitting">
          <el-radio :value="0">不指定</el-radio>
          <el-radio :value="3">持续时长</el-radio>
          <el-radio :value="4" :disabled="!endMode4Available">时段触发（仅特殊设备）</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="Number(form.endMode) === 3" label="持续时长（hh:mm:ss，例如 01:30:00 = 1 小时 30 分）">
        <el-input v-model="form.endTime" class="dvtask-form__time" placeholder="01:30:00" :disabled="submitting" />
      </el-form-item>
      <template v-if="Number(form.endMode) === 4">
        <el-form-item label="时段触发：起始时分 + 持续小时数">
          <div class="dvtask-form__inline">
            <el-input v-model="form.endTimeStart" class="dvtask-form__time" placeholder="08:20" :disabled="submitting" />
            <el-input-number v-model="form.endTimeHours" :min="1" :max="99" :disabled="submitting" />
            <span class="dvtask-form__sub">小时</span>
          </div>
        </el-form-item>
        <p class="dvtask-form__warn">{{ HINT_END_MODE_4 }}。</p>
        <p class="dvtask-form__warn">{{ HINT_END_MODE_4_CONFIRM }}。</p>
        <el-form-item label="确认">
          <el-checkbox v-model="endMode4Confirmed" :disabled="submitting">我确认这台设备属于手册所说的「特殊设备」</el-checkbox>
        </el-form-item>
      </template>
      <p v-else class="dvtask-form__hint">
        不指定结束时，任务播完一遍就结束；「持续时长」与「时段触发」都需要补 hh:mm:ss。
      </p>
      <p v-if="unknownFiles.length" class="dvtask-form__warn">
        播放内容里有 {{ unknownFiles.length }} 个文件 ID 不在当前{{ fileSourceLabel }}列表里（{{ unknownFiles.join('、') }}）：
        可能是文件已删除，也可能只是列表没拉全；保存时会原样保留。
      </p>
      <p v-if="unknownPlayers.length" class="dvtask-form__warn">
        播放目标里有 {{ unknownPlayers.length }} 个 ID 不在当前设备列表里（{{ unknownPlayers.join('、') }}）：
        可能是设备已删除，也可能只是列表没拉全；保存时会原样保留。
      </p>
      <p v-if="unknownCapturers.length" class="dvtask-form__warn">
        采播器（{{ unknownCapturers.join('、') }}）不在当前设备列表里：可能是设备已删除，也可能只是列表没拉全。
      </p>

      <p v-for="(item, index) in warnings" :key="`warn-${index}`" class="dvtask-form__warn">{{ item }}</p>

      <el-alert
        v-if="errors.length"
        class="dvtask-form__alert"
        type="error"
        :closable="false"
        show-icon
        :title="`有 ${errors.length} 处问题，修正后才能保存`"
      >
        <template #default>
          <p v-for="(item, index) in errors" :key="index" class="dvtask-form__error-line">{{ item }}</p>
        </template>
      </el-alert>


    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button :type="Number(form.disable) === 1 ? 'danger' : 'primary'" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        {{ submitText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dvtask-form__alert {
  margin-bottom: 12px;
}

.dvtask-form__inline {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.dvtask-form__select {
  width: 100%;
}

.dvtask-form__time {
  width: 160px;
}

.dvtask-form__switches {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

.dvtask-form__option {
  margin-right: 8px;
}

.dvtask-form__option-type {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dvtask-form__mono {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
}

.dvtask-form__sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.dvtask-form__hint {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.dvtask-form__hint-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}

.dvtask-form__counter {
  margin: -8px 0 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dvtask-form__counter--error {
  color: var(--el-color-danger);
}

.dvtask-form__warn {
  margin: 4px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.dvtask-form__col-foot {
  margin-top: 6px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dvtask-form__error-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}
</style>


