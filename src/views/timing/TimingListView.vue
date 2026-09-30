<script setup>
// src/views/timing/TimingListView.vue —— 定时任务（定时程序 + 程序内定时任务）
//
// 数据来源（后端 docs/API.md「定时任务模块」，NAS 手册 P34-52）：
//   GET  /api/timing/program                 定时程序信息（程序名 / 组合 / 当前执行程序 / 静默时段 / 自动切换）
//   POST /api/timing/program/config          配置定时程序参数（⚠️ 段式覆盖）
//   POST /api/timing/program/set             定时程序操作（CLEAR / COPY / CUT，会覆盖目标程序）
//   GET  /api/timing/tasks/{programIndex}    某个程序内的全部定时任务
//   POST /api/timing/tasks/new|edit|delete   定时任务增 / 改 / 删
//
// 这个模块的「官方口径」都收在 constants/timing.js 的文件头里，页面这一层只需要记住四条：
//   1) **16 套程序、每套最多 248 条任务**；新建任务时任务序号由 NAS 分配（要回显给用户）；
//   2) **定时任务先配置、到时自动执行**：NAS 创建时不校验文件是否存在 / 设备是否在线，
//      只有真正执行时才检索 —— 所以页面必须把「能建成功 ≠ 能放出来」写清楚；
//   3) **`WeekDay` 从左到右是 周日…周六**（反直觉），列表里一律翻译成「周一、三」这种中文；
//   4) **程序配置是段式覆盖**：想改局部必须先读回、改完整体写回（配置弹窗就是这么用的）。
//
// 两层错误的分工与其它模块一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，页面只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import TimingProgramConfigDialog from '@/components/timing/TimingProgramConfigDialog.vue'
import TimingProgramSetDialog from '@/components/timing/TimingProgramSetDialog.vue'
import TimingTaskFormDialog from '@/components/timing/TimingTaskFormDialog.vue'
import {
  AUTO_PROGRAM_HINT,
  TIMING_SYSTEM_MEDIA_HINT,
  TIMING_TASK_HINT,
  TASK_TYPE_CAPTURE,
  TASK_TYPE_VOICE,
  describeAutoProgram,
  describeProgramComb,
  describeTimingDisable,
  describeTimingEnd,
  describeTimingTrigger,
  findTimingProgramAction,
  formatTimingTaskType,
  formatTimingVolume,
  isTimingTaskDisabled,
  isValidTimingTaskIndex,
  programLabel,
  timingTaskToPayload
} from '@/constants/timing'
import { describeTaskFile, describeTaskPlayer, formatPlayMode } from '@/constants/task'
import { useDeviceStore } from '@/stores/device'
import { useGroupStore } from '@/stores/group'
import { useMediaStore } from '@/stores/media'
import { usePlayListStore } from '@/stores/playlist'
import { useTimingStore } from '@/stores/timing'
import { NasResultError } from '@/utils/nas-result'

const timingStore = useTimingStore()
const mediaStore = useMediaStore()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()
const playListStore = usePlayListStore()

const keyword = ref('')
/** 自动刷新间隔（秒）；0 = 不自动刷新。定时排期不是秒级数据，缺省不刷新，避免无谓请求 */
const autoRefreshSeconds = ref(0)
const submitting = ref(false)

const programInfo = computed(() => timingStore.programInfo)
const programSelectOptions = computed(() => timingStore.programSelectOptions)
const programNames = computed(() => timingStore.programNames)
const tasks = computed(() => timingStore.currentTasks)
const loading = computed(() => Boolean(timingStore.loading))
const programLoading = computed(() => Boolean(timingStore.programLoading))

/** 行内「播放内容 / 播放目标」要查名字的数据源，借用其它模块的 store，不重复拉接口 */
const systemFiles = computed(() => mediaStore.lists.system || [])
const playLists = computed(() => playListStore.playlists)
const players = computed(() => deviceStore.lists.player || [])
const capturers = computed(() => deviceStore.lists.capturer || [])
const groups = computed(() => groupStore.groups || [])

