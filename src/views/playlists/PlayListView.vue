<script setup>
// src/views/playlists/PlayListView.vue —— 播放列表
//
// 数据来源（后端 docs/API.md「播放列表模块」）：
//   GET  /api/playlists         播放列表（PlayListID / PlayListName / FileList）
//   POST /api/playlists/new      新建（返回 NAS 分配的 PlayListID，可直接提示用户）
//   POST /api/playlists/edit     编辑（⚠️ 缺省 FileList = 清空文件列表，所以始终提交完整有序数组）
//   POST /api/playlists/delete   删除（必须带名称，NAS 用它确认目标）
//
// 两个关键语义（都在 UI 里落地）：
//   · **FileList 有序**：数组顺序就是播放顺序 → 编辑弹窗里是「已选有序列表 + 上移 / 下移 / 移除」；
//   · **只能引用系统媒体文件** → 候选与文件名补全都取 `media` store 的 system 列表
//     （既不重复拉接口，也保证能显示文件名 / 时长）。
//
// 两层错误的分工与其它模块一致：
//   · HTTP 4xx/5xx —— request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PlayListFormDialog from '@/components/playlists/PlayListFormDialog.vue'
import PlayListViewDialog from '@/components/playlists/PlayListViewDialog.vue'
import {
  countPlayListRefs,
  describePlayListFile,
  playListFileCount,
  toTaskFileListRef
} from '@/constants/playlist'
import { useMediaStore } from '@/stores/media'
import { usePlayListStore } from '@/stores/playlist'
import { NasResultError } from '@/utils/nas-result'

const mediaStore = useMediaStore()
const playListStore = usePlayListStore()

const keyword = ref('')
const playlists = computed(() => playListStore.playlists)
const loading = computed(() => Boolean(playListStore.loading))
/** 系统媒体文件：候选、文件名与时长都取自它（播放列表只能引用系统媒体） */
const systemFiles = computed(() => mediaStore.lists.system || [])

/** 关键字过滤：播放列表 ID / 名称 / 任务用引用（FFxx）任一命中即可 */
const filteredPlaylists = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return playlists.value
  return playlists.value.filter((item) =>
    [item.PlayListID, item.PlayListName, toTaskFileListRef(item.PlayListID)].some((field) =>
      String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})

/** 拉取播放列表；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await playListStore.fetchPlayLists(options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

onMounted(() => {
  load()
  // 文件预览、候选与时长都要用系统媒体列表：没拉过就补一次（失败不打断播放列表页）
  if (!mediaStore.loadedAt.system) {
    mediaStore.fetchList('system').catch(() => {})
  }
})
// 自动刷新（0 = 关闭）：静默加载，避免表格 loading 反复闪动
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

function handleRefresh() {
  load()
}

// ---------------- 写操作 ----------------
const submitting = ref(false)

/**
 * 统一收口写操作的 loading 与错误提示。
 * @param {() => Promise<any>} submit 真正发请求的动作
 * @param {string|((result: any) => string)} successText 成功提示；传函数时可用 submit 的返回值拼文案
 * @returns {Promise<boolean>} 是否成功（父页面据此决定关不关弹窗）
 */
async function runWrite(submit, successText) {
  submitting.value = true
  try {
    const result = await submit()
    ElMessage.success(typeof successText === 'function' ? successText(result) : successText)
    return true
  } catch (error) {
    // HTTP 层的错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
    return false
  } finally {
    submitting.value = false
  }
}

// —— 新建 / 编辑（共用一个弹窗）
const formVisible = ref(false)
const editingPlayList = ref(null)

function openCreateDialog() {
  editingPlayList.value = null
  formVisible.value = true
}

function openEditDialog(row) {
  editingPlayList.value = row
  formVisible.value = true
}

async function handleFormConfirm({ playListName, fileList }) {
  const target = editingPlayList.value
  const ok = target
    ? await runWrite(
        () => playListStore.updatePlayList({ playListId: target.PlayListID, playListName, fileList }),
        `播放列表「${playListName}」已更新（${fileList.length} 个文件）`
      )
    : await runWrite(
        () => playListStore.createPlayList({ playListName, fileList }),
        (playListId) =>
          playListId
            ? `播放列表已创建，NAS 分配的 ID 是 ${playListId}（任务里写成 FF${playListId}）`
            : '播放列表已创建（NAS 未回传 ID，请刷新列表查看）'
      )
  if (ok) formVisible.value = false
}

// —— 查看内容
const viewVisible = ref(false)
const viewTarget = ref(null)

function openViewDialog(row) {
  viewTarget.value = row
  viewVisible.value = true
}

