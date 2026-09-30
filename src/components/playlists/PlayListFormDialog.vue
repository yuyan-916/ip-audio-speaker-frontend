<script setup>
// src/components/playlists/PlayListFormDialog.vue —— 新建 / 编辑播放列表（两者共用）
//
// ⚠️ 四条 NAS 语义必须在这里体现（后端 docs/impl-notes.md §十四 3 / §十四 4）：
//   1) **FileList 有序**：数组顺序就是播放顺序，所以右侧是「有序列表 + 上移 / 下移 / 移除」，
//      不能像分组那样只做多选（多选控件里用户没法表达顺序）；
//   2) 编辑时**缺省 FileList 等于把文件列表清空**，所以本弹窗总是提交完整的有序数组（要清空就发 []）；
//   3) 只能选**系统媒体文件**：候选只来自媒体文件页签的「系统媒体」列表，报警 / 分控媒体的文件不出现；
//   4) `FFxx` 不是文件：形如 FFxx 的系统媒体 ID 若放进 FileList，NAS 会把它当成「引用播放列表 xx」，
//      所以这类候选在前端直接禁用（looksLikePlayListRef）。
//
// 名称上限 31 个**字符**（与分组名同口径，不是设备名的 31 个 GBK 字节）；文件数上限 1024。

import { computed, ref, watch } from 'vue'
import { formatPlayTime } from '@/constants/media'
import {
  PLAYLIST_MAX_FILES,
  PLAYLIST_NAME_MAX_CHARS,
  describePlayListFile,
  isPlayListNameTooLong,
  looksLikePlayListRef
} from '@/constants/playlist'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 待编辑的播放列表；null 表示新建 */
  playList: { type: Object, default: null },
  /** 可选的系统媒体文件（`media` store 的 system 列表，NAS 原始字段） */
  files: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isEdit = computed(() => Boolean(props.playList))
const playListName = ref('')
/** 已选文件 ID（**顺序敏感**：数组顺序就是播放顺序） */
const selectedIds = ref([])
const keyword = ref('')

// 每次打开时按当前播放列表重置表单（避免上次编辑的内容残留）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    playListName.value = props.playList ? String(props.playList.PlayListName || '') : ''
    selectedIds.value =
      props.playList && Array.isArray(props.playList.FileList)
        ? props.playList.FileList.map((id) => String(id == null ? '' : id).trim().toUpperCase())
        : []
    keyword.value = ''
  }
)

/** 候选文件：系统媒体列表 → 展示行（带时长与「FFxx 不可选」标记） */
const options = computed(() =>
  props.files.map((item) => {
    const id = String(item.FileID == null ? '' : item.FileID).trim().toUpperCase()
    return {
      value: id,
      fileName: String(item.FileName || ''),
      playTime: item.PlayTime,
      // FFxx 会被 NAS 当成「引用播放列表 xx」，不能作为文件加入
      refLike: looksLikePlayListRef(id)
    }
  })
)

const selectedSet = computed(() => new Set(selectedIds.value))
/** 还没被选中的候选（含被禁用的 FFxx 项，只是不能点） */
const availableOptions = computed(() =>
  options.value.filter((item) => !selectedSet.value.has(item.value))
)
/** 命中搜索关键字的候选（文件名 / 文件 ID 任一命中） */
const filteredOptions = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return availableOptions.value
  return availableOptions.value.filter((item) =>
    [item.value, item.fileName].some((field) =>
      String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})
/** 当前可一键添加的候选（搜索命中的、非 FFxx 的） */
const addableOptions = computed(() => filteredOptions.value.filter((item) => !item.refLike))
/** 被挡在候选之外的 FFxx 媒体文件数量（提示用） */
const refLikeOptionCount = computed(() => options.value.filter((item) => item.refLike).length)

/** 已选文件展开成展示行（带序号，序号就是播放顺序） */
const selectedRows = computed(() =>
  selectedIds.value.map((id, index) => ({ index, ...describePlayListFile(id, props.files) }))
)
/** 已选里不在系统媒体列表里的文件（可能已被删除）：保存时会原样保留，这里明确提示 */
const unknownRows = computed(() => selectedRows.value.filter((row) => !row.known && !row.suspicious))
/** 已选里形如 FFxx 的条目（历史数据可能带进来）：NAS 会当成播放列表引用 */
const suspiciousRows = computed(() => selectedRows.value.filter((row) => row.suspicious))

