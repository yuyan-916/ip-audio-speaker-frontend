<script setup>
// src/views/tasks/TaskListView.vue —— 任务管理（运行中任务 / 提交临时任务 / 任务控制 / 按设备查询）
//
// 数据来源（后端 docs/API.md「任务管理模块」，NAS 手册 P52-68）：
//   GET  /api/tasks/running                  正在运行的任务列表（含管理软件 / 定时任务 / 其它用户提交的任务）
//   GET  /api/tasks/with-device/{deviceId}   指定设备参与的任务（**查不到时字段全缺**）
//   POST /api/tasks/submit                   提交临时任务（TaskType 只支持 0 文件 / 1 采播 / 7 文字语音）
//   POST /api/tasks/control                  任务控制（本项目开放 停止 / 音量 / 暂停恢复 / 下一曲）
//   POST /api/tasks/stop-all                 停止所有正在运行的任务
//
// 四条必须记住的口径：
//   1) **轮询**：运行中任务默认每 5 秒刷新（TASK_POLL_INTERVAL_MS），**离开页面必须 stopPolling()**；
//      手动刷新时先停轮询、刷完 5 秒后再接上（否则「点刷新」与「定时器到点」撞在一起，表格会连闪两次）；
//   2) **空列表是正常情况**：NAS 可能不返回 Data，页面显示「当前没有正在运行的任务」而不是报错；
//   3) **TaskState 手册自相矛盾**（见 constants/task.js 的 TASK_STATES），列表里原样展示可读文案、不拿它做判断；
//   4) 列表里会出现**别的来源**的任务（TaskID 不是 00000001~00000008）：能看、能尝试控制，但很可能被 NAS 拒绝。
//
// 两层错误的分工与其它模块一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，页面只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import SubmitTaskDialog from '@/components/tasks/SubmitTaskDialog.vue'
import TaskControlDialog from '@/components/tasks/TaskControlDialog.vue'
import { DEVICE_CLASSES, getDeviceState, isValidDeviceId } from '@/constants/device'
import {
  TASK_POLL_INTERVAL_MS,
  TASK_STATE_HINT,
  describeTaskFile,
  describeTaskPlayer,
  describeTaskState,
  formatPlayMode,
  formatTaskType,
  formatTaskVolume,
  getTaskClassName,
  hasTaskWithDevice,
  parseTaskPriority,
  taskIdKind
} from '@/constants/task'
import { useDeviceStore } from '@/stores/device'
import { useGroupStore } from '@/stores/group'
import { useMediaStore } from '@/stores/media'
import { usePlayListStore } from '@/stores/playlist'
import { useTaskStore } from '@/stores/task'
import { NasResultError } from '@/utils/nas-result'

const taskStore = useTaskStore()
const mediaStore = useMediaStore()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()
const playListStore = usePlayListStore()

const keyword = ref('')
/** 自动刷新间隔（秒）；0 = 不自动刷新。默认就是接口约定的 5 秒轮询 */
const autoRefreshSeconds = ref(TASK_POLL_INTERVAL_MS / 1000)

const tasks = computed(() => taskStore.runningTasks)
const loading = computed(() => Boolean(taskStore.loading))

/** 行内「内容 / 终端」两列要查名字的数据源，都直接借用其它模块的 store，不重复拉接口 */
const systemFiles = computed(() => mediaStore.lists.system || [])
const playLists = computed(() => playListStore.playlists)
const players = computed(() => deviceStore.lists.player || [])
const capturers = computed(() => deviceStore.lists.capturer || [])
const groups = computed(() => groupStore.groups || [])

/** 关键字过滤：任务 ID / SN / 名称 / 当前文件名 / 采播器 ID 任一命中即可 */
const filteredTasks = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return tasks.value
  return tasks.value.filter((item) =>
    [item.TaskID, item.TaskSN, item.TaskName, item.FileName, item.CurrentFileID, item.CapturerID].some(
      (field) => String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})

/** 拉取运行中任务列表；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await taskStore.fetchRunning(options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

// ---------------- 轮询与手动刷新 ----------------
/** 手动刷新后「恢复轮询」的定时器（放在组件里而不是 store：它是页面交互的节奏） */
let resumeTimer = null

