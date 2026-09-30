<script setup>
// src/components/media/MediaDeleteDialog.vue —— 删除媒体文件
//
// 纯展示组件（与 devices / groups 的弹窗一致）：确认后 emit('confirm')，请求由页面的 runWrite 发。
//
// ⚠️ 删除有两个 NAS 约束，必须在用户点「删除」之前就摆出来：
//   1) **文件名必须与列表里的原名一致**：NAS 用 FileID + FileName 一起确认目标，名字对不上返回 Result=8，
//      所以这里只展示、不允许修改；
//   2) **系统媒体与报警媒体的 FileID 取值范围重叠**：同一个 ID 在两类里对应不同文件，
//      所以弹窗里把「正在删除哪一类」写在最显眼的位置，避免删错类型。
// 另外：文件正在被任务 / 播放列表使用时，NAS 可能返回 Result=7（删除失败），弹窗里也提示一下。

import { computed } from 'vue'
import { findMediaType, formatPlayTime, isValidFileId } from '@/constants/media'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 待删除的文件行（NAS 原始字段：FileID / FileName / PlayTime） */
  file: { type: Object, default: null },
  /** 当前媒体类型 key：system / alarm（决定删除走哪条后端路径） */
  mediaType: { type: String, default: 'system' },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const fileId = computed(() =>
  String((props.file && props.file.FileID) || '').trim().toUpperCase()
)
const fileName = computed(() => String((props.file && props.file.FileName) || ''))
const typeLabel = computed(() => findMediaType(props.mediaType).label)

/**
 * 兜底校验：`FileID` 必须是 4 位十六进制、文件名不能为空。
 * 列表接口正常情况下不会给出别的值，但删除的目标是**由 ID + 名字共同确认**的，
 * 万一数据脏了，宁可不发请求也不要误删另一类的同名文件。
 */
const canConfirm = computed(() => isValidFileId(fileId.value) && Boolean(fileName.value))

function handleConfirm() {
  if (!canConfirm.value) return
  emit('confirm')
}
</script>

<template>
  <el-dialog v-model="visible" title="删除媒体文件" width="560px" :close-on-click-modal="false">
    <el-alert
      class="media-delete__alert"
      type="warning"
      :closable="false"
      show-icon
      :title="`即将从「${typeLabel}」中删除`"
      description="系统媒体与报警媒体的 FileID 取值范围重叠，同一个 ID 在两类里是两个不同文件；删除只作用于当前这一类，请确认类型没错。"
    />

    <el-descriptions :column="1" border size="small">
      <el-descriptions-item label="媒体类型">{{ typeLabel }}</el-descriptions-item>
      <el-descriptions-item label="文件 ID">
        <span class="media-delete__mono">{{ fileId || '-' }}</span>
      </el-descriptions-item>
      <el-descriptions-item label="文件名">{{ fileName || '-' }}</el-descriptions-item>
      <el-descriptions-item label="播放时长">
        {{ formatPlayTime(file && file.PlayTime) }}
      </el-descriptions-item>
    </el-descriptions>

    <p class="media-delete__tip">
      删除请求会带上这里的 <em>文件 ID + 文件名</em>（NAS 用两者一起确认目标，名字不一致会被拒），
      因此文件名不允许修改。
    </p>
    <p class="media-delete__tip">
      ⚠️ 该文件正在被任务 / 播放列表引用时，NAS 可能拒绝删除（Result=7）；即使删除成功，
      播放列表里对它的引用也会失效，需要重新编辑列表。
    </p>

    <p v-if="!canConfirm" class="media-delete__tip media-delete__tip--danger">
      ⚠️ 这一行的文件 ID 不是 4 位十六进制（或文件名为空），无法删除；请刷新列表后重试。
    </p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="danger" :loading="submitting" :disabled="!canConfirm" @click="handleConfirm">
        删除
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.media-delete__alert {
  margin-bottom: 16px;
}

.media-delete__mono {
  font-family: Consolas, Monaco, 'Courier New', monospace;
}

.media-delete__tip {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.media-delete__tip em {
  color: var(--el-color-danger);
  font-style: normal;
}

.media-delete__tip--danger {
  color: var(--el-color-danger);
}
</style>
