<script setup>
// src/views/deviceTasks/DeviceTaskListView.vue —— 设备任务
//
// 数据来源（后端 docs/API.md「设备任务模块」，NAS 手册 P68-80）：
//   GET  /api/device-tasks/catalog      已配置设备任务的设备目录
//   POST /api/device-tasks/catalog      设备加入 / 移出目录（⚠️ 移出会同步删除该设备的全部任务）
//   GET  /api/device-tasks/{deviceId}   某台设备的全部设备任务（Result=1 = 这台设备还没配过）
//   POST /api/device-tasks              启用 / 修改 / 禁用一条设备任务
//
// ⚠️ 这一页要先把「设备任务是什么」讲清楚，否则很容易被当成定时任务：
//   设备任务**绑定在具体设备上**，设备的按键 / 端口 / 触控按钮被触发后**即时执行**，没有开始时间；
//   配置前必须先把设备加入「设备任务目录」，一个设备最多 128 条。
//
// ⚠️ 两处「接口没提供的能力」，页面上必须如实说明（不是 bug，是手册的确没给）：
//   1) `DeviceTaskList` 的字段表里**没有 `Disable`** → 列表看不出某条任务是启用还是禁用；
//   2) 没有「删除单条设备任务」的接口 → 停止一条任务只能**禁用**它（Disable=1，内容仍留在 NAS 上），
//      要彻底清掉只能把设备移出目录（那会删掉该设备的**全部**任务）。
//
// 两层错误的分工与其它页面一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，捕获 NasResultError 后提示。

import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DeviceTaskFormDialog from '@/components/deviceTasks/DeviceTaskFormDialog.vue'
import { getDeviceState, isValidDeviceId } from '@/constants/device'
import { TASK_TYPE_CAPTURE, TASK_TYPE_FILE, TASK_TYPE_VOICE } from '@/constants/task'
import {
  DEVICE_TASK_MAX,
  HINT_ALARM_FILE,
  HINT_BOUND_DEVICE,
  HINT_CATALOG_FIRST,
  HINT_DISABLE_ONLY,
  HINT_MAX_TASKS,
  HINT_NO_CODE_TABLE,
  HINT_NO_TASKS_YET,
  HINT_REMOVE_DELETES_ALL,
  HINT_TRIGGER_NO_CHECK,
  buildDeviceTaskDeviceIndex,
  buildTalkPlayerOptions,
  buildTaskCapturerOptions,
  buildTaskDeviceCandidates,
  buildTaskFileOptions,
  buildTaskPlayerOptions,
  describeTaskFileId,
  describeTaskPlayerId,
  deviceTaskToPayload,
  needsAlarmFile,
  normalizeDeviceTaskId,
  recommendTaskIndex,
  toDeviceTaskRow
} from '@/constants/deviceTask'
import { useDeviceTaskStore } from '@/stores/deviceTask'
import { useDeviceStore } from '@/stores/device'
import { useMediaStore } from '@/stores/media'
import { NasResultError } from '@/utils/nas-result'

const deviceTaskStore = useDeviceTaskStore()
const deviceStore = useDeviceStore()
const mediaStore = useMediaStore()

/** 设备列表的四个 key（候选设备、播放目标、采播器都从这四类里取） */
const DEVICE_LIST_KEYS = ['player', 'capturer', 'actCapturer', 'actRequester']

const keyword = ref('')
/** 当前正在看任务的设备 ID（空串 = 还没选设备，第二张卡片不显示） */
const selectedDeviceId = ref('')

const loading = computed(() => Boolean(deviceTaskStore.loading))
const taskLoading = computed(() => Boolean(deviceTaskStore.taskLoading))
const lastLoadedText = computed(() =>
  deviceTaskStore.lastLoadedAt ? new Date(deviceTaskStore.lastLoadedAt).toLocaleString() : '还没读过'
)

/** 设备 ID → 设备对象：目录里只有 ID / 类型，名称与在线状态要靠设备列表补 */
const deviceIndex = computed(() => buildDeviceTaskDeviceIndex(deviceStore.lists))

// ---------------- 目录表 ----------------

