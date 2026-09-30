<script setup>
// src/views/devices/DeviceListView.vue —— 设备管理
//
// 四类设备各一个页签，数据来自：
//   GET /api/devices/player        播放终端
//   GET /api/devices/capturer      被动采播器
//   GET /api/devices/act-capturer  主动采播设备
//   GET /api/devices/act-requester 主动插播设备
// 写操作：设置音量 / 修改名称 / 删除离线设备 / 添加虚假设备，成功后自动重拉当前列表。
//
// 两层错误的分工（本项目特有）：
//   · HTTP 4xx/5xx —— request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DummyDeviceDialog from '@/components/devices/DummyDeviceDialog.vue'
import RenameDialog from '@/components/devices/RenameDialog.vue'
import VolumeDialog from '@/components/devices/VolumeDialog.vue'
import {
  DEVICE_CLASSES,
  formatVolume,
  getDeviceState,
  getDeviceTypeName,
  isDeletable,
  suggestDummyDeviceId
} from '@/constants/device'
import { useDeviceStore } from '@/stores/device'
import { NasResultError } from '@/utils/nas-result'

const route = useRoute()
const router = useRouter()
const deviceStore = useDeviceStore()

/** 当前页签：优先读 URL 上的 ?class=，刷新或分享链接都能落回同一类设备 */
function resolveActiveKey() {
  const fromQuery = String(route.query.class || '')
  return DEVICE_CLASSES.some((item) => item.key === fromQuery) ? fromQuery : DEVICE_CLASSES[0].key
}

const activeKey = ref(resolveActiveKey())
const keyword = ref('')

const activeClass = computed(
  () => DEVICE_CLASSES.find((item) => item.key === activeKey.value) || DEVICE_CLASSES[0]
)
const devices = computed(() => deviceStore.lists[activeKey.value] || [])
const loading = computed(() => Boolean(deviceStore.loading[activeKey.value]))

/** 关键字过滤：设备 ID / 名称 / IP / MAC 任一命中即可（大小写不敏感） */
const filteredDevices = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return devices.value
  return devices.value.filter((item) =>
    [item.DeviceID, item.DevName, item.IP, item.MAC].some((field) =>
      String(field || '').toLowerCase().includes(text)
    )
  )
})

