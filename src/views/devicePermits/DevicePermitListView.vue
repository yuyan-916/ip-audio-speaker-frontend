<script setup>
// src/views/devicePermits/DevicePermitListView.vue —— 设备权限
//
// 数据来源（后端 docs/API.md「设备权限模块」，NAS 手册 P14-18）：
//   GET  /api/device-permits/catalog   已设置权限数据的设备目录（DeviceID / DeviceType）
//   GET  /api/device-permits/{id}      某台设备的权限数据（弹窗打开时读，Result=1 = 尚未设置）
//   POST /api/device-permits           设置权限数据（三类都空 = 清除）
//
// ⚠️ 这一页要先把「它到底给谁用」讲清楚，否则用户会以为系统缺了配置：
//    手册 P18 明确 —— **HTTP API 用户本身可完整获取设备与分组信息，无需设置权限数据**；
//    这个页面是替「分控软件 / 对讲话筒 / 手机 APP / 中间件」这类需要在**本地显示播放目标清单**的设备配权限的。
//
// 另一个关键口径：目录**不需要专门添加**设备 —— 给某台设备设置权限数据后它会自动进入目录，
// 所以「新增权限数据」= 选一台设备并直接写它的权限；没有单独的「添加 / 删除目录项」接口。
//
// 两层错误的分工与其它页面一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，捕获 NasResultError 后提示。

import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import DevicePermitEditDialog from '@/components/devicePermits/DevicePermitEditDialog.vue'
import { getDeviceState, isValidDeviceId } from '@/constants/device'
import {
  HINT_CATALOG_AUTO,
  HINT_EMPTY_ALL,
  HINT_LIST_MAX,
  HINT_NO_NEED,
  HINT_SELF_EXCLUDE,
  HINT_SERVER_NO_CHECK,
  buildCapturerOptions,
  buildDeviceIndex,
  buildPermitDeviceCandidates,
  buildPermitGroupOptions,
  buildPlayerOptions
} from '@/constants/devicePermit'
import { useDevicePermitStore } from '@/stores/devicePermit'
import { useDeviceStore } from '@/stores/device'
import { useGroupStore } from '@/stores/group'
import { NasResultError } from '@/utils/nas-result'

const permitStore = useDevicePermitStore()
const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

/** 设备列表的四个 key（候选设备与各清单候选项都从这四类里取） */
const DEVICE_LIST_KEYS = ['player', 'capturer', 'actCapturer', 'actRequester']

const keyword = ref('')
const loading = computed(() => Boolean(permitStore.loading))
const lastLoadedText = computed(() =>
  permitStore.lastLoadedAt ? new Date(permitStore.lastLoadedAt).toLocaleString() : '还没读过'
)

/** 设备 ID → 设备对象：目录里只有 ID / 类型，名称与在线状态要靠设备列表补 */
const deviceIndex = computed(() => buildDeviceIndex(deviceStore.lists))