/** 目录行 +（查得到时的）设备名称 / 在线状态 */
const rows = computed(() =>
  deviceTaskStore.catalogRows.map((row) => {
    const device = deviceIndex.value[row.deviceId]
    const state = device ? getDeviceState(device.State) : null
    return {
      ...row,
      deviceName: device ? device.DevName || '' : '',
      stateText: state ? state.text : '',
      stateTag: state ? state.tag : 'info'
    }
  })
)

/** 关键字过滤：设备 ID / 名称 / 类型文案任一命中即可 */
const filteredRows = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return rows.value
  return rows.value.filter((row) =>
    [row.deviceId, row.deviceName, row.typeText, row.deviceType].some((field) =>
      String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})

/** 「加入目录」的候选设备（类型在手册 P79 的类型表里） */
const candidateOptions = computed(() => buildTaskDeviceCandidates(deviceStore.lists))

// ---------------- 某台设备的任务 ----------------

/** 当前选中设备的目录行（拿类型与名称；设备可能已不在目录里 → 从设备列表补） */
const selectedRow = computed(() => {
  const id = selectedDeviceId.value
  if (!id) return null
  const fromCatalog = rows.value.find((row) => row.deviceId === id)
  const device = deviceIndex.value[id]
  const state = device ? getDeviceState(device.State) : null
  return {
    deviceId: id,
    deviceType: fromCatalog ? fromCatalog.deviceType : '',
    typeText: fromCatalog ? fromCatalog.typeText : '',
    supportText: fromCatalog ? fromCatalog.supportText : '',
    deviceName: fromCatalog ? fromCatalog.deviceName : device ? device.DevName || '' : '',
    stateText: state ? state.text : '',
    stateTag: state ? state.tag : 'info'
  }
})

const selectedDeviceType = computed(() => (selectedRow.value ? selectedRow.value.deviceType : ''))
/** 该设备的任务是否处于「NAS 说还没配过」（Result=1）的状态 */
const notConfigured = computed(() => {
  const cache = deviceTaskStore.cachedTasks(selectedDeviceId.value)
  return Boolean(cache && cache.notConfigured)
})

/** 该设备的任务行（页面统一形态：类型文案、索引叫法、结束时间描述等） */
const taskRows = computed(() => {
  const cache = deviceTaskStore.cachedTasks(selectedDeviceId.value)
  const list = cache && Array.isArray(cache.rows) ? cache.rows : []
  return list
    .map((row) => toDeviceTaskRow(row, { deviceType: selectedDeviceType.value }))
    .sort((a, b) => a.taskIndex - b.taskIndex)
})

/** 新建任务时推荐的空序号（0 = 128 条已满） */
const nextTaskIndex = computed(() => recommendTaskIndex(taskRows.value))

// ---------------- 弹窗用的媒体 / 设备候选项 ----------------

/** 文件来源：4C / 3E 用**报警媒体**，其余用**系统媒体**（手册 P79 的 AlarmFile 限定） */
const fileSourceKey = computed(() => (needsAlarmFile(selectedDeviceType.value) ? 'alarm' : 'system'))
const fileSourceLabel = computed(() => (fileSourceKey.value === 'alarm' ? '报警媒体' : '系统媒体'))
/** 文件任务候选来自哪一份列表（① 用于选择器，② 用于把已选 ID 翻成文件名） */
const sourceFiles = computed(() => mediaStore.lists[fileSourceKey.value] || [])
const fileOptions = computed(() => buildTaskFileOptions(sourceFiles.value))
const capturerOptions = computed(() =>
  buildTaskCapturerOptions(deviceStore.lists, {
    deviceId: selectedDeviceId.value,
    deviceName: selectedRow.value ? selectedRow.value.deviceName : ''
  })
)
const playerOptions = computed(() => buildTaskPlayerOptions(deviceStore.lists))
const talkPlayerOptions = computed(() => buildTalkPlayerOptions(deviceStore.lists))

// ---------------- 列表里的展示辅助 ----------------

/** 播放内容：文件 → 文件名；文字语音 → 文本；采播 → 采播器；对讲 → 类型名 */
function contentText(row) {
  if (row.taskType === TASK_TYPE_FILE) {
    if (!row.fileList.length) return '（没有播放内容）'
    return row.fileList.map((id) => describeTaskFileId(id, sourceFiles.value)).join('；')
  }
  if (row.taskType === TASK_TYPE_VOICE) return row.voiceText || '（文本为空）'
  if (row.taskType === TASK_TYPE_CAPTURE) {
    return row.capturerId
      ? `采播：${describeTaskPlayerId(row.capturerId, deviceIndex.value)}`
      : `采播：设备自身（${selectedDeviceId.value}，NAS 默认）`
  }
  return row.typeText
}