const trimmedName = computed(() => playListName.value.trim())
const nameTooLong = computed(() => isPlayListNameTooLong(trimmedName.value))
const fileCount = computed(() => selectedIds.value.length)
const tooManyFiles = computed(() => fileCount.value > PLAYLIST_MAX_FILES)

const errorText = computed(() => {
  if (!trimmedName.value) {
    return '请填写播放列表名称（留空会让 NAS 用默认名 New Play List，列表里会出现同名条目而分不清）'
  }
  if (nameTooLong.value) {
    return `播放列表名不能超过 ${PLAYLIST_NAME_MAX_CHARS} 个字符（注意：是字符，不是字节）`
  }
  if (tooManyFiles.value) {
    return `一个播放列表最多 ${PLAYLIST_MAX_FILES} 个文件（当前 ${fileCount.value} 个）`
  }
  return ''
})
const canSubmit = computed(() => !errorText.value)

function addFile(fileId) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  if (!id || selectedSet.value.has(id) || looksLikePlayListRef(id)) return
  if (selectedIds.value.length >= PLAYLIST_MAX_FILES) return
  // 追加到末尾：新加的文件排在最后（顺序即播放顺序）
  selectedIds.value = [...selectedIds.value, id]
}

function addAllVisible() {
  const merged = [...selectedIds.value]
  addableOptions.value.forEach((item) => {
    if (merged.length >= PLAYLIST_MAX_FILES) return
    if (!merged.includes(item.value)) merged.push(item.value)
  })
  selectedIds.value = merged
}

function removeAt(index) {
  selectedIds.value = selectedIds.value.filter((_, current) => current !== index)
}

function moveUp(index) {
  if (index <= 0) return
  const next = [...selectedIds.value]
  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
  selectedIds.value = next
}

function moveDown(index) {
  if (index >= selectedIds.value.length - 1) return
  const next = [...selectedIds.value]
  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
  selectedIds.value = next
}

function clearAll() {
  selectedIds.value = []
}