/** 关键字过滤：任务名 / 任务序号 / 类型 / 播放内容 ID / 采播器 ID / 播报文本任一命中即可 */
const filteredTasks = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return tasks.value
  return tasks.value.filter((item) =>
    [
      item.TaskName,
      item.TaskIndex,
      formatTimingTaskType(item.TaskType),
      item.CapturerID,
      item.VoiceText,
      Array.isArray(item.FileList) ? item.FileList.join(' ') : ''
    ].some((field) => String(field == null ? '' : field).toLowerCase().includes(text))
  )
})

/** 程序名清单（1~16，用于「程序名」只读展示） */
const programNameRows = computed(() =>
  Array.from({ length: 16 }, (_, index) => {
    const value = index + 1
    return {
      index: value,
      label: programLabel(value, programNames.value),
      name: String(programNames.value[index] == null ? '' : programNames.value[index]).trim()
    }
  })
)

const currentTaskCount = computed(() => timingStore.currentTaskCount)
const disabledTaskCount = computed(() => timingStore.disabledTaskCount)

// ---------------- 行内展示辅助 ----------------

/** 播放内容：文件任务列出前 3 项（注明还有几项），采播显示采播器，文字语音显示文本 */
function contentText(row) {
  const type = Number(row && row.TaskType)
  if (type === TASK_TYPE_CAPTURE) return capturerText(row && row.CapturerID)
  if (type === TASK_TYPE_VOICE) return String((row && row.VoiceText) || '').trim() || '（文本为空）'
  const fileList = Array.isArray(row && row.FileList) ? row.FileList : []
  if (!fileList.length) return '（没有播放内容）'
  const names = fileList.slice(0, 3).map((id) => {
    const info = describeTaskFile(id, { mediaFiles: systemFiles.value, playLists: playLists.value })
    return info.name ? `${info.name}（${info.fileId}）` : String(info.fileId)
  })
  const rest = fileList.length - names.length
  return rest > 0 ? `${names.join('、')} 等 ${fileList.length} 项` : names.join('、')
}

/** 采播器：ID + 名称（查不到就只显示 ID，并标注） */
function capturerText(capturerId) {
  const id = String(capturerId == null ? '' : capturerId).trim().toUpperCase()
  if (!id) return '（未指定采播器）'
  const hit = capturers.value.find(
    (item) => String(item && item.DeviceID).trim().toUpperCase() === id
  )
  return hit ? `${hit.DevName || '未命名'}（${id}）` : `${id}（不在当前采播器列表里）`
}

/** 播放目标：前 3 个 + 总数（分组会显示「含 N 个终端」） */
function playersText(row) {
  const list = Array.isArray(row && row.PlayerList) ? row.PlayerList : []
  if (!list.length) return '（没有播放目标）'
  const names = list.slice(0, 3).map((id) => {
    const info = describeTaskPlayer(id, { devices: players.value, groups: groups.value })
    const label = info.name || info.playerId
    return info.known ? label : `${label}（未知）`
  })
  const rest = list.length - names.length
  return rest > 0 ? `${names.join('、')} 等 ${list.length} 个` : `${names.join('、')}（${list.length} 个）`
}

/** 播放参数：模式 / 循环 / 音量 / 提前开功放（采播没有播放模式与循环次数） */
function paramsText(row) {
  const parts = []
  if (Number(row && row.TaskType) !== TASK_TYPE_CAPTURE) {
    parts.push(formatPlayMode(row && row.PlayMode))
    parts.push(Number(row && row.LoopTimes) === 0 ? '循环不限' : `循环 ${row.LoopTimes} 次`)
  } else {
    parts.push('采播（无播放模式）')
  }
  parts.push(`音量 ${formatTimingVolume(row && row.TaskVolume)}`)
  parts.push(`提前 ${Number(row && row.PreOnAMP) || 0} 秒开功放`)
  return parts.join(' / ')
}

