<script setup>
// src/components/tasks/TaskControlDialog.vue —— 控制一条正在运行的任务
//
// 接口：POST /api/tasks/control（字段表见 api/task.js）
//
// ⚠️ 控制任务必须**成对**给出 TaskID + TaskSN，且 **TaskSN 不能是 00000000**（手册：为 0 时命令无效）；
//    任务一旦被停掉，这两个值就失效了（要重新提交任务才能再控制）。
// ⚠️ 本项目只开放 4 个操作（见 constants/task.js 的 TASK_CONTROL_OPTIONS）：
//    命令字 1 停止、7 设定任务音量、9 暂停/恢复、9 下一曲。
//    · 命令字 2（停止所有同 TaskID 的任务）没暴露：只需 TaskID 就能停一批，语义容易与「停止全部」混淆；
//    · 命令字 6（停止全部）走列表页的「停止全部」按钮（POST /api/tasks/stop-all）。
// ⚠️ 只有 TaskID 00000001~00000008 才是 HTTP API 提交的临时任务（本后端提交的）；
//    其它来源（管理软件 / 定时任务 / 分控软件）的任务发命令很可能被 NAS 拒绝（Result=8）。
//    所以这里会提示任务来源，但不拦 —— NAS 才是裁判。
//
// 分工：与提交弹窗一致 —— 只负责收集 + 校验 + 组装 payload，请求由列表页调 store 发出。

import { computed, ref, watch } from 'vue'
import {
  describeTaskState,
  formatPlayMode,
  formatTaskType,
  formatTaskVolume,
  getTaskClassName,
  isValidTaskId,
  isValidTaskSn,
  parseTaskPriority,
  taskIdKind,
  TASK_CONTROL_HINT,
  TASK_CONTROL_OPTIONS,
  TASK_STATE_HINT,
  TASK_VOLUME_MAX
} from '@/constants/task'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 从列表里带进来的任务行（NAS 原始字段）；为 null 表示手输 TaskID / TaskSN */
  task: { type: Object, default: null },
  /**
   * 打开时预选的操作（TASK_CONTROL_OPTIONS 的 key）。
   * 列表页的行内快捷按钮用它直达到「调音量 / 暂停恢复」，省得用户再点一次；非法值一律回落成 stop。
   */
  defaultOptionKey: { type: String, default: 'stop' },
  /** 是否正在控制（页面在发请求） */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const taskId = ref('')
const taskSn = ref('')
const optionKey = ref('stop')
const volume = ref(0)

// 打开时用带进来的任务预填标识；没有任务就清空让用户手输
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    taskId.value = String((props.task && props.task.TaskID) || '').trim().toUpperCase()
    taskSn.value = String((props.task && props.task.TaskSN) || '').trim().toUpperCase()
    optionKey.value = TASK_CONTROL_OPTIONS.some((item) => item.key === props.defaultOptionKey)
      ? props.defaultOptionKey
      : 'stop'
    // 音量滑块初值取任务当前音量（运行端的值可能 >127，滑块会被夹回上限）
    const current = Number(props.task && props.task.TaskVolume)
    volume.value = Number.isNaN(current) ? 0 : Math.min(Math.max(current, 0), TASK_VOLUME_MAX)
  }
)

const currentOption = computed(
  () => TASK_CONTROL_OPTIONS.find((item) => item.key === optionKey.value) || TASK_CONTROL_OPTIONS[0]
)

const idKind = computed(() => taskIdKind(taskId.value))

/** 任务概览（只在从列表带进来时展示；手输模式没有可展示的字段） */
const infoItems = computed(() => {
  const task = props.task
  if (!task) return []

  const priority = parseTaskPriority(task.TaskPriority)
  const fileSn = task.CurrentFileSN === undefined || task.CurrentFileSN === null ? '-' : task.CurrentFileSN
  const progress =
    task.PlayProgress === undefined || task.PlayProgress === null ? '-' : `${task.PlayProgress}%`
  const alive = task.AlivePlayerNum === undefined || task.AlivePlayerNum === null ? '-' : task.AlivePlayerNum
  const total = task.TotalPlayerNum === undefined || task.TotalPlayerNum === null ? '-' : task.TotalPlayerNum

  const items = [
    { label: '任务名', value: String(task.TaskName || '（无名）') },
    { label: '类型', value: formatTaskType(task.TaskType) },
    { label: '状态', value: describeTaskState(task.TaskState).text },
    { label: '任务类', value: `${getTaskClassName(task.TaskClass)}（TaskClass=${task.TaskClass}）` },
    {
      label: '优先级',
      value: task.TaskPriority
        ? `${priority ? priority.raw : task.TaskPriority}（类主优先级 ${priority ? priority.classPriority : '?'} / 等级 ${priority ? priority.applyLevel : '?'} / 顺序号 ${priority ? priority.orderSn : '?'}）`
        : '-'
    },
    { label: '任务音量', value: formatTaskVolume(task.TaskVolume) },
    {
      label: '播放模式',
      value: `${formatPlayMode(task.PlayMode)}，循环次数 ${
        task.LoopTimes === undefined || task.LoopTimes === null ? '-' : task.LoopTimes
      }（0 = 不限）`
    },
    {
      label: '当前内容',
      value: `${String(task.FileName || '（无文件名）')} · 文件 ${String(task.CurrentFileID || '-')} / 第 ${fileSn} 条`,
      extra: `播放进度 ${progress}（当前文件的进度，不是整个任务）`
    },
    { label: '参与终端', value: `活动 ${alive} / 计划 ${total}` }
  ]

  if (task.CapturerID) items.push({ label: '采播器', value: String(task.CapturerID) })
  return items
})