// —— 删除（必须带原名：NAS 用它确认目标列表）
async function handleDelete(row) {
  const name = row.PlayListName || '未命名列表'
  try {
    await ElMessageBox.confirm(
      `确定要删除播放列表「${name}」（${row.PlayListID}）吗？该列表引用的 ${playListFileCount(row)} 个系统媒体文件不会被删除，仍在「媒体文件」页签里；已引用这个列表的任务会失去播放内容。此操作不可撤销。`,
      '删除播放列表',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }

  await runWrite(
    () =>
      playListStore.removePlayList({ playListId: row.PlayListID, playListName: row.PlayListName }),
    `已删除播放列表 ${row.PlayListID}`
  )
}

/** 文件预览：按顺序取前 3 个（查不到名字就退回 FileID），其余在表格里折成「等 N 个」 */
function filePreview(row) {
  const list = Array.isArray(row.FileList) ? row.FileList : []
  return list.slice(0, 3).map((id) => {
    const file = describePlayListFile(id, systemFiles.value)
    return file.fileName || file.fileId || '（空）'
  })
}

/** 列表里形如 FFxx 的条目数（NAS 会当成「引用播放列表」，需要提示） */
function refCountOf(row) {
  return countPlayListRefs(row)
}

/** 复制文本（列表 ID 与任务用引用都常用） */
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
  <div class="playlists">
    <el-card class="playlists__card" shadow="never">
      <template #header>
        <div class="playlists__header">
          <div class="playlists__header-left">
            <span class="playlists__title">播放列表</span>
            <span class="playlists__count">
              共 {{ filteredPlaylists.length }} 个列表<span v-if="keyword">（全部 {{ playlists.length }} 个）</span>
            </span>
          </div>

          <div class="playlists__header-right">
            <el-input
              v-model="keyword"
              class="playlists__search"
              placeholder="搜索列表 ID / 名称"
              clearable
            />
            <el-select v-model="autoRefreshSeconds" class="playlists__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="5" label="每 5 秒刷新" />
              <el-option :value="10" label="每 10 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
            </el-select>
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-button type="primary" @click="openCreateDialog">新建播放列表</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="playlists__hint"
        type="info"
        :closable="false"
        show-icon
        title="播放列表按顺序引用系统媒体文件：加入任务时用 4 位的 FFxx"
        description="列表里的文件顺序就是播放顺序（编辑时可上移 / 下移）；只能选「系统媒体」文件，最多 1024 个。加入任务时用 FFxx 引用整个列表，而不是把文件逐个列进任务。"
      />

      <el-table
        v-loading="loading"
        class="playlists__table"
        :data="filteredPlaylists"
        row-key="PlayListID"
        stripe
      >
        <el-table-column label="播放列表 ID" width="200">
          <template #default="{ row }">
            <div>
              <span class="playlists__mono">{{ row.PlayListID }}</span>
              <el-button link type="primary" size="small" @click="copyText(row.PlayListID)">复制</el-button>
            </div>
            <div v-if="toTaskFileListRef(row.PlayListID)" class="playlists__sub">
              任务用：{{ toTaskFileListRef(row.PlayListID) }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="名称" min-width="160">
          <template #default="{ row }">
            <span v-if="row.PlayListName">{{ row.PlayListName }}</span>
            <span v-else class="playlists__muted">（名称为空）</span>
          </template>
        </el-table-column>

        <el-table-column label="文件数" width="120">
          <template #default="{ row }">
            <span>{{ playListFileCount(row) }}</span>
            <el-tag
              v-if="refCountOf(row)"
              class="playlists__tag"
              type="warning"
              size="small"
              effect="plain"
            >
              {{ refCountOf(row) }} 个 FFxx
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="文件预览（按播放顺序）" min-width="300">
          <template #default="{ row }">
            <template v-if="playListFileCount(row)">
              <el-tag
                v-for="(name, index) in filePreview(row)"
                :key="`${row.PlayListID}-${index}`"
                class="playlists__file"
                size="small"
                effect="plain"
                disable-transitions
              >
                {{ name }}
              </el-tag>
              <span v-if="playListFileCount(row) > 3" class="playlists__muted">
                等 {{ playListFileCount(row) }} 个
              </span>
            </template>
            <span v-else class="playlists__muted">空列表</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button link size="small" @click="openViewDialog(row)">查看</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的播放列表' : '暂无播放列表'">
            <p v-if="!keyword" class="playlists__empty-hint">
              播放列表把多个系统媒体文件按顺序打包成一个播放目标：先在「媒体文件」页签准备系统媒体文件，
              再回来新建列表并排好顺序；加入任务时用 FFxx 引用它。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <PlayListFormDialog
      v-model="formVisible"
      :play-list="editingPlayList"
      :files="systemFiles"
      :submitting="submitting"
      @confirm="handleFormConfirm"
    />

    <PlayListViewDialog v-model="viewVisible" :play-list="viewTarget" :files="systemFiles" />
  </div>
</template>

<style scoped>
.playlists__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.playlists__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.playlists__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.playlists__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.playlists__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.playlists__search {
  width: 220px;
}

.playlists__interval {
  width: 130px;
}

.playlists__hint {
  margin-bottom: 12px;
}

.playlists__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.playlists__sub {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.playlists__tag {
  margin-left: 6px;
}

.playlists__file {
  margin-right: 6px;
}

.playlists__muted {
  color: var(--el-text-color-placeholder);
}

.playlists__empty-hint {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>