/** 表格数据：目录 +（能查到时的）设备名称 / 在线状态 */
const rows = computed(() =>
  permitStore.catalogRows.map((row) => {
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

// ---------------- 各清单的候选项（弹窗直接用，页面不重复算） ----------------

const groupOptions = computed(() => buildPermitGroupOptions(groupStore.groups))
const playerOptions = computed(() => buildPlayerOptions(deviceStore.lists.player))
const capturerOptions = computed(() =>
  buildCapturerOptions({
    capturer: deviceStore.lists.capturer,
    actCapturer: deviceStore.lists.actCapturer,
    actRequester: deviceStore.lists.actRequester
  })
)
/** 可能需要权限数据的设备（手册 P18 的 9 种类型）：「新增权限数据」的下拉就是它 */
const candidateOptions = computed(() => buildPermitDeviceCandidates(deviceStore.lists))

// ---------------- 读取 ----------------

async function load({ silent = false } = {}) {
  try {
    await permitStore.fetchCatalog({ silent })
  } catch (error) {
    // HTTP 层错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

/** 没拉过的设备 / 分组列表补一次（失败不打断本页，只是候选项少一些） */
function ensureSources() {
  DEVICE_LIST_KEYS.forEach((key) => {
    if (!deviceStore.loadedAt[key]) deviceStore.fetchList(key).catch(() => {})
  })
  if (!groupStore.loadedAt) groupStore.fetchGroups().catch(() => {})
}

/** 强制重拉设备 / 分组列表（「刷新」时用：静默、失败不提示，本页主数据仍是目录） */
function refreshSources() {
  DEVICE_LIST_KEYS.forEach((key) => deviceStore.fetchList(key, { silent: true }).catch(() => {}))
  groupStore.fetchGroups({ silent: true }).catch(() => {})
}

onMounted(() => {
  load()
  ensureSources()
})

async function handleRefresh() {
  await load()
  refreshSources()
}

// ---------------- 新增 / 编辑（同一个弹窗） ----------------

const dialogVisible = ref(false)
const dialogDeviceId = ref('')
const dialogDeviceType = ref('')
const dialogDeviceName = ref('')
/** 「新增权限数据」下拉的当前选中值（选完立刻清空，避免误以为已经选定了） */
const candidateId = ref('')
const submitting = ref(false)

/**
 * 打开某台设备的权限弹窗。
 * @param {string} deviceId 8 位十六进制设备 ID
 * @param {{deviceType?: string, deviceName?: string}} [extra] 设备的类型与名称（拿不到就传空）
 */
function openDialog(deviceId, extra = {}) {
  const id = String(deviceId == null ? '' : deviceId).trim().toUpperCase()
  if (!isValidDeviceId(id)) {
    ElMessage.warning('设备 ID 必须是 8 位十六进制（例如 00001AB2）')
    return
  }
  dialogDeviceId.value = id
  dialogDeviceType.value = extra.deviceType || ''
  dialogDeviceName.value = extra.deviceName || ''
  dialogVisible.value = true
}

/** 「新增权限数据」：从候选下拉里选了（或手输）一台设备 */
function handleCandidateChange(value) {
  candidateId.value = ''
  const id = String(value == null ? '' : value).trim().toUpperCase()
  // 清空下拉（value 为空串）不提示；手输了非法内容才提示
  if (!id) return
  if (!isValidDeviceId(id)) {
    ElMessage.warning(`「${id}」不是合法的设备 ID：请输入 8 位十六进制（例如 00001AB2）`)
    return
  }
  const option = candidateOptions.value.find((item) => item.value === id)
  openDialog(id, {
    deviceType: option ? option.deviceType : '',
    deviceName: option ? option.deviceName : ''
  })
}

/** 目录里某一行「编辑权限数据」：类型 / 名称优先从设备列表补，取不到就让弹窗按未知类型提示 */
function handleEdit(row) {
  const device = deviceIndex.value[row.deviceId]
  openDialog(row.deviceId, {
    deviceType: device ? device.DeviceType : row.deviceType,
    deviceName: device ? device.DevName : ''
  })
}

/** 弹窗确认：写 NAS（三类都空就是清除），成功后关弹窗（目录已由 store 重新拉过） */
async function handleDialogConfirm(payload) {
  submitting.value = true
  try {
    await permitStore.savePermit(payload)
    ElMessage.success(`已保存 ${payload.deviceId} 的权限数据`)
    dialogVisible.value = false
  } catch (error) {
    // HTTP 层错误拦截器已提示；NAS 业务拒绝在这里补一次（弹窗保持打开，用户可改完再试）
    if (error instanceof NasResultError) ElMessage.error(error.message)
  } finally {
    submitting.value = false
  }
}

/** 复制文本（设备 ID 经常要粘到 NAS / 分控软件侧对照） */
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
  <div class="permits app-page">
    <el-card class="permits__card" shadow="never">
      <template #header>
        <div class="permits__header">
          <div class="permits__header-left">
            <span class="permits__title">设备权限</span>
            <span class="permits__count">
              已设置权限数据的设备 {{ permitStore.catalogCount }} 台<span v-if="keyword"
                >，筛选出 {{ filteredRows.length }} 台</span
              ><span class="permits__loaded">（{{ lastLoadedText }}）</span>
            </span>
          </div>
          <div class="permits__header-right">
            <el-input v-model="keyword" class="permits__search" placeholder="搜索设备 ID / 名称 / 类型" clearable />
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-select
              v-model="candidateId"
              class="permits__add"
              filterable
              allow-create
              default-first-option
              clearable
              placeholder="新增权限数据：选择设备…"
              no-data-text="没有可选的候选设备（先点「刷新」；也可直接输入 8 位设备 ID）"
              @change="handleCandidateChange"
            >
              <el-option v-for="item in candidateOptions" :key="item.value" :label="item.label" :value="item.value">
                <span class="permits__option">{{ item.label }}</span>
                <el-tag :type="item.stateTag" size="small" effect="plain">{{ item.stateText }}</el-tag>
                <span class="permits__option-type">{{ item.typeText || item.source }}</span>
              </el-option>
            </el-select>
          </div>
        </div>
      </template>

      <el-alert
        class="permits__hint"
        type="info"
        :closable="false"
        show-icon
        title="HTTP API 用户本身无需设置权限数据（手册 P18）"
      >
        <template #default>
          <p class="permits__hint-line">{{ HINT_NO_NEED }}。</p>
          <p class="permits__hint-line">{{ HINT_CATALOG_AUTO }}；{{ HINT_EMPTY_ALL }}。</p>
          <p class="permits__hint-line">{{ HINT_LIST_MAX }}；{{ HINT_SELF_EXCLUDE }}。</p>
          <p class="permits__hint-line">{{ HINT_SERVER_NO_CHECK }}。</p>
        </template>
      </el-alert>

      <el-table v-loading="loading" class="permits__table" :data="filteredRows" row-key="deviceId" stripe>
        <el-table-column label="设备" min-width="260">
          <template #default="{ row }">
            <div>
              <span class="permits__mono">{{ row.deviceId }}</span>
              <el-button link type="primary" size="small" @click="copyText(row.deviceId)">复制</el-button>
            </div>
            <div class="permits__sub">{{ row.deviceName || '设备列表里没有这台设备' }}</div>
          </template>
        </el-table-column>

        <el-table-column label="设备类型" min-width="320">
          <template #default="{ row }">
            <span>{{ row.typeText }}</span>
            <el-tag
              v-if="!row.needsPermit"
              class="permits__tag"
              size="small"
              type="warning"
              effect="plain"
              disable-transitions
            >
              手册未列为需配权限的类型
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.stateText" :type="row.stateTag" size="small" effect="plain" disable-transitions>
              {{ row.stateText }}
            </el-tag>
            <span v-else class="permits__muted">未知</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="handleEdit(row)">编辑权限数据</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的设备' : '尚未为任何设备设置权限数据'">
            <p v-if="!keyword" class="permits__empty-hint">
              用右上角的「新增权限数据」选择一台设备即可开始配置：{{ HINT_CATALOG_AUTO }}。
              候选只列出手册建议配置权限的类型（E8 分控软件 / DA 手机 APP / CE 声卡采集软件 / DE、D8 中间件 /
              1E 寻呼话筒 / 5E 对讲话筒 / 5F、9F 网络对讲话筒终端）。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <DevicePermitEditDialog
      v-model="dialogVisible"
      :device-id="dialogDeviceId"
      :device-type="dialogDeviceType"
      :device-name="dialogDeviceName"
      :group-options="groupOptions"
      :player-options="playerOptions"
      :capturer-options="capturerOptions"
      :submitting="submitting"
      @confirm="handleDialogConfirm"
    />
  </div>
</template>

<style scoped>
.permits {
  display: flex;
  flex-direction: column;
}

.permits__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.permits__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.permits__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.permits__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permits__loaded {
  margin-left: 4px;
}

.permits__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.permits__search {
  width: 220px;
}

.permits__add {
  width: 300px;
}

.permits__option {
  margin-right: 8px;
}

.permits__option-type {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permits__hint {
  margin-bottom: 12px;
}

.permits__hint-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}

.permits__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
}

.permits__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permits__tag {
  margin-left: 8px;
}

.permits__muted {
  color: var(--el-text-color-placeholder);
}

.permits__empty-hint {
  max-width: 560px;
  margin: 0 auto;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>