/** 拉取当前页签的列表；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await deviceStore.fetchList(activeKey.value, options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

// 切页签：地址栏同步 + 某一类首次进入时才拉数据
watch(
  activeKey,
  (key) => {
    router.replace({ query: { ...route.query, class: key } })
    if (!deviceStore.loadedAt[key]) load()
  },
  { immediate: true }
)

function handleRefresh() {
  load()
}

// 自动刷新（0 = 关闭）：只刷新当前页签，且静默加载（避免表格 loading 反复闪动）
const autoRefreshSeconds = ref(0)
let autoRefreshTimer = null

watch(autoRefreshSeconds, (seconds) => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
  if (seconds > 0) {
    autoRefreshTimer = setInterval(() => load({ silent: true }), seconds * 1000)
  }
})

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer)
})

/** 复制设备 ID（排障、填任务时最常用） */
async function copyDeviceId(deviceId) {
  try {
    await navigator.clipboard.writeText(deviceId)
    ElMessage.success(`已复制 ${deviceId}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}
// ---------------- 写操作 ----------------
const submitting = ref(false)

/**
 * 统一收口写操作的 loading 与错误提示。
 * @param {() => Promise<void>} submit 真正发请求的动作
 * @param {string} successText 成功提示
 * @returns {Promise<boolean>} 是否成功（父页面据此决定关不关弹窗）
 */
async function runWrite(submit, successText) {
  submitting.value = true
  try {
    await submit()
    ElMessage.success(successText)
    return true
  } catch (error) {
    // HTTP 层的错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
    return false
  } finally {
    submitting.value = false
  }
}

// —— 设置音量
const volumeVisible = ref(false)
const volumeTarget = ref(null)

function openVolumeDialog(row) {
  volumeTarget.value = row
  volumeVisible.value = true
}

async function handleVolumeConfirm(volume) {
  const target = volumeTarget.value
  if (!target) return

  const ok = await runWrite(
    () =>
      deviceStore.setVolume({
        deviceId: target.DeviceID,
        volume,
        devClass: activeClass.value.devClass
      }),
    `「${target.DevName || target.DeviceID}」基础音量已设为 ${formatVolume(volume)}`
  )
  if (ok) volumeVisible.value = false
}

// —— 修改名称（当前 NAS 仅支持播放终端）
const renameVisible = ref(false)
const renameTarget = ref(null)
const canRename = computed(() => activeClass.value.devClass === 0)

function openRenameDialog(row) {
  if (!canRename.value) return
  renameTarget.value = row
  renameVisible.value = true
}

async function handleRenameConfirm(devName) {
  const target = renameTarget.value
  if (!target) return

  const ok = await runWrite(
    () =>
      deviceStore.rename({
        deviceId: target.DeviceID,
        devName,
        devClass: activeClass.value.devClass
      }),
    '设备名称已提交，NAS 约 10 秒后在列表中生效'
  )
  if (ok) renameVisible.value = false
}

// —— 删除（只能删离线 / 历史设备）
async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定要删除设备「${row.DevName || '未命名'}」（${row.DeviceID}）吗？此操作不可撤销。`,
      '删除设备',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }

  await runWrite(
    () => deviceStore.remove({ deviceId: row.DeviceID, devClass: activeClass.value.devClass }),
    `已删除设备 ${row.DeviceID}`
  )
}

// —— 添加虚假设备（只在播放终端页签提供）
const dummyVisible = ref(false)
const dummySuggestion = computed(() => suggestDummyDeviceId(deviceStore.allDeviceIds))

function openDummyDialog() {
  dummyVisible.value = true
}

async function handleDummyConfirm(payload) {
  const ok = await runWrite(
    () => deviceStore.addDummy({ ...payload, devClass: activeClass.value.devClass }),
    '虚假设备已添加（状态为「历史」、无 IP，仅凑数用）'
  )
  if (ok) dummyVisible.value = false
}
</script>
<template>
  <div class="devices">
    <el-card class="devices__card" shadow="never">
      <template #header>
        <div class="devices__header">
          <div class="devices__header-left">
            <span class="devices__title">{{ activeClass.label }}</span>
            <span class="devices__count">
              共 {{ filteredDevices.length }} 台<span v-if="keyword">（全部 {{ devices.length }} 台）</span>
            </span>
          </div>

          <div class="devices__header-right">
            <el-input
              v-model="keyword"
              class="devices__search"
              placeholder="搜索 ID / 名称 / IP / MAC"
              clearable
            />
            <el-select v-model="autoRefreshSeconds" class="devices__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="5" label="每 5 秒刷新" />
              <el-option :value="10" label="每 10 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
            </el-select>
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-button v-if="canRename" type="primary" @click="openDummyDialog">添加虚假设备</el-button>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeKey" class="devices__tabs">
        <el-tab-pane
          v-for="item in DEVICE_CLASSES"
          :key="item.key"
          :name="item.key"
          :label="item.label"
        />
      </el-tabs>

      <el-alert
        v-if="activeClass.hint"
        class="devices__hint"
        type="info"
        :closable="false"
        show-icon
        :title="activeClass.hint"
      />

      <el-table
        v-loading="loading"
        class="devices__table"
        :data="filteredDevices"
        row-key="DeviceID"
        stripe
      >
        <el-table-column label="设备 ID" width="160">
          <template #default="{ row }">
            <span class="devices__mono">{{ row.DeviceID }}</span>
            <el-button link type="primary" size="small" @click="copyDeviceId(row.DeviceID)">
              复制
            </el-button>
          </template>
        </el-table-column>

        <el-table-column prop="DevName" label="设备名称" min-width="160" show-overflow-tooltip />

        <el-table-column label="IP / 端口" min-width="150">
          <template #default="{ row }">
            <span v-if="row.IP">{{ row.IP }}<span v-if="row.Port">:{{ row.Port }}</span></span>
            <span v-else class="devices__muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="MAC" min-width="160">
          <template #default="{ row }">
            <span v-if="row.MAC" class="devices__mono">{{ row.MAC }}</span>
            <span v-else class="devices__muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="getDeviceState(row.State).tag" disable-transitions>
              {{ getDeviceState(row.State).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="基础音量" min-width="130">
          <template #default="{ row }">{{ formatVolume(row.Volume) }}</template>
        </el-table-column>

        <el-table-column label="设备类型" min-width="180">
          <template #default="{ row }">
            <span>{{ getDeviceTypeName(row.DeviceType) || '未知类型' }}</span>
            <span v-if="row.DeviceType" class="devices__type-code">0x{{ row.DeviceType }}</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openVolumeDialog(row)">音量</el-button>

            <el-tooltip
              :disabled="canRename"
              content="当前 NAS 版本仅支持修改播放终端的名称"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="primary"
                  size="small"
                  :disabled="!canRename"
                  @click="openRenameDialog(row)"
                >
                  改名
                </el-button>
              </span>
            </el-tooltip>

            <el-tooltip
              :disabled="isDeletable(row.State)"
              content="只能删除状态为离线 / 历史的设备"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :disabled="!isDeletable(row.State)"
                  @click="handleDelete(row)"
                >
                  删除
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的设备' : '该类别下暂无设备'">
            <p v-if="!keyword" class="devices__empty-hint">
              真实设备上线后会自动出现在这里；也可以先用「添加虚假设备」放一条占位记录（无 IP、不能参与任务）。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <VolumeDialog
      v-model="volumeVisible"
      :device="volumeTarget"
      :submitting="submitting"
      @confirm="handleVolumeConfirm"
    />

    <RenameDialog
      v-model="renameVisible"
      :device="renameTarget"
      :submitting="submitting"
      @confirm="handleRenameConfirm"
    />

    <DummyDeviceDialog
      v-model="dummyVisible"
      :suggested-id="dummySuggestion"
      :device-ids="deviceStore.allDeviceIds"
      :submitting="submitting"
      @confirm="handleDummyConfirm"
    />
  </div>
</template>

<style scoped>
.devices__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.devices__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.devices__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.devices__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.devices__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.devices__search {
  width: 220px;
}

.devices__interval {
  width: 130px;
}

.devices__tabs {
  margin-bottom: 8px;
}

.devices__hint {
  margin-bottom: 12px;
}

.devices__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.devices__muted {
  color: var(--el-text-color-placeholder);
}

.devices__type-code {
  margin-left: 6px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.devices__empty-hint {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>