watch(autoRefreshSeconds, (seconds) => {
  if (resumeTimer) {
    clearTimeout(resumeTimer)
    resumeTimer = null
  }
  if (seconds > 0) taskStore.startPolling(seconds * 1000)
  else taskStore.stopPolling()
})

/** 手动刷新：先停轮询 → 拉一次 → 5 秒后恢复（开关还开着才恢复） */
async function handleRefresh() {
  taskStore.stopPolling()
  await load()
  if (resumeTimer) clearTimeout(resumeTimer)
  if (autoRefreshSeconds.value > 0) {
    resumeTimer = setTimeout(() => {
      resumeTimer = null
      if (autoRefreshSeconds.value > 0) taskStore.startPolling(autoRefreshSeconds.value * 1000)
    }, 5000)
  }
}

onMounted(() => {
  load()
  if (autoRefreshSeconds.value > 0) taskStore.startPolling(autoRefreshSeconds.value * 1000)
  // 行里的文件名 / 分组名要查得到，缺哪个补哪个（失败不打断本页）
  if (!mediaStore.loadedAt.system) mediaStore.fetchList('system').catch(() => {})
  if (!playLists.value.length) playListStore.fetchPlayLists({ silent: true }).catch(() => {})
  if (!players.value.length) deviceStore.fetchList('player', { silent: true }).catch(() => {})
  if (!capturers.value.length) deviceStore.fetchList('capturer', { silent: true }).catch(() => {})
  if (!groups.value.length) groupStore.fetchGroups({ silent: true }).catch(() => {})
})

onUnmounted(() => {
  // ⚠️ 离开页面必须停轮询，否则定时器会一直挂在后台空转
  taskStore.stopPolling()
  if (resumeTimer) clearTimeout(resumeTimer)
})

// ---------------- 写操作（提交 / 控制 / 停止全部） ----------------
const submitting = ref(false)

/**
 * 统一收口写操作的 loading 与错误提示。
 * @param {() => Promise<any>} submit 真正发请求的动作
 * @param {string} successText 成功提示
 * @returns {Promise<boolean>} 是否成功（页面据此决定关不关弹窗）
 */
async function runWrite(submit, successText) {
  submitting.value = true
  try {
    await submit()
    ElMessage.success(successText)
    return true
  } catch (error) {
    // HTTP 层的错误拦截器已提示；这里只管 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
    return false
  } finally {
    submitting.value = false
  }
}

// —— 提交临时任务 ——
const submitVisible = ref(false)
/** 最近一次提交成功的结果 { taskId, taskSn }；留在弹窗里是因为这两个值要**成对**复制 */
const submitResult = ref(null)

function openSubmitDialog() {
  submitResult.value = null
  submitVisible.value = true
}

/**
 * 提交任务**不复用 runWrite**：这里要拿到 TaskID / TaskSN 存进 submitResult，
 * 成功提示也要带上这两个值（控制任务时必须成对给出，用户马上就会用）。
 */
async function handleSubmitConfirm(payload) {
  submitting.value = true
  submitResult.value = null
  try {
    const { taskId, taskSn } = await taskStore.submit(payload)
    submitResult.value = { taskId, taskSn }
    ElMessage.success(
      `任务已提交：TaskID ${taskId || '（NAS 未返回）'} / TaskSN ${taskSn || '（NAS 未返回）'}`
    )
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    submitting.value = false
  }
}

// —— 任务控制 ——
const controlVisible = ref(false)
const controlTarget = ref(null)
/** 预选操作：行内的「调音量 / 暂停恢复」按钮直达到对应选项 */
const controlOptionKey = ref('stop')

function openControlDialog(row, optionKey = 'stop') {
  controlTarget.value = row || null
  controlOptionKey.value = optionKey
  controlVisible.value = true
}