/** 触发方式的中文补充（列表里「按星期循环 / 绝对时刻」的标签文案） */
function startModeText(row) {
  return Number(row && row.StartMode) === 1 ? '绝对时刻' : '按星期循环'
}

// ---------------- 读数据 ----------------

/** 拉「程序信息 + 当前程序的任务」；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await timingStore.loadAll(options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

/** 只拉当前程序的任务列表（切程序 / 写操作后由 store 自己触发） */
async function loadTasks(programIndex = timingStore.currentProgramIndex, options = { silent: true }) {
  try {
    await timingStore.fetchTasks(programIndex, options)
  } catch {
    // 同上
  }
}

/** 手动刷新：程序信息 + 任务列表都过一遍 */
function handleRefresh() {
  load()
}

/** 切换程序：有缓存就直接显示，同时后台再刷一次（别的管理员可能刚改过） */
async function handleProgramChange(value) {
  if (!timingStore.setCurrentProgram(value)) return
  keyword.value = ''
  await loadTasks(timingStore.currentProgramIndex, { silent: true })
}

// 自动刷新：只看「程序信息」与「当前程序的任务」这一份数据，就不做 TaskListView 那种轮询开关的接力了
let refreshTimer = null

watch(autoRefreshSeconds, (seconds) => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (seconds > 0) {
    refreshTimer = setInterval(() => load({ silent: true }), seconds * 1000)
  }
})

onMounted(() => {
  load()
  // 行内与弹窗里要查文件名 / 分组名 / 设备名，缺哪个补哪个（失败不打断本页）
  if (!mediaStore.loadedAt.system) mediaStore.fetchList('system').catch(() => {})
  if (!playLists.value.length) playListStore.fetchPlayLists({ silent: true }).catch(() => {})
  if (!players.value.length) deviceStore.fetchList('player', { silent: true }).catch(() => {})
  if (!capturers.value.length) deviceStore.fetchList('capturer', { silent: true }).catch(() => {})
  if (!groups.value.length) groupStore.fetchGroups({ silent: true }).catch(() => {})
})

onUnmounted(() => {
  // ⚠️ 离开页面必须清掉定时器
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})

// ---------------- 写操作 ----------------

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

/** 复制文本（任务序号经常要在 NAS 侧对照使用） */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${text}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}

// ---------------- 定时任务：新建 / 编辑 / 使能切换 / 删除 ----------------

const taskFormVisible = ref(false)
/** 正在编辑的任务（null = 新建） */
const editingTask = ref(null)

function openCreateDialog() {
  editingTask.value = null
  taskFormVisible.value = true
}

function openEditDialog(row) {
  editingTask.value = row
  taskFormVisible.value = true
}

/**
 * 弹窗提交：带 taskIndex 就是编辑，否则是新建。
 * 新建**不复用 runWrite**：要把 NAS 分配的 TaskIndex 明确告诉用户（后续编辑 / 删除都靠它）。
 */
async function handleTaskFormConfirm(payload) {
  if (payload.taskIndex) {
    const ok = await runWrite(() => timingStore.updateTask(payload), '定时任务已保存')
    if (ok) taskFormVisible.value = false
    return
  }
  submitting.value = true
  try {
    const { programIndex, taskIndex } = await timingStore.createTask(payload)
    ElMessage.success(`已新建定时任务：程序 ${programIndex} / 任务序号 ${taskIndex}`)
    taskFormVisible.value = false
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    submitting.value = false
  }
}

/**
 * 使能 / 禁用：走 edit 接口，用 `timingTaskToPayload` 把这条任务**整体回写**、只改 disable 一个字段。
 * ⚠️ 不能只发 programIndex + taskIndex + disable：NAS 的 edit 是整体设置，少发的字段等于清空。
 * 不弹二次确认：这是可逆操作（再点一次就切回来），而且列表里状态一眼可见。
 */
