<script setup>
// src/views/media/MediaListView.vue —— 媒体文件
//
// 数据来源（后端 docs/API.md「媒体文件模块」）：
//   GET  /api/media/system                   系统媒体文件列表
//   GET  /api/media/alarm                    报警媒体文件列表
//   GET  /api/media/sub-user/{subUserId}     分控软件媒体文件列表（必须先选一台分控软件设备）
//   POST /api/media/system|alarm/delete      删除（FileID + 原文件名一起确认目标）
//   POST /api/media/system|alarm/upload      上传（弹窗里**逐个串行**上传，见 MediaUploadDialog）
//
// 三个页签的差别很大，别当成「同一份数据换个来源」：
//   · 系统媒体 / 报警媒体 —— 可上传、可删除；⚠️ 两类的 FileID **取值范围重叠**，同一个 ID 在两类里是不同文件，
//     所以删除必须锁定当前页签走对应接口；
//   · 分控软件媒体 —— **只读**（NAS 没有上传 / 删除接口），必须先选一台分控软件设备
//     （请求用 SubUserID 头指定，设备 ID 必须是 8 位十六进制），候选来自设备管理的「主动插播设备」。
//
// 两层错误的分工与其他页面一致：
//   · HTTP 4xx/5xx —— request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import MediaDeleteDialog from '@/components/media/MediaDeleteDialog.vue'
import MediaUploadDialog from '@/components/media/MediaUploadDialog.vue'
import { getDeviceTypeName } from '@/constants/device'
import {
  MEDIA_TYPES,
  findMediaType,
  formatPlayTime,
  isUploadableMediaType,
  isValidSubUserId
} from '@/constants/media'
import { useDeviceStore } from '@/stores/device'
import { useMediaStore } from '@/stores/media'
import { NasResultError } from '@/utils/nas-result'

const route = useRoute()
const router = useRouter()
const mediaStore = useMediaStore()
const deviceStore = useDeviceStore()

/** 当前页签：优先读 URL 上的 ?type=，刷新或分享链接都能落回同一类 */
function resolveActiveKey() {
  const fromQuery = String(route.query.type || '')
  return MEDIA_TYPES.some((item) => item.key === fromQuery) ? fromQuery : MEDIA_TYPES[0].key
}

const activeKey = ref(resolveActiveKey())
const keyword = ref('')

const activeType = computed(() => findMediaType(activeKey.value))
const mediaFiles = computed(() => mediaStore.lists[activeKey.value] || [])
const loading = computed(() => Boolean(mediaStore.loading[activeKey.value]))
/** 只有系统 / 报警媒体能上传 */
const canUpload = computed(() => isUploadableMediaType(activeKey.value))
/** 也只有它们能删除：分控媒体连删除接口都没有（NAS 只给了列表） */
const canDelete = computed(() => isUploadableMediaType(activeKey.value))

/** 分控软件设备候选：设备管理「主动插播设备」里的设备（分控软件就登记在这一类） */
const subUserDevices = computed(() => deviceStore.lists.actRequester || [])
const subUserId = computed({
  get: () => mediaStore.subUserId,
  set: (value) => mediaStore.setSubUserId(value)
})
const subUserIdValid = computed(() => isValidSubUserId(subUserId.value))
/** 选/填的设备是否出现在「主动插播设备」列表里（不在也不算错：设备可能早已离线，NAS 仍可能有它的媒体） */
const subUserIdIsKnown = computed(() =>
  subUserDevices.value.some(
    (item) => String(item.DeviceID || '').trim().toUpperCase() === subUserId.value
  )
)
const subUserIdHint = computed(() => {
  if (!subUserId.value) return '请先选择或输入分控软件设备 ID（8 位十六进制）'
  if (!subUserIdValid.value) return '设备 ID 必须是 8 位十六进制，例如 00001E01'
  if (!subUserIdIsKnown.value) {
    return '该 ID 不在「主动插播设备」列表里：可以查询，但结果可能为空（设备已离线 / 从未配置）'
  }
  return ''
})

