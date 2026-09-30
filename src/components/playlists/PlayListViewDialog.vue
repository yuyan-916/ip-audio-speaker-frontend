<script setup>
// src/components/playlists/PlayListViewDialog.vue —— 查看某个播放列表的文件列表（只读）
//
// 文件 ID 是「系统媒体文件 ID」，因此拿媒体文件页签的系统媒体列表来补全文件名与时长；
// 列表里查不到的条目**不隐藏**，而是标注出来——那通常意味着文件已被删除，
// 但播放列表里的引用仍然留着（NAS 不会自动清理；播放时会直接跳过）。
//
// 另外单独标出 `FFxx` 形态的条目：NAS 会把 4 位 ID 是 FFxx 的元素当成「引用播放列表 xx」，
// 而不是文件本身（手册 §十四 4），这类条目往往是早期手工构造数据留下的。

import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { formatPlayTime } from '@/constants/media'
import { countPlayListRefs, describePlayListFile, toTaskFileListRef } from '@/constants/playlist'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 要查看的播放列表（NAS 原始字段） */
  playList: { type: Object, default: null },
  /** 系统媒体文件列表，用于补全文件名 / 时长 */
  files: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const rows = computed(() => {
  const list = props.playList && Array.isArray(props.playList.FileList) ? props.playList.FileList : []
  return list.map((id, index) => ({ index, ...describePlayListFile(id, props.files) }))
})

const playListId = computed(() => String((props.playList && props.playList.PlayListID) || ''))
/** 该列表放进任务 FileList 时要用的 4 位引用（FFxx） */
const taskRef = computed(() => toTaskFileListRef(playListId.value))
const refCount = computed(() => countPlayListRefs(props.playList))
const missingCount = computed(() => rows.value.filter((row) => !row.known && !row.suspicious).length)

/** 已知文件的总时长（秒）；没有可累计的条目时返回 null */
const totalSeconds = computed(() => {
  const known = rows.value.filter((row) => row.known)
  if (!known.length) return null
  return known.reduce((sum, row) => {
    const value = Number(row.playTime)
    return sum + (Number.isFinite(value) && value > 0 ? value : 0)
  }, 0)
})

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
  <el-dialog v-model="visible" title="播放列表内容" width="780px">
    <el-alert
      class="playlist-view__alert"
      type="info"
      :closable="false"
      show-icon
      :title="`「${(playList && playList.PlayListName) || '未命名列表'}」 · 共 ${rows.length} 个文件`"
      :description="
        taskRef
          ? `播放列表 ID ${playListId}；加入任务的 FileList 时要写成 ${taskRef}（4 位 FFxx 表示引用这个列表）。文件按下面的顺序播放。`
          : '该播放列表没有可用的列表 ID。'
      "
    />

    <p v-if="totalSeconds !== null" class="playlist-view__tip">
      已知文件总时长约 {{ formatPlayTime(totalSeconds) }}（未包含已从媒体列表消失的文件）。
    </p>

    <el-table class="playlist-view__table" :data="rows" stripe row-key="index">
      <el-table-column label="#" width="60">
        <template #default="{ row }">{{ row.index + 1 }}</template>
      </el-table-column>

      <el-table-column label="FileID" width="160">
        <template #default="{ row }">
          <span class="playlist-view__mono">{{ row.fileId || '-' }}</span>
          <el-button v-if="row.fileId" link type="primary" size="small" @click="copyText(row.fileId)">
            复制
          </el-button>
        </template>
      </el-table-column>

      <el-table-column label="文件名" min-width="200">
        <template #default="{ row }">
          <span v-if="row.fileName">{{ row.fileName }}</span>
          <span v-else class="playlist-view__muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="时长" width="100">
        <template #default="{ row }">{{ formatPlayTime(row.playTime) }}</template>
      </el-table-column>

      <el-table-column label="备注" min-width="200">
        <template #default="{ row }">
          <span v-if="row.suspicious" class="playlist-view__warn">
            形如 FFxx：NAS 会当成「引用播放列表」而不是文件
          </span>
          <span v-else-if="!row.valid" class="playlist-view__warn">
            ID 不是 4 位十六进制（数据异常，NAS 会忽略或报错）
          </span>
          <span v-else-if="!row.known" class="playlist-view__warn">
            不在系统媒体列表里（文件可能已被删除）
          </span>
          <span v-else class="playlist-view__muted">-</span>
        </template>
      </el-table-column>

      <template #empty>
        <div class="playlist-view__empty">
          <p>
            这是一个<b>空列表</b>：NAS 仍会保留它，但加入任务后不会有任何声音。要添加文件请用列表页的「编辑」。
          </p>
        </div>
      </template>
    </el-table>

    <p v-if="refCount" class="playlist-view__warn playlist-view__footnote">
      有 {{ refCount }} 个条目的 ID 形如 FFxx：按手册语义 NAS 会把它当作「引用播放列表」而非文件，请核对。
    </p>
    <p v-if="missingCount" class="playlist-view__footnote playlist-view__muted">
      有 {{ missingCount }} 个文件不在当前系统媒体列表里：可能已被删除，播放时会直接跳过（NAS 不会自动清理引用）。
    </p>

    <p class="playlist-view__footnote playlist-view__muted">
      播放列表只能引用<b>系统媒体</b>文件；列表顺序就是播放顺序。要增删 / 调序请用列表页的「编辑」。
    </p>

    <template #footer>
      <el-button v-if="taskRef" @click="copyText(taskRef)">复制任务用 ID（{{ taskRef }}）</el-button>
      <el-button type="primary" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.playlist-view__alert {
  margin-bottom: 12px;
}

.playlist-view__table {
  width: 100%;
}

.playlist-view__mono {
  margin-right: 8px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
}

.playlist-view__muted {
  color: var(--el-text-color-secondary);
}

.playlist-view__warn {
  font-size: 12px;
  color: var(--el-color-warning);
}

.playlist-view__empty p {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.playlist-view__tip {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.playlist-view__footnote {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
}
</style>