async function handleToggleDisable(row) {
  const payload = timingTaskToPayload(row, timingStore.currentProgramIndex)
  const next = isTimingTaskDisabled(row) ? 0 : 1
  payload.disable = next
  if (!payload.taskName) payload.taskName = `Task ${payload.taskIndex}`
  const action = next === 1 ? '禁用' : '使能'
  await runWrite(() => timingStore.updateTask(payload), `已${action}「${payload.taskName}」`)
}

/** 删除：必须带 `taskName`（NAS 用它确认目标），所以任务名留空的条目先在 UI 层拦下 */
async function handleDelete(row) {
  const taskIndex = Number(row && row.TaskIndex)
  const taskName = String((row && row.TaskName) == null ? '' : row.TaskName)
  if (!isValidTimingTaskIndex(taskIndex)) {
    ElMessage.warning('这条任务没有可用的任务序号（TaskIndex），无法删除')
    return
  }
  if (!taskName.trim()) {
    ElMessage.warning('这条任务没有任务名：NAS 删除时要用它确认目标，请先「编辑」给它补一个名字')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定删除「${taskName}」吗？（程序 ${timingStore.currentProgramIndex} / 任务序号 ${taskIndex}）` +
        ' NAS 用「程序号 + 任务序号 + 任务名」三者确认目标，任务名必须与列表里完全一致，所以这里不允许改名字。删除后无法找回。',
      '删除定时任务',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await runWrite(
    () => timingStore.removeTask({ programIndex: timingStore.currentProgramIndex, taskIndex, taskName }),
    `已删除「${taskName}」`
  )
}

// ---------------- 定时程序：配置 / 清除复制剪切 ----------------

const configVisible = ref(false)

function openConfigDialog() {
  if (!timingStore.programInfo) {
    ElMessage.warning('还没读到定时程序信息，请先点一次「刷新」再配置（段式覆盖必须先读后写）')
    return
  }
  configVisible.value = true
}

async function handleConfigConfirm(payload) {
  const ok = await runWrite(() => timingStore.configureProgram(payload), '定时程序参数已写入')
  if (ok) configVisible.value = false
}

const setVisible = ref(false)

/** 程序操作弹窗随时可开（不依赖程序信息）；默认选中当前正在看的程序 */
function openSetDialog() {
  setVisible.value = true
}

/** 源程序已加载的任务条数：只有读过的程序才说得准，没读过就给 null（弹窗里会写「任务条数未加载」） */
const setDialogSourceCount = computed(() =>
  timingStore.hasCachedTasks(timingStore.currentProgramIndex) ? timingStore.currentTaskCount : null
)

async function handleSetConfirm(payload) {
  const meta = findTimingProgramAction(payload.action)
  const ok = await runWrite(
    () => timingStore.operateProgram(payload),
    `定时程序操作（${meta ? meta.label : payload.action}）已完成`
  )
  if (ok) setVisible.value = false
}
</script>

<template>
  <div class="timing app-page">
    <!-- 一、定时程序（全局只有一份：程序名 / 组合 / 当前执行程序 / 静默时段 / 自动切换） -->
    <el-card class="timing__card" shadow="never">
      <template #header>
        <div class="timing__header">
          <div class="timing__header-left">
            <span class="timing__title">定时程序</span>
            <span class="timing__count">共 16 套程序，系统按「当前执行程序」或自动切换设置决定跑哪一套</span>
          </div>
          <div class="timing__header-right">
            <el-select v-model="autoRefreshSeconds" class="timing__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="15" label="每 15 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
              <el-option :value="60" label="每 60 秒刷新" />
            </el-select>
            <el-button :loading="programLoading" @click="handleRefresh">刷新</el-button>
            <el-button :disabled="!programInfo" @click="openConfigDialog">配置程序…</el-button>
            <el-button @click="openSetDialog">清除 / 复制 / 剪切…</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="timing__hint"
        type="info"
        :closable="false"
        show-icon
        title="定时任务是「先配置、到时自动执行」"
        :description="TIMING_TASK_HINT"
      />

      <el-descriptions :column="2" border size="small" class="timing__desc">
        <el-descriptions-item label="当前执行程序">
          <el-tag :type="timingStore.currentProgramDesc.tag" effect="plain" size="small">
            {{ timingStore.currentProgramDesc.text }}
          </el-tag>
          <span class="timing__desc-sub">自动切换的时段外执行的就是它</span>
        </el-descriptions-item>

        <el-descriptions-item label="静默时段">
          <el-tag :type="timingStore.silenceTimeDesc.set ? 'warning' : 'info'" effect="plain" size="small">
            {{ timingStore.silenceTimeDesc.text }}
          </el-tag>
          <span class="timing__desc-sub">静默期内不执行任何定时任务</span>
        </el-descriptions-item>

        <el-descriptions-item label="程序名（1~16）" :span="2">
          <div class="timing__names">
            <el-tag
              v-for="item in programNameRows"
              :key="item.index"
              size="small"
              effect="plain"
              :type="item.index === Number(timingStore.currentProgramIndex) ? 'success' : 'info'"
              disable-transitions
            >
              {{ item.name ? item.label : `程序 ${item.index}（未命名）` }}
            </el-tag>
          </div>
          <p class="timing__desc-hint">程序名只用于显示、不作为标识（留空也正常）；上限 39 个<strong>字符</strong>。</p>
        </el-descriptions-item>

        <el-descriptions-item label="程序组合编码（4 条）" :span="2">
          <div v-for="(comb, index) in timingStore.programCombs" :key="index" class="timing__comb">
            <span class="timing__mono">{{ comb }}</span>
            <el-tag size="small" effect="plain" type="info">组合 {{ index + 1 }}</el-tag>
            <span class="timing__desc-sub">{{ describeProgramComb(comb, programNames) }}</span>
          </div>
          <p v-if="!timingStore.programCombs.length" class="timing__desc-hint">（还没读到程序信息）</p>
          <p class="timing__desc-hint">
            把「当前执行程序」设成 21~24，就是让系统执行这 4 条自定义组合。
          </p>
        </el-descriptions-item>

        <el-descriptions-item label="自动切换设置" :span="2">
          <template v-if="timingStore.autoPrograms.length">
            <p
              v-for="item in timingStore.autoPrograms"
              :key="item.AutoProgIdx"
              class="timing__auto-line"
            >
              {{ describeAutoProgram(item, programNames) }}
            </p>
          </template>
          <span v-else class="timing__desc-sub">未设置（系统一直执行「当前执行程序」）</span>
          <p class="timing__desc-hint">{{ AUTO_PROGRAM_HINT }}</p>
        </el-descriptions-item>

        <el-descriptions-item label="最近读取" :span="2">
          <span class="timing__desc-sub">
            {{ timingStore.programLoadedAt ? new Date(timingStore.programLoadedAt).toLocaleString() : '还没读过' }}
          </span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 二、当前程序内的定时任务 -->
    <el-card class="timing__card" shadow="never">
      <template #header>
        <div class="timing__header">
          <div class="timing__header-left">
            <span class="timing__title">定时任务</span>
            <span class="timing__count">
              {{ timingStore.currentProgramLabel }}：共 {{ currentTaskCount }} 条<template v-if="disabledTaskCount">
                （其中 {{ disabledTaskCount }} 条已禁用）</template
              ><span v-if="keyword">，筛选后 {{ filteredTasks.length }} 条</span>
            </span>
          </div>
          <div class="timing__header-right">
            <el-select
              :model-value="timingStore.currentProgramIndex"
              class="timing__program"
              @change="handleProgramChange"
            >
              <el-option
                v-for="item in programSelectOptions"
                :key="item.value"
                :value="item.value"
                :label="item.label"
              />
            </el-select>
            <el-input
              v-model="keyword"
              class="timing__search"
              placeholder="搜索任务名 / 序号 / 文件 ID / 文本"
              clearable
            />
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-button type="primary" @click="openCreateDialog">新建任务</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="timing__hint"
        type="warning"
        :closable="false"
        show-icon
        title="定时任务只用系统媒体文件，且能建成功 ≠ 能放出来"
        :description="`${TIMING_SYSTEM_MEDIA_HINT}另外：新建时 NAS 不校验设备是否在线，到点执行时才发现问题；程序内的任务序号由 NAS 分配（1~248）。`"
      />

      <el-table
        v-loading="loading"
        class="timing__table"
        :data="filteredTasks"
        row-key="TaskIndex"
        stripe
      >
        <el-table-column label="任务序号" width="110">
          <template #default="{ row }">
            <span class="timing__mono">{{ row.TaskIndex }}</span>
            <el-button link type="primary" size="small" @click="copyText(String(row.TaskIndex))">
              复制
            </el-button>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="describeTimingDisable(row.Disable).tag" size="small" effect="plain">
              {{ describeTimingDisable(row.Disable).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="任务名" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.TaskName">{{ row.TaskName }}</span>
            <span v-else class="timing__muted">（任务名为空，删除前必须先补名字）</span>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="130">
          <template #default="{ row }">{{ formatTimingTaskType(row.TaskType) }}</template>
        </el-table-column>

        <el-table-column label="触发时间" min-width="220">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="Number(row.StartMode) === 1 ? 'warning' : 'success'">
              {{ startModeText(row) }}
            </el-tag>
            <span class="timing__trigger">{{ describeTimingTrigger(row) }}</span>
            <div v-if="Number(row.PreOnAMP)" class="timing__sub">
              提前 {{ row.PreOnAMP }} 秒打开功放
            </div>
          </template>
        </el-table-column>

        <el-table-column label="结束方式" width="190">
          <template #default="{ row }">{{ describeTimingEnd(row) }}</template>
        </el-table-column>

        <el-table-column label="播放内容" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ contentText(row) }}</template>
        </el-table-column>

        <el-table-column label="播放目标" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ playersText(row) }}</template>
        </el-table-column>

        <el-table-column label="播放参数" min-width="230" show-overflow-tooltip>
          <template #default="{ row }">{{ paramsText(row) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button link size="small" @click="handleToggleDisable(row)">
              {{ isTimingTaskDisabled(row) ? '使能' : '禁用' }}
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的定时任务' : '这个程序里还没有定时任务'">
            <p v-if="!keyword" class="timing__empty-hint">
              先在上面选一套程序，再点「新建任务」添加排期：文件播放（系统媒体 / 播放列表）、采播、文字语音都支持；
              任务到点由 NAS 自动执行，不需要人工触发。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <TimingTaskFormDialog
      v-model="taskFormVisible"
      :task="editingTask"
      :program-index="Number(timingStore.currentProgramIndex)"
      :programs="programSelectOptions"
      :files="systemFiles"
      :play-lists="playLists"
      :players="players"
      :groups="groups"
      :capturers="capturers"
      :submitting="submitting"
      @confirm="handleTaskFormConfirm"
    />

    <TimingProgramConfigDialog
      v-model="configVisible"
      :info="programInfo"
      :submitting="submitting"
      @confirm="handleConfigConfirm"
    />

    <TimingProgramSetDialog
      v-model="setVisible"
      :programs="programSelectOptions"
      :default-program-index="Number(timingStore.currentProgramIndex)"
      :source-task-count="setDialogSourceCount"
      :submitting="submitting"
      @confirm="handleSetConfirm"
    />
  </div>
</template>

<style scoped>
.timing {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.timing__card {
  border-radius: var(--app-radius);
}

.timing__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.timing__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.timing__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.timing__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.timing__program {
  width: 220px;
}

.timing__search {
  width: 220px;
}

.timing__interval {
  width: 140px;
}

.timing__hint {
  margin-bottom: 12px;
}

.timing__desc {
  margin-top: 4px;
}

.timing__desc-sub {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing__desc-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.timing__names {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
}

.timing__comb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.timing__auto-line {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
}

.timing__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.timing__trigger {
  margin-left: 6px;
}

.timing__sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing__muted {
  color: var(--el-text-color-placeholder);
}

.timing__empty-hint {
  max-width: 460px;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>