const subUserOptions = computed(() =>
  subUserDevices.value.map((item) => {
    const id = String(item.DeviceID == null ? '' : item.DeviceID).trim().toUpperCase()
    const typeName = getDeviceTypeName(item.DeviceType)
    return {
      value: id,
      label: `${item.DevName || '未命名'}（${id}）${typeName ? ` · ${typeName}` : ''}`
    }
  })
)

/** 拉取当前页签的列表；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await mediaStore.fetchList(activeKey.value, options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

// 切页签：地址栏同步 + 某一类首次进入时才拉数据（分控媒体在没选设备时 store 会直接给空列表）
watch(
  activeKey,
  (key) => {
    router.replace({ query: { ...route.query, type: key } })
    if (!mediaStore.loadedAt[key]) load()
  },
  { immediate: true }
)

// 换分控软件设备：setSubUserId 已经清掉加载标记，这里重新拉（没选设备时 store 不发请求）
watch(subUserId, () => {
  if (activeKey.value === 'subUser' && subUserIdValid.value) load()
})

onMounted(() => {
  // 分控设备候选来自设备管理的「主动插播设备」：没拉过就补一次（失败不打断本页）
  if (!deviceStore.loadedAt.actRequester) {
    deviceStore.fetchList('actRequester').catch(() => {})
  }
})

// 自动刷新（0 = 关闭）：只刷新当前页签，静默加载（避免表格 loading 反复闪动）
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

/** 关键字过滤：文件 ID / 文件名 / 所属分控设备 ID 任一命中即可（大小写不敏感） */
const filteredFiles = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return mediaFiles.value
  return mediaFiles.value.filter((item) =>
    [item.FileID, item.FileName, item.DeviceID].some((field) =>
      String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})