/** 对讲任务的补充说明：主叫方永远是设备自身（手册 P79 的 ActPhone 限定） */
function tableTalkHint(row) {
  return row.isTalk ? `主叫方：设备自身（${selectedDeviceId.value}）` : ''
}

/** 播放目标：对讲任务只显示第一个（被叫方），其余全部列出 */
function playerText(row) {
  if (row.isTalk) {
    return row.callee ? `被叫方：${describeTaskPlayerId(row.callee, deviceIndex.value)}` : '（没有指定被叫方）'
  }
  if (!row.playerList.length) return '（没有播放目标）'
  return row.playerList.map((id) => describeTaskPlayerId(id, deviceIndex.value)).join('；')
}

// ---------------- 读取 ----------------

async function load({ silent = false } = {}) {
  try {
    await deviceTaskStore.fetchCatalog({ silent })
  } catch (error) {
    // HTTP 层错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

/** 读某台设备的任务清单（成功后进 store 的缓存） */
async function loadTasks(deviceId) {
  const id = normalizeDeviceTaskId(deviceId)
  if (!isValidDeviceId(id)) return
  try {
    await deviceTaskStore.fetchTasks(id)
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

/** 没拉过的设备 / 媒体列表补一次（失败不打断本页，只是候选项少一些） */
function ensureSources() {
  DEVICE_LIST_KEYS.forEach((key) => {
    if (!deviceStore.loadedAt[key]) deviceStore.fetchList(key).catch(() => {})
  })
  ;['system', 'alarm'].forEach((key) => {
    if (!mediaStore.loadedAt[key]) mediaStore.fetchList(key).catch(() => {})
  })
}

/** 强制重拉设备 / 媒体列表（「刷新」时用：静默、失败不提示） */
function refreshSources() {
  DEVICE_LIST_KEYS.forEach((key) => deviceStore.fetchList(key, { silent: true }).catch(() => {}))
  ;['system', 'alarm'].forEach((key) => mediaStore.fetchList(key, { silent: true }).catch(() => {}))
}

onMounted(() => {
  load()
  ensureSources()
})

async function handleRefresh() {
  await load()
  refreshSources()
  if (selectedDeviceId.value) await loadTasks(selectedDeviceId.value)
}

/** 选中某台设备看它的任务：切换后回源读一次（缓存先铺一屏，避免白屏） */
function handleSelectDevice(deviceId) {
  const id = normalizeDeviceTaskId(deviceId)
  if (!isValidDeviceId(id)) {
    ElMessage.warning('设备 ID 必须是 8 位十六进制（例如 00001AB2）')
    return
  }
  selectedDeviceId.value = id
  loadTasks(id)
}


// ---------------- 加入 / 移出设备任务目录 ----------------

/** 「加入目录」下拉的当前值（选完立刻清空，避免误以为已经选定了） */
const candidateId = ref('')

async function handleAddDevice(value) {
  candidateId.value = ''
  const id = normalizeDeviceTaskId(value)
  if (!id) return
  if (!isValidDeviceId(id)) {
    ElMessage.warning(`「${id}」不是合法的设备 ID：请输入 8 位十六进制（例如 00001AB2）`)
    return
  }
  try {
    await deviceTaskStore.addDevice(id)
    ElMessage.success(`已把 ${id} 加入设备任务目录`)
    handleSelectDevice(id)
  } catch (error) {
    // HTTP 层错误拦截器已提示；NAS 业务拒绝在这里补一次（如 Result=3 该设备不需要配置设备任务）
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

/** 移出目录：⚠️ NAS 会同步删除该设备的全部任务，必须二次确认 */
async function handleRemoveDevice(row) {
  try {
    await ElMessageBox.confirm(
      `确定把 ${row.deviceId} 移出设备任务目录吗？${HINT_REMOVE_DELETES_ALL}，且不可恢复。`,
      '移出目录会删除该设备的全部设备任务',
      { confirmButtonText: '移出并删除全部任务', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }
  try {
    await deviceTaskStore.removeDevice(row.deviceId)
    ElMessage.success(`已把 ${row.deviceId} 移出设备任务目录（它的设备任务已被删除）`)
    if (selectedDeviceId.value === row.deviceId) selectedDeviceId.value = ''
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

// ---------------- 任务的增改与启用 / 禁用 ----------------

const dialogVisible = ref(false)
/** 弹窗编辑的任务行（null = 新建） */
const dialogTask = ref(null)
const submitting = ref(false)

function handleCreate() {
  if (!selectedDeviceId.value) return
  if (!nextTaskIndex.value) {
    ElMessage.warning(`这台设备的设备任务已达上限（${DEVICE_TASK_MAX} 条）：要腾出序号只能禁用已有任务，或把设备移出目录清空重来`)
    return
  }
  dialogTask.value = null
  dialogVisible.value = true
}

function handleEdit(row) {
  dialogTask.value = row
  dialogVisible.value = true
}

/**
 * 启用 / 禁用一条任务。
 * ⚠️ 禁用只需序号 + 状态；**重新启用是整体设置**，必须把列表里的内容一起发回去
 * （`deviceTaskToPayload` 按类型还原字段，少发的字段等于清空）。
 */
async function handleSetDisable(row, disable) {
  const action = disable === 1 ? '禁用' : '重新启用'
  try {
    await ElMessageBox.confirm(
      disable === 1
        ? `确定禁用 ${row.indexLabel} 这条任务吗？禁用后触发源不会再执行它（任务内容仍留在 NAS 上）。`
        : `确定重新启用 ${row.indexLabel} 吗？会把列表里的这份内容整体重发一次（NAS 的 DeviceTaskSet 是整体设置，少发的字段会被清空）。`,
      `${action}设备任务`,
      { confirmButtonText: action, cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    await deviceTaskStore.saveTask(deviceTaskToPayload(row, { deviceId: selectedDeviceId.value, disable }))
    ElMessage.success(`已${action} ${row.indexLabel}`)
  } catch (error) {
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    submitting.value = false
  }
}

/** 弹窗确认：写 NAS，成功后关弹窗（清单已由 store 重新拉过） */
async function handleDialogConfirm(payload) {
  submitting.value = true
  try {
    await deviceTaskStore.saveTask(payload)
    ElMessage.success(
      payload.disable === 1
        ? `已禁用 #${payload.taskIndex}（该任务不再被执行）`
        : `已保存 #${payload.taskIndex}`
    )
    dialogVisible.value = false
  } catch (error) {
    // 弹窗保持打开，用户可改完再试
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    submitting.value = false
  }
}

/** 复制文本（设备 ID 经常要粘到 NAS 管理软件侧对照） */
async function copyText(text) {
  const value = String(text == null ? '' : text)
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(`已复制 ${value}`)
  } catch {
    ElMessage.warning('当前浏览器不允许访问剪贴板，请手动复制')
  }
}
</script>

<template>
  <div class="dvtasks app-page">
    <el-alert
      class="dvtasks__hint"
      type="info"
      :closable="false"
      show-icon
      title="设备任务绑定在具体设备上：触发即执行，没有开始时间"
    >
      <template #default>
        <p class="dvtasks__hint-line">{{ HINT_BOUND_DEVICE }}。</p>
        <p class="dvtasks__hint-line">{{ HINT_CATALOG_FIRST }}；{{ HINT_MAX_TASKS }}。</p>
        <p class="dvtasks__hint-line">{{ HINT_TRIGGER_NO_CHECK }}；{{ HINT_DISABLE_ONLY }}。</p>
        <p class="dvtasks__hint-line">{{ HINT_NO_CODE_TABLE }}。</p>
      </template>
    </el-alert>

    <el-card class="dvtasks__card" shadow="never">
      <template #header>
        <div class="dvtasks__header">
          <div class="dvtasks__header-left">
            <span class="dvtasks__title">设备任务目录</span>
            <span class="dvtasks__count">
              已配置设备任务的设备 {{ deviceTaskStore.catalogCount }} 台<span v-if="keyword"
                >，筛选出 {{ filteredRows.length }} 台</span
              ><span class="dvtasks__loaded">（{{ lastLoadedText }}）</span>
            </span>
          </div>
          <div class="dvtasks__header-right">
            <el-input v-model="keyword" class="dvtasks__search" placeholder="搜索设备 ID / 名称 / 类型" clearable />
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-select
              v-model="candidateId"
              class="dvtasks__add"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="新增设备：选择要配设备任务的设备…"
              no-data-text="没有候选设备（先点「刷新」；也可直接输入 8 位设备 ID）"
              @change="handleAddDevice"
            >
              <el-option v-for="item in candidateOptions" :key="item.value" :label="item.label" :value="item.value">
                <span class="dvtasks__option">{{ item.label }}</span>
                <span class="dvtasks__option-type">{{ item.typeText || item.source }}</span>
              </el-option>
            </el-select>
          </div>
        </div>
      </template>

      <el-table v-loading="loading" class="dvtasks__table" :data="filteredRows" row-key="deviceId" stripe>
        <el-table-column label="设备" min-width="240">
          <template #default="{ row }">
            <div>
              <span class="dvtasks__mono">{{ row.deviceId }}</span>
              <el-button link type="primary" size="small" @click="copyText(row.deviceId)">复制</el-button>
              <el-tag v-if="row.stateText" class="dvtasks__tag" :type="row.stateTag" size="small" effect="plain" disable-transitions>
                {{ row.stateText }}
              </el-tag>
            </div>
            <div class="dvtasks__sub">{{ row.deviceName || '设备列表里没有这台设备' }}</div>
          </template>
        </el-table-column>

        <el-table-column label="设备类型" min-width="340">
          <template #default="{ row }">
            <div>{{ row.typeText }}</div>
            <div class="dvtasks__sub">{{ row.supportText }}</div>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleSelectDevice(row.deviceId)">查看任务</el-button>
            <el-button link type="danger" size="small" @click="handleRemoveDevice(row)">移出目录</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的设备' : '尚未为任何设备配置设备任务'">
            <p v-if="!keyword" class="dvtasks__empty-hint">
              用右上角的「新增设备」选一台设备即可开始配置：{{ HINT_CATALOG_FIRST }}。
              候选只列出手册 P79 类型表里的设备类型（41 / 51 / 2D / 55 / 2E / 4E / 7E / 6E / 3E / 4C / 5C / 5D /
              7C / 6C / 6D / 7D / 9D / 8D / 5F / 6F / 9F / DC / D8 / DE / CE / C8 / DA）。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>
    <el-card v-if="selectedRow" class="dvtasks__card" shadow="never">
      <template #header>
        <div class="dvtasks__header">
          <div class="dvtasks__header-left">
            <span class="dvtasks__title">设备任务：{{ selectedRow.deviceId }}</span>
            <span class="dvtasks__count">
              {{ selectedRow.deviceName || '设备列表里没有这台设备' }}（{{ selectedRow.typeText }}）·
              共 {{ taskRows.length }} 条<span class="dvtasks__loaded">（{{ selectedRow.supportText }}）</span>
            </span>
          </div>
          <div class="dvtasks__header-right">
            <el-button :loading="taskLoading" @click="loadTasks(selectedRow.deviceId)">刷新</el-button>
            <el-button type="primary" :disabled="submitting" @click="handleCreate">新建任务</el-button>
            <el-button :disabled="submitting" @click="selectedDeviceId = ''">收起</el-button>
          </div>
        </div>
      </template>

      <el-alert
        v-if="notConfigured"
        class="dvtasks__hint"
        type="success"
        :closable="false"
        show-icon
        :title="HINT_NO_TASKS_YET"
        description="用右上角的「新建任务」为它建第一条设备任务。"
      />

      <el-alert
        v-if="selectedRow.deviceType && !selectedRow.supportText.startsWith('支持')"
        class="dvtasks__hint"
        type="warning"
        :closable="false"
        show-icon
        title="手册 P79 的类型表里没有这个设备类型"
        :description="selectedRow.supportText"
      />

      <p class="dvtasks__warn">
        注意两处「接口没提供」的能力：① NAS 的设备任务清单（DeviceTaskList）字段表里没有 Disable，
        所以这个列表看不出某条任务当前是启用还是禁用 —— 要确保它被停用请用行内的「禁用」；
        ② 设备任务没有删除单条任务的接口，禁用是停用它的唯一手段（内容仍留在 NAS 上），
        要彻底清掉只能把设备移出目录（那会删掉该设备的全部任务）。
      </p>
      <p v-if="fileSourceLabel === '报警媒体'" class="dvtasks__warn">{{ HINT_ALARM_FILE }}。</p>

      <el-table v-loading="taskLoading" class="dvtasks__table" :data="taskRows" row-key="taskIndex" stripe>
        <el-table-column label="序号" width="150">
          <template #default="{ row }">
            <span class="dvtasks__mono">#{{ row.taskIndex }}</span>
            <div class="dvtasks__sub">{{ row.indexLabel }}</div>
          </template>
        </el-table-column>

        <el-table-column label="启用状态" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.disableKnown" :type="row.disabled ? 'info' : 'success'" size="small" effect="plain" disable-transitions>
              {{ row.disabled ? '禁用' : '启用' }}
            </el-tag>
            <el-tooltip v-else content="NAS 的 DeviceTaskList 字段表里没有 Disable，列表看不出启用 / 禁用" placement="top">
              <el-tag type="info" size="small" effect="plain" disable-transitions>NAS 未回传</el-tag>
            </el-tooltip>
          </template>
        </el-table-column>

        <el-table-column label="任务名" min-width="170">
          <template #default="{ row }">
            {{ row.TaskName || '（未命名，NAS 命名为 Device Task ' + row.taskIndex + '）' }}
            <div class="dvtasks__sub">优先等级 {{ row.Priority == null ? 0 : row.Priority }} · {{ row.endText }}</div>
          </template>
        </el-table-column>

        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" disable-transitions>{{ row.typeText }}</el-tag>
            <div v-if="tableTalkHint(row)" class="dvtasks__sub">{{ tableTalkHint(row) }}</div>
          </template>
        </el-table-column>

        <el-table-column label="播放内容" min-width="230">
          <template #default="{ row }">
            <div>{{ contentText(row) }}</div>
            <div class="dvtasks__sub">{{ row.playModeText }} · 循环 {{ row.LoopTimes == null ? '-' : row.LoopTimes }}（0 = 不限）</div>
          </template>
        </el-table-column>

        <el-table-column label="播放目标" min-width="230">
          <template #default="{ row }">{{ playerText(row) }}</template>
        </el-table-column>

        <el-table-column label="音量" width="140">
          <template #default="{ row }">{{ row.volumeText }}</template>
        </el-table-column>

        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="submitting" @click="handleEdit(row)">编辑</el-button>
            <el-button link type="warning" size="small" :disabled="submitting" @click="handleSetDisable(row, 1)">禁用</el-button>
            <el-button link type="success" size="small" :disabled="submitting" @click="handleSetDisable(row, 0)">启用</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty description="该设备尚未配置设备任务">
            <p class="dvtasks__empty-hint">用右上角的「新建任务」建第一条：序号 1~128，对应设备的按键 / 端口 / 触控按钮。</p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <DeviceTaskFormDialog
      v-model="dialogVisible"
      :device-id="selectedDeviceId"
      :device-type="selectedDeviceType"
      :device-name="selectedRow ? selectedRow.deviceName : ''"
      :task="dialogTask"
      :task-index-suggestion="nextTaskIndex"
      :file-options="fileOptions"
      :file-source-label="fileSourceLabel"
      :capturer-options="capturerOptions"
      :player-options="playerOptions"
      :talk-player-options="talkPlayerOptions"
      :submitting="submitting"
      @confirm="handleDialogConfirm"
    />

  </div>
</template>

<style scoped>
.dvtasks {
  display: flex;
  flex-direction: column;
}

.dvtasks__card {
  margin-bottom: 16px;
}

.dvtasks__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.dvtasks__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.dvtasks__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.dvtasks__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dvtasks__loaded {
  margin-left: 4px;
}

.dvtasks__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dvtasks__search {
  width: 220px;
}

.dvtasks__add {
  width: 320px;
}

.dvtasks__option {
  margin-right: 8px;
}

.dvtasks__option-type {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dvtasks__hint {
  margin-bottom: 12px;
}

.dvtasks__hint-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}

.dvtasks__warn {
  margin: 8px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.dvtasks__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
}

.dvtasks__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dvtasks__tag {
  margin-left: 8px;
}

.dvtasks__empty-hint {
  max-width: 640px;
  margin: 0 auto;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>