function handleConfirm() {
  if (!canSubmit.value) return
  // 始终提交完整有序的文件列表：NAS 的「缺省 = 清空」语义要求这样，store 也会再兜一层
  emit('confirm', { playListName: trimmedName.value, fileList: selectedIds.value.slice() })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑播放列表' : '新建播放列表'"
    width="900px"
    :close-on-click-modal="false"
    append-to-body
  >
    <el-alert
      class="playlist-form__alert"
      type="info"
      :closable="false"
      show-icon
      title="文件列表是有序的：右侧的顺序就是播放顺序"
      description="播放列表按 4 位 FileID 引用「系统媒体」文件（最多 1024 个）。保存时会整体覆盖原来的文件列表——清空即表示列表里不再有文件。"
    />

    <el-form label-width="96px" @submit.prevent="handleConfirm">
      <el-form-item label="列表名称">
        <el-input v-model="playListName" placeholder="例如 课件铃声播放" clearable />
      </el-form-item>

      <el-form-item :label="`文件列表（已选 ${fileCount} / ${PLAYLIST_MAX_FILES}）`">
        <div class="playlist-form__picker">
          <!-- 左：系统媒体候选 -->
          <div class="playlist-form__panel">
            <div class="playlist-form__panel-head">
              <span class="playlist-form__panel-title">系统媒体文件</span>
              <el-button
                link
                type="primary"
                size="small"
                :disabled="!addableOptions.length"
                @click="addAllVisible"
              >
                全部添加
              </el-button>
            </div>
            <el-input
              v-model="keyword"
              class="playlist-form__search"
              size="small"
              placeholder="按文件名 / FileID 过滤"
              clearable
            />
            <div class="playlist-form__list">
              <div v-for="item in filteredOptions" :key="item.value" class="playlist-form__row">
                <span class="playlist-form__mono">{{ item.value }}</span>
                <span class="playlist-form__name" :title="item.fileName">
                  {{ item.fileName || '（无文件名）' }}
                </span>
                <span class="playlist-form__time">{{ formatPlayTime(item.playTime) }}</span>
                <el-tag v-if="item.refLike" type="warning" size="small" effect="plain">FFxx 不可选</el-tag>
                <el-button v-else link type="primary" size="small" @click="addFile(item.value)">添加</el-button>
              </div>
              <p v-if="!filteredOptions.length" class="playlist-form__empty">
                {{ keyword ? '没有匹配的文件' : '没有可添加的文件（候选已经全部在右侧）' }}
              </p>
            </div>
          </div>

          <!-- 右：已选（有序） -->
          <div class="playlist-form__panel">
            <div class="playlist-form__panel-head">
              <span class="playlist-form__panel-title">播放顺序</span>
              <el-button link size="small" :disabled="!fileCount" @click="clearAll">清空</el-button>
            </div>
            <div class="playlist-form__list">
              <div v-for="row in selectedRows" :key="`${row.index}-${row.fileId}`" class="playlist-form__row">
                <span class="playlist-form__index">{{ row.index + 1 }}</span>
                <span class="playlist-form__mono">{{ row.fileId }}</span>
                <span class="playlist-form__name" :title="row.fileName">
                  {{
                    row.fileName ||
                    (row.suspicious ? '（FFxx：会被当成播放列表引用）' : '（已不在系统媒体列表里）')
                  }}
                </span>
                <span class="playlist-form__time">{{ formatPlayTime(row.playTime) }}</span>
                <span class="playlist-form__actions">
                  <el-button link size="small" :disabled="row.index === 0" @click="moveUp(row.index)">
                    上移
                  </el-button>
                  <el-button
                    link
                    size="small"
                    :disabled="row.index === selectedRows.length - 1"
                    @click="moveDown(row.index)"
                  >
                    下移
                  </el-button>
                  <el-button link type="danger" size="small" @click="removeAt(row.index)">移除</el-button>
                </span>
              </div>
              <p v-if="!fileCount" class="playlist-form__empty">
                还没有选择文件：空列表可以保存（NAS 允许），但加入任务后不会有任何声音。
              </p>
            </div>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <p class="playlist-form__counter" :class="{ 'playlist-form__counter--error': nameTooLong }">
      列表名字符数：{{ trimmedName.length }} / {{ PLAYLIST_NAME_MAX_CHARS }}
    </p>

    <p class="playlist-form__tip">
      文件列表上限 1024 个，且顺序就是播放顺序；只能引用<b>系统媒体</b>文件（报警媒体 / 分控媒体的文件不会出现在候选里）。
      编辑保存会整体覆盖原文件列表，清空即表示列表里不再有文件。
    </p>

    <p v-if="!files.length" class="playlist-form__warn">
      系统媒体列表为空（可能尚未加载完成或拉取失败）：可以先保存空列表，稍后在「媒体文件」页签刷新，再回来编辑。
    </p>

    <p v-if="refLikeOptionCount" class="playlist-form__warn">
      有 {{ refLikeOptionCount }} 个系统媒体文件的 ID 形如 FFxx，已禁止加入：4 位 ID 是 FFxx 时会被 NAS
      当成「引用播放列表 xx」而不是文件本身。
    </p>

    <p v-if="suspiciousRows.length" class="playlist-form__warn">
      已有 {{ suspiciousRows.length }} 个条目的 ID 形如 FFxx（{{
        suspiciousRows.map((row) => row.fileId).join('、')
      }}）：NAS 会把它当成「引用播放列表」而不是文件，请确认是否保留（不想要就点「移除」）。
    </p>

    <p v-if="unknownRows.length" class="playlist-form__warn">
      有 {{ unknownRows.length }} 个文件不在当前系统媒体列表里（{{
        unknownRows.map((row) => row.fileId).join('、')
      }}），保存时会原样保留——它们可能已被删除，播放时会直接跳过。
    </p>

    <p v-if="errorText" class="playlist-form__error">{{ errorText }}</p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.playlist-form__alert {
  margin-bottom: 16px;
}

.playlist-form__picker {
  display: flex;
  gap: 12px;
  width: 100%;
}

.playlist-form__panel {
  flex: 1 1 0;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.playlist-form__panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.playlist-form__panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.playlist-form__search {
  margin-bottom: 6px;
}

.playlist-form__list {
  height: 300px;
  overflow-y: auto;
}

.playlist-form__row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  font-size: 12px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}

.playlist-form__index {
  flex: 0 0 22px;
  color: var(--el-text-color-placeholder);
}

.playlist-form__mono {
  flex: 0 0 auto;
  font-family: Consolas, Monaco, 'Courier New', monospace;
}

.playlist-form__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.playlist-form__time {
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
}

.playlist-form__actions {
  flex: 0 0 auto;
  white-space: nowrap;
}

.playlist-form__empty {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.playlist-form__counter {
  margin: -8px 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.playlist-form__counter--error {
  color: var(--el-color-danger);
}

.playlist-form__tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.playlist-form__warn {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.playlist-form__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