const errorText = computed(() => {
  if (!isValidTaskId(taskId.value)) return 'TaskID 必须是 8 位十六进制（例如 00000001）'
  if (!String(taskSn.value).trim()) return '必须填写 TaskSN —— 控制任务要同时给 TaskID 与 TaskSN'
  if (!isValidTaskSn(taskSn.value)) {
    return 'TaskSN 必须是 8 位十六进制，且不能是 00000000（手册：为 0 时命令无效，任务不会被控制）'
  }
  if (currentOption.value.needVolume && !Number.isInteger(Number(volume.value))) {
    return `任务音量必须是 0 ~ ${TASK_VOLUME_MAX} 的整数`
  }
  return ''
})

const canSubmit = computed(() => !errorText.value)

/** 组装请求体：命令字与参数完全由 TASK_CONTROL_OPTIONS 决定，组件里不出现魔法数字 */
function buildPayload() {
  const payload = {
    taskId: String(taskId.value).trim().toUpperCase(),
    taskSn: String(taskSn.value).trim().toUpperCase(),
    taskCmd: Number(currentOption.value.taskCmd)
  }
  if (currentOption.value.needVolume) payload.taskCmdPara = Number(volume.value) || 0
  if (Number(currentOption.value.taskCmd) === 9) {
    payload.taskCmdPara = Number(currentOption.value.taskCmdPara)
  }
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
    title="任务控制"
    width="640px"
    top="8vh"
    :close-on-click-modal="false"
  >
    <el-form label-position="top" class="task-control" @submit.prevent="handleConfirm">
      <!-- 从列表带进来的任务：展示可读信息，免得对着两个 8 位 ID 猜是哪条任务 -->
      <el-descriptions v-if="infoItems.length" :column="2" border size="small" class="task-control__info">
        <el-descriptions-item v-for="item in infoItems" :key="item.label" :label="item.label">
          <span>{{ item.value }}</span>
          <div v-if="item.extra" class="task-control__info-extra">{{ item.extra }}</div>
        </el-descriptions-item>
      </el-descriptions>

      <el-form-item label="TaskID（8 位十六进制）">
        <el-input v-model="taskId" placeholder="例如 00000001" clearable :disabled="submitting" />
      </el-form-item>
      <p
        class="task-control__hint"
        :class="{ 'task-control__hint--warn': idKind.kind === 'other' }"
      >
        {{ idKind.text }}
      </p>

      <el-form-item label="TaskSN（8 位十六进制，不能是 00000000）">
        <el-input v-model="taskSn" placeholder="例如 0000001A" clearable :disabled="submitting" />
      </el-form-item>
      <p class="task-control__hint">{{ TASK_CONTROL_HINT }}</p>

      <el-form-item label="操作">
        <el-radio-group v-model="optionKey" :disabled="submitting">
          <el-radio-button v-for="item in TASK_CONTROL_OPTIONS" :key="item.key" :value="item.key">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </el-form-item>
      <p class="task-control__desc">{{ currentOption.desc }}</p>

      <template v-if="currentOption.needVolume">
        <el-form-item
          :label="`新的任务音量（0 = 最大 / 0dB，${TASK_VOLUME_MAX} = 静音）：${formatTaskVolume(volume)}`"
        >
          <el-slider
            v-model="volume"
            :min="0"
            :max="TASK_VOLUME_MAX"
            :step="1"
            show-input
            :disabled="submitting"
          />
        </el-form-item>
        <p class="task-control__hint">
          这里改的只是这条任务自己的音量，不会动终端的基础音量（终端实际音量 = 基础音量 + 任务音量）。
        </p>
      </template>

      <p class="task-control__warn">⚠️ {{ TASK_STATE_HINT }}</p>
      <p class="task-control__warn">
        ⚠️ 这里只能控制「正在运行的任务」列表里的任务：任务被停止或播完后它的 TaskSN 就查不到了，
        此时再发控制命令会被 NAS 拒绝（Result=8）。
      </p>
    </el-form>

    <template #footer>
      <div class="task-control__footer">
        <span class="task-control__error">{{ errorText }}</span>
        <span class="task-control__footer-actions">
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
            {{ submitting ? '执行中…' : '执行' }}
          </el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.task-control__info {
  margin-bottom: 16px;
}

.task-control__info-extra {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.task-control__hint {
  margin: -12px 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.task-control__hint--warn {
  color: var(--el-color-warning);
}

.task-control__desc {
  margin: -12px 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.task-control__warn {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.task-control__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.task-control__error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
  text-align: left;
}

.task-control__footer-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