async function handleControlConfirm(payload) {
  const ok = await runWrite(
    () => taskStore.control(payload),
    `已发送控制命令（TaskID ${payload.taskId} / TaskSN ${payload.taskSn}）`
  )
  // 成功才关弹窗：失败了用户还要照着里面的 TaskID / TaskSN 改
  if (ok) controlVisible.value = false
}

/** 行内「停止」：确认后等价于控制命令字 1（停止指定任务） */
async function handleStopTask(row) {
  const label = row.TaskName || '（无名任务）'
  try {
    await ElMessageBox.confirm(
      `确定要停止任务「${label}」（TaskID ${row.TaskID} / TaskSN ${row.TaskSN}）吗？` +
        '任务被停掉之后这两个值就失效了，需要重新提交才能再控制。',
      '停止任务',
      { confirmButtonText: '停止', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }
  await runWrite(
    () => taskStore.control({ taskId: row.TaskID, taskSn: row.TaskSN, taskCmd: 1 }),
    `已停止任务 ${row.TaskID}`
  )
}

/** 停止全部：会停掉系统上「所有」任务（别人的也在内），必须二次确认 */
async function handleStopAll() {
  try {
    await ElMessageBox.confirm(
      `确定要停止系统上「所有」正在运行的任务吗（当前 ${tasks.value.length} 条）？` +
        '这会连带停掉管理软件、定时任务以及其它用户提交的任务，而且没法只恢复其中一条，要重新提交。',
      '停止全部任务',
      { confirmButtonText: '全部停止', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  await runWrite(() => taskStore.stopAll(), '已停止所有正在运行的任务')
}

// ---------------- 按设备查询任务 ----------------
const queryDeviceId = ref('')
const queryLoading = ref(false)
/** GET /api/tasks/with-device 的响应；null 表示还没查过（查不到任务时字段全缺 → hasTaskWithDevice） */
const queryResult = ref(null)

/** 查询候选：四类设备一次列全并带类别前缀，省得用户先选类别再选设备 */
const deviceOptions = computed(() =>
  DEVICE_CLASSES.flatMap((item) =>
    (deviceStore.lists[item.key] || []).map((device) => ({
      value: String(device.DeviceID || '').trim().toUpperCase(),
      label: `${item.label}｜${device.DevName || '（无名）'}｜${device.DeviceID}`,
      state: getDeviceState(device.State)
    }))
  ).filter((item) => isValidDeviceId(item.value))
)

async function handleDeviceQuery() {
  const deviceId = String(queryDeviceId.value || '').trim().toUpperCase()
  if (!isValidDeviceId(deviceId)) {
    ElMessage.warning('设备 ID 必须是 8 位十六进制（例如 30313233）')
    return
  }
  queryDeviceId.value = deviceId
  queryLoading.value = true
  queryResult.value = null
  try {
    queryResult.value = await taskStore.fetchWithDevice(deviceId)
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    queryLoading.value = false
  }
}

function handleDeviceQueryClear() {
  queryDeviceId.value = ''
  queryResult.value = null
}

/** 查询结果的 TaskID / TaskSN 也能直接开控制弹窗（它的字段比列表行少，弹窗已按缺省处理） */
function openControlFromQuery() {
  const result = queryResult.value
  if (!hasTaskWithDevice(result)) return
  openControlDialog(
    {
      TaskID: result.TaskID,
      TaskSN: result.TaskSN,
      TaskName: result.TaskName,
      TaskType: result.TaskType,
      TaskState: result.TaskState
    },
    'stop'
  )
}

// ---------------- 行内展示辅助 ----------------
/** TaskID 来源提示：只有 00000001~00000008 才是 HTTP API 提交的临时任务 */
function idHintOf(row) {
  return taskIdKind(row.TaskID)
}

/** 任务类 + 优先级（TaskPriority = 类主优先级 << 12 | 等级 << 8 | 顺序号，见 constants/task.js） */
function priorityText(taskPriority) {
  const parsed = parseTaskPriority(taskPriority)
  if (!parsed) return '-'
  return `${parsed.raw}（类主 ${parsed.classPriority} / 等级 ${parsed.applyLevel} / 顺序号 ${parsed.orderSn}）`
}

/** 当前播放内容：FFxx → 播放列表名，普通 4 位 → 系统媒体文件名 */
function currentFileText(row) {
  const file = describeTaskFile(row.CurrentFileID, {
    mediaFiles: systemFiles.value,
    playLists: playLists.value
  })
  if (file.kind === 'invalid') return '（NAS 未给出当前内容）'
  return file.name ? `${file.name}（${file.fileId}）` : file.fileId
}

/** 当前内容的类型说明：播放列表引用 / 系统媒体文件（NAS 对形如 FFxx 的系统媒体有歧义，这里显式标出来） */
function currentFileKindText(row) {
  const file = describeTaskFile(row.CurrentFileID, {
    mediaFiles: systemFiles.value,
    playLists: playLists.value
  })
  if (file.kind === 'playlist') return file.known ? '播放列表' : '播放列表引用（已查不到该列表）'
  if (file.kind === 'file') return file.known ? '系统媒体文件' : '文件（已查不到该文件）'
  return ''
}

/** 参与终端：活动数 / 计划数 + 前两个终端（或分组）的可读名 */
function playerBrief(row) {
  const ids = Array.isArray(row.PlayerList) ? row.PlayerList : []
  return ids.slice(0, 2).map((id) => {
    const player = describeTaskPlayer(id, { devices: players.value, groups: groups.value })
    if (player.kind === 'invalid') return String(id)
    if (!player.name) return `${player.playerId}（未知）`
    return `${player.name}（${player.playerId}）`
  })
}

function playerListCount(row) {
  return Array.isArray(row.PlayerList) ? row.PlayerList.length : 0
}

function aliveText(row) {
  const alive = row.AlivePlayerNum == null ? '-' : row.AlivePlayerNum
  const total = row.TotalPlayerNum == null ? '-' : row.TotalPlayerNum
  return `${alive} / ${total}`
}

/** 复制文本（TaskID / TaskSN 成对使用，经常要粘到别处） */
async function copyText(text) {
  const value = String(text || '')
  if (!value) {
    ElMessage.warning('没有可复制的内容')
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(`已复制 ${value}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}

function copyTaskRef(row) {
  return copyText(`${row.TaskID} / ${row.TaskSN}`)
}
</script>

<template>
  <div class="tasks">
    <!-- 上半：正在运行的任务（默认每 5 秒轮询） -->
    <el-card class="tasks__card" shadow="never">
      <template #header>
        <div class="tasks__header">
          <div class="tasks__header-left">
            <span class="tasks__title">正在运行的任务</span>
            <span class="tasks__count">
              共 {{ filteredTasks.length }} 条<span v-if="keyword">（全部 {{ tasks.length }} 条）</span>
            </span>
            <el-tag v-if="taskStore.polling" type="success" size="small" effect="plain">轮询中</el-tag>
          </div>

          <div class="tasks__header-right">
            <el-input
              v-model="keyword"
              class="tasks__search"
              placeholder="搜索 TaskID / TaskSN / 任务名 / 文件名"
              clearable
            />
            <el-select v-model="autoRefreshSeconds" class="tasks__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="5" label="每 5 秒刷新" />
              <el-option :value="10" label="每 10 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
            </el-select>
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-button type="danger" plain :disabled="!tasks.length" @click="handleStopAll">
              停止全部
            </el-button>
            <el-button type="primary" @click="openSubmitDialog">提交任务</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="tasks__hint"
        type="info"
        :closable="false"
        show-icon
        title="这个列表是 NAS 上「全系统」正在跑的任务：管理软件 / 定时任务 / 其它用户提交的都在里面"
        :description="TASK_STATE_HINT"
      />

      <el-table v-loading="loading" class="tasks__table" :data="filteredTasks" stripe>
        <el-table-column label="任务" min-width="230">
          <template #default="{ row }">
            <div class="tasks__main">
              <span class="tasks__name">{{ row.TaskName || '（无名任务）' }}</span>
              <el-button link type="primary" size="small" @click="copyTaskRef(row)">复制凭据</el-button>
            </div>
            <div class="tasks__sub">
              <span class="tasks__mono">TaskID {{ row.TaskID || '-' }}</span>
              <span class="tasks__mono">TaskSN {{ row.TaskSN || '-' }}</span>
            </div>
            <div class="tasks__sub" :class="{ 'tasks__sub--warn': idHintOf(row).kind === 'other' }">
              {{ idHintOf(row).text }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="类型 / 任务类" min-width="150">
          <template #default="{ row }">
            <div>{{ formatTaskType(row.TaskType) }}</div>
            <div class="tasks__sub">
              第 {{ row.TaskClass }} 类 · {{ getTaskClassName(row.TaskClass) }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" min-width="170">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="describeTaskState(row.TaskState).tag">
              {{ describeTaskState(row.TaskState).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="播放参数" min-width="210">
          <template #default="{ row }">
            <div>{{ formatPlayMode(row.PlayMode) }} · 循环 {{
              row.LoopTimes === undefined || row.LoopTimes === null ? '-' : row.LoopTimes
            }}（0 = 不限）</div>
            <div class="tasks__sub">任务音量 {{ formatTaskVolume(row.TaskVolume) }}</div>
            <div class="tasks__sub">优先级 {{ priorityText(row.TaskPriority) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="当前内容" min-width="230">
          <template #default="{ row }">
            <div>{{ currentFileText(row) }}</div>
            <div class="tasks__sub">
              第 {{ row.CurrentFileSN == null ? '-' : row.CurrentFileSN }} 条 · {{ currentFileKindText(row) }}
            </div>
            <el-progress
              class="tasks__progress"
              :percentage="Number(row.PlayProgress) || 0"
              :stroke-width="6"
              :show-text="false"
            />
            <div class="tasks__sub">
              播放进度 {{ row.PlayProgress == null ? '-' : `${row.PlayProgress}%` }}（当前文件，不是整个任务）
            </div>
          </template>
        </el-table-column>

        <el-table-column label="参与终端" min-width="220">
          <template #default="{ row }">
            <div>活动 {{ aliveText(row) }} 台</div>
            <div v-for="(text, index) in playerBrief(row)" :key="index" class="tasks__sub">{{ text }}</div>
            <div v-if="playerListCount(row) > 2" class="tasks__sub">
              共 {{ playerListCount(row) }} 个播放目标（终端或分组）
            </div>
            <div v-if="row.CapturerID" class="tasks__sub">采播器 {{ row.CapturerID }}</div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openControlDialog(row, 'stop')">
              控制
            </el-button>
            <el-button link type="primary" size="small" @click="openControlDialog(row, 'volume')">
              调音量
            </el-button>
            <el-button link type="primary" size="small" @click="openControlDialog(row, 'pause')">
              暂停/恢复
            </el-button>
            <el-button link type="danger" size="small" @click="handleStopTask(row)">停止</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的任务' : '当前没有正在运行的任务'">
            <p v-if="!keyword" class="tasks__empty-hint">
              任务在 NAS 上是一次性动作：提交后才会出现在这里，播完 / 被停掉就消失，所以「空列表」很常见。
              要放一段音频请用右上角的「提交任务」；只想看某台设备在跑什么，用下面的「按设备查任务」。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <!-- 下半：按设备查任务（GET /api/tasks/with-device/{deviceId}）—— 终端与采播器都能查 -->
    <el-card class="tasks__card" shadow="never">
      <template #header>
        <div class="tasks__header">
          <div class="tasks__header-left">
            <span class="tasks__title">按设备查任务</span>
            <span class="tasks__count">看看某台设备现在在跑哪条任务</span>
          </div>
        </div>
      </template>

      <div class="tasks__query">
        <el-select
          v-model="queryDeviceId"
          class="tasks__query-select"
          placeholder="选一台设备，或直接输入 / 粘贴 8 位十六进制设备 ID"
          filterable
          clearable
          allow-create
          default-first-option
          :disabled="queryLoading"
        >
          <el-option
            v-for="item in deviceOptions"
            :key="item.value"
            :value="item.value"
            :label="item.label"
          >
            <span>{{ item.label }}</span>
            <el-tag class="tasks__option-tag" size="small" effect="plain" :type="item.state.tag">
              {{ item.state.text }}
            </el-tag>
          </el-option>
        </el-select>
        <el-button type="primary" :loading="queryLoading" @click="handleDeviceQuery">查询</el-button>
        <el-button @click="handleDeviceQueryClear">清空</el-button>
      </div>

      <el-descriptions
        v-if="hasTaskWithDevice(queryResult)"
        class="tasks__query-result"
        :column="2"
        border
        size="small"
      >
        <el-descriptions-item label="任务名">
          {{ queryResult.TaskName || '（无名任务）' }}
        </el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ formatTaskType(queryResult.TaskType) }}
        </el-descriptions-item>
        <el-descriptions-item label="TaskID">{{ queryResult.TaskID || '-' }}</el-descriptions-item>
        <el-descriptions-item label="TaskSN">{{ queryResult.TaskSN || '-' }}</el-descriptions-item>
        <el-descriptions-item label="任务类">
          {{ getTaskClassName(queryResult.TaskClass) }}（TaskClass={{ queryResult.TaskClass }}）
        </el-descriptions-item>
        <el-descriptions-item label="播放模式">
          {{ formatPlayMode(queryResult.PlayMode) }}
        </el-descriptions-item>
        <el-descriptions-item label="当前内容">{{ currentFileText(queryResult) }}</el-descriptions-item>
        <el-descriptions-item label="播放进度">
          {{ queryResult.PlayProgress == null ? '-' : `${queryResult.PlayProgress}%` }}
        </el-descriptions-item>
        <el-descriptions-item v-if="queryResult.CapturerID" label="采播器">
          {{ queryResult.CapturerID }}
        </el-descriptions-item>
        <el-descriptions-item v-if="queryResult.PlayerID" label="播放终端">
          {{ queryResult.PlayerID }}
        </el-descriptions-item>
        <el-descriptions-item label="操作" :span="2">
          <el-button link type="primary" size="small" @click="copyTaskRef(queryResult)">
            复制凭据
          </el-button>
          <el-button link type="primary" size="small" @click="openControlFromQuery">
            控制这条任务
          </el-button>
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-else-if="queryResult"
        type="warning"
        :closable="false"
        show-icon
        title="这台设备当前没有参与任何任务"
        description="手册 P58-60：查不到相关任务时响应里除 DataType / Result 外字段全部缺席 —— 这里命中的就是这种情况（不是查询失败，也不是权限问题）。"
      />

      <el-alert
        v-else
        type="info"
        :closable="false"
        show-icon
        title="选一台设备再点「查询」"
        description="返回这台设备当前参与的那条任务（设备可能是播放终端，也可能是采播器）；只回一条，不列历史。"
      />
    </el-card>

    <SubmitTaskDialog
      v-model="submitVisible"
      :files="systemFiles"
      :play-lists="playLists"
      :players="players"
      :capturers="capturers"
      :groups="groups"
      :submitting="submitting"
      :result="submitResult"
      @confirm="handleSubmitConfirm"
    />

    <TaskControlDialog
      v-model="controlVisible"
      :task="controlTarget"
      :default-option-key="controlOptionKey"
      :submitting="submitting"
      @confirm="handleControlConfirm"
    />
  </div>
</template>

<style scoped>
.tasks {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tasks__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.tasks__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.tasks__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tasks__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.tasks__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tasks__search {
  width: 260px;
}

.tasks__interval {
  width: 130px;
}

.tasks__hint {
  margin-bottom: 12px;
}

.tasks__main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.tasks__name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.tasks__mono {
  margin-right: 8px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
}

.tasks__sub {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.tasks__sub--warn {
  color: var(--el-color-warning);
}

.tasks__progress {
  margin: 6px 0 2px;
}

.tasks__empty-hint {
  margin: 0;
  max-width: 520px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.tasks__query {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.tasks__query-select {
  width: 360px;
}

.tasks__option-tag {
  margin-left: 8px;
}

.tasks__query-result {
  margin-top: 4px;
}
</style>