/** 复制文件 ID：任务 / 播放列表里要用（最常被手工抄的就是它） */
async function copyFileId(fileId) {
  try {
    await navigator.clipboard.writeText(fileId)
    ElMessage.success(`已复制 ${fileId}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}

// ---------------- 写操作 ----------------
const submitting = ref(false)

/**
 * 统一收口写操作的 loading 与错误提示（与设备 / 分组页面一致）。
 * @param {() => Promise<any>} submit 真正发请求的动作
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

// —— 上传（弹窗自己管理队列 / 串行 / 逐项结果，页面只负责开关）
const uploadVisible = ref(false)

function openUploadDialog() {
  if (!canUpload.value) return
  uploadVisible.value = true
}

// —— 删除
const deleteVisible = ref(false)
const deleteTarget = ref(null)

function openDeleteDialog(row) {
  if (!canDelete.value) return
  deleteTarget.value = row
  deleteVisible.value = true
}

async function handleDeleteConfirm() {
  const target = deleteTarget.value
  if (!target) return

  const ok = await runWrite(
    () =>
      mediaStore.removeFile(activeKey.value, {
        fileId: target.FileID,
        // ⚠️ 必须用列表里的原名：NAS 用 FileID + FileName 一起确认目标（名字不一致返回 Result=8）
        fileName: target.FileName
      }),
    `已删除 ${target.FileID}（${target.FileName}）`
  )
  if (ok) deleteVisible.value = false
}

</script>

<template>
  <div class="media">
    <el-card class="media__card" shadow="never">
      <template #header>
        <div class="media__header">
          <div class="media__header-left">
            <span class="media__title">媒体文件</span>
            <span class="media__count">
              共 {{ filteredFiles.length }} 个<span v-if="keyword">（全部 {{ mediaFiles.length }} 个）</span>
            </span>
          </div>

          <div class="media__header-right">
            <el-input
              v-model="keyword"
              class="media__search"
              placeholder="文件 ID / 文件名 / 设备 ID"
              clearable
            />
            <el-select v-model="autoRefreshSeconds" class="media__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="5" label="每 5 秒刷新" />
              <el-option :value="10" label="每 10 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
            </el-select>
            <el-button :loading="loading" @click="load()">刷新</el-button>
            <el-tooltip
              :disabled="canUpload"
              content="NAS 没有提供上传到分控软件媒体的接口"
              placement="top"
            >
              <span>
                <el-button type="primary" :disabled="!canUpload" @click="openUploadDialog">
                  上传文件
                </el-button>
              </span>
            </el-tooltip>
          </div>
        </div>
      </template>

      <el-tabs v-model="activeKey" class="media__tabs">
        <el-tab-pane
          v-for="item in MEDIA_TYPES"
          :key="item.key"
          :name="item.key"
          :label="item.label"
        />
      </el-tabs>

      <el-alert
        class="media__hint"
        type="info"
        :closable="false"
        show-icon
        :title="activeType.hint"
      />

      <!-- 分控软件媒体：必须先指定一台设备（后端用 SubUserID 头查询） -->
      <div v-if="activeType.needsSubUserId" class="media__subuser">
        <span class="media__subuser-label">分控软件设备</span>
        <el-select
          v-model="subUserId"
          class="media__subuser-select"
          placeholder="选择设备，或直接输入 8 位十六进制设备 ID"
          filterable
          allow-create
          default-first-option
          clearable
        >
          <el-option
            v-for="item in subUserOptions"
            :key="item.value"
            :value="item.value"
            :label="item.label"
          />
        </el-select>
        <el-button :loading="loading" :disabled="!subUserIdValid" @click="load()">查询</el-button>
        <span v-if="subUserIdHint" class="media__subuser-hint">{{ subUserIdHint }}</span>
      </div>

      <p class="media__tip">
        引用方式：任务与播放列表的 <em>FileList</em> 里直接写这个 <em>4 位十六进制文件 ID</em>；
        <em>FFxx</em> 是「引用播放列表 xx」的写法，不要和文件 ID 混用。
      </p>

      <el-table
        v-loading="loading"
        class="media__table"
        :data="filteredFiles"
        row-key="FileID"
        stripe
        :empty-text="
          keyword
            ? '没有匹配的文件'
            : activeType.needsSubUserId && !subUserIdValid
              ? '请先选择分控软件设备'
              : '暂无媒体文件'
        "
      >
        <el-table-column label="文件 ID" width="170">
          <template #default="{ row }">
            <span class="media__mono">{{ row.FileID }}</span>
            <el-button link type="primary" size="small" @click="copyFileId(row.FileID)">
              复制
            </el-button>
          </template>
        </el-table-column>

        <el-table-column prop="FileName" label="文件名" min-width="240" show-overflow-tooltip />

        <el-table-column label="播放时长" width="150">
          <template #default="{ row }">
            <span>{{ formatPlayTime(row.PlayTime) }}</span>
            <span v-if="row.PlayTime !== null && row.PlayTime !== undefined" class="media__sub">
              （{{ row.PlayTime }} 秒）
            </span>
          </template>
        </el-table-column>

        <el-table-column v-if="activeType.needsSubUserId" label="所属设备" width="150">
          <template #default="{ row }">
            <span v-if="row.DeviceID" class="media__mono">{{ row.DeviceID }}</span>
            <span v-else class="media__muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="90" align="right">
          <template #default="{ row }">
            <el-tooltip
              :disabled="canDelete"
              content="分控软件媒体只能查看：NAS 没有提供删除接口"
              placement="top"
            >
              <span>
                <el-button
                  link
                  type="danger"
                  size="small"
                  :disabled="!canDelete"
                  @click="openDeleteDialog(row)"
                >
                  删除
                </el-button>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <MediaUploadDialog v-model="uploadVisible" :media-type="activeKey" />
    <MediaDeleteDialog
      v-model="deleteVisible"
      :file="deleteTarget"
      :media-type="activeKey"
      :submitting="submitting"
      @confirm="handleDeleteConfirm"
    />
  </div>
</template>

<style scoped>
.media__card {
  border-radius: 8px;
}

.media__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.media__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.media__title {
  font-size: 16px;
  font-weight: 600;
}

.media__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.media__header-right {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.media__search {
  width: 220px;
}

.media__interval {
  width: 140px;
}

.media__tabs {
  margin-bottom: 8px;
}

.media__hint {
  margin-bottom: 12px;
}

.media__subuser {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.media__subuser-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.media__subuser-select {
  width: 360px;
}

.media__subuser-hint {
  font-size: 12px;
  color: var(--el-color-warning);
}

.media__tip {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.media__tip em {
  color: var(--el-color-primary);
  font-style: normal;
}

.media__mono {
  margin-right: 8px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.media__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.media__muted {
  color: var(--el-text-color-placeholder);
}
</style>
