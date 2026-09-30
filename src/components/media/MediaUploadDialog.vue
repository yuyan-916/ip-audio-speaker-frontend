<script setup>
// src/components/media/MediaUploadDialog.vue —— 上传媒体文件
//
// 为什么这个弹窗自己拿 store（其他模块的弹窗都是纯展示组件、靠 props/emit）：
//   上传是**长流程**——文件队列、串行链、每个文件的进度与逐项结果、结束后的列表刷新，
//   这些状态放在弹窗内部最自然，页面只管开关。
//
// ⚠️ 四条必须落地的口径（都来自后端 docs/API.md「媒体文件模块」）：
//   1) **串行**：el-upload 会对同一批选中的文件**并发**调用 http-request，而 NAS 的上传是会话式的
//      （上一次 Open 没 Close 之前再 Open 会拿到 Result=8），所以这里把请求挂到一条 Promise 链上，
//      同一时刻只有一个文件在上传。代价就是「批量上传非原子」：前面的文件已经真的写进 NAS 了。
//   2) **超时**：全局 axios 只有 15s，这里由 api/media.js 按文件大小估算（uploadTimeoutMs）。
//   3) **失败要能分清来源**：结果表用 status 区分「NAS 拒绝（nas）」「前端没发出（local）」
//      「HTTP 层失败（http）」，见 constants/media.js 的 createUploadFailureResult。
//   4) **批量上限自己数**：不能用 el-upload 的 `:limit`（它判的是**队列总长度**，会把上一批已成功的
//      文件也算进去；`on-exceed` 也只在设了 `limit` 时才会触发），更不能读 `uploadRef.value.uploadFiles`
//      （ElUpload 只 expose 了 abort / submit / clearFiles / handleStart / handleRemove，没有它，
//      读了会抛 TypeError，而且会被 element-plus 的 before-upload try/catch 静默吞掉——
//      文件被移出队列、不发请求、不报错，极难排查）——见 handleBeforeUpload。
//
// ⚠️ 分控软件媒体**不支持上传**（NAS 没有该接口），所以类型单选里只有系统 / 报警媒体。
//
// ⚠️ 已知限制：上传中的文件如果用户从 el-upload 的队列里点「删除」，element-plus 的 abort 对自定义
//    http-request（返回 Promise，而不是 XHR 实例）无效 —— 请求会继续跑完，**以「上传结果表」为准**。

import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  MEDIA_FILE_NAME_MAX_CHARS,
  MEDIA_UPLOAD_BATCH_LIMIT,
  MEDIA_UPLOAD_CHUNK_MB,
  MEDIA_UPLOAD_MAX_MB,
  UPLOAD_MEDIA_TYPES,
  describeUploadGuardProblem,
  describeUploadResultStatus,
  formatFileSize,
  formatPlayTime
} from '@/constants/media'
import { useMediaStore } from '@/stores/media'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 打开时默认选中的媒体类型（页面当前页签：system / alarm） */
  mediaType: { type: String, default: 'system' }
})

const emit = defineEmits(['update:modelValue'])

const mediaStore = useMediaStore()
const uploadRef = ref(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 本次上传的目标类型（弹窗内可改；分控媒体不可上传，所以只可能是 system / alarm） */
const selectedType = ref('system')
/** 串行链的尾巴：每个 http-request 依次挂到它后面 */
let uploadChain = Promise.resolve()
/**
 * 还没结束的文件数（含已入队、还没轮到 http-request 的）：
 *   · 算 loading，也用来判断「这一批传完了」（见 runUpload 的 finally）；
 *   · 还用它守批量上限——由 handleBeforeUpload 在**放行**时占额度、runUpload 结束时归还。
 */
const pendingCount = ref(0)
const uploading = computed(() => pendingCount.value > 0)

const results = computed(() => mediaStore.uploadResults)
const successCount = computed(() => results.value.filter((item) => item.status === 'success').length)
const failureCount = computed(() => results.value.length - successCount.value)

// 每次打开：把类型重置为页面当前页签，并清空上一批的结果（否则结果会串批）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    selectedType.value = UPLOAD_MEDIA_TYPES.some((item) => item.key === props.mediaType)
      ? props.mediaType
      : UPLOAD_MEDIA_TYPES[0].key
    mediaStore.startUploadBatch()
  }
)

/** 上传中不许关弹窗：关了请求还在跑，用户会以为已经取消 */
function handleBeforeClose(done) {
  if (uploading.value) {
    ElMessage.warning('还有文件正在上传，请等这一批结束再关闭')
    return
  }
  done()
}

/**
 * 选好文件后的本地校验。返回 false 会阻止该文件上传（element-plus 会把该文件移出队列，
 * 所以这里必须**先**在结果表里记一行，否则结果表里看不到它，用户会以为上传成功了）。
 *
 * ⚠️ 批量上限（MEDIA_UPLOAD_BATCH_LIMIT）必须**自己数**，两条路都走不通：
 *    · el-upload 的 `:limit` 判的是「`fileList.length + files.length > limit`」（队列**总长度**，
 *      含上一批已成功的文件）——上一批传了 20 个之后，再选 1 个都会被整批拒掉，
 *      与本弹窗「一次最多选 20 个」的语义不符（想放行就得让用户先「清空列表」）；
 *    · 也读不到队列：`uploadRef.value.uploadFiles` 未 expose（见文件头 4)），读了直接抛 TypeError，
 *      而且异常会被 element-plus 的 before-upload try/catch 吞掉，表现为「选完文件毫无反应」。
 *    所以这里数「还没结束的文件数」（pendingCount：本函数放行时自增、runUpload 结束时自减）：
 *    队列空闲时就是「一次最多 20 个」；上一批还没传完时再选，只放行剩余额度，
 *    避免把 NAS 那条串行链堆得过长。
 */
function handleBeforeUpload(file) {
  if (pendingCount.value >= MEDIA_UPLOAD_BATCH_LIMIT) {
    const reason = `一次最多 ${MEDIA_UPLOAD_BATCH_LIMIT} 个文件（NAS 上传是串行的，请等这一批传完再选下一批）`
    mediaStore.rejectUpload(file, reason)
    ElMessage.error(`「${file.name}」未上传：${reason}`)
    return false
  }

  const problem = describeUploadGuardProblem(file)
  if (problem) {
    mediaStore.rejectUpload(file, problem)
    ElMessage.error(`「${file.name}」未上传：${problem}`)
    return false
  }

  // 通过校验的这一刻就占住一个额度，直到这个文件上传结束（runUpload 的 finally 里归还）
  pendingCount.value += 1
  return true
}

/**
 * 自定义上传（el-upload 的 http-request）。
 *
 * el-upload 会对同一批文件**并发**调用本函数，而 NAS 的上传是会话式的（同一时刻只能有一个 Open），
 * 所以这里把每个文件挂到串行链 `uploadChain` 上；前一个文件失败也不能挡住后面的
 * （所以 then 的两个分支都接同一个任务）。
 *
 * ⚠️ 返回 Promise 就够了，**不要**手动再调 option.onSuccess / option.onError：
 *    element-plus 在 http-request 返回 Promise 时会自己 `then(onSuccess, onError)`，
 *    手动再调一次会把失败的文件二次标成成功。
 */
function handleHttpRequest(option) {
  // 额度已经在 handleBeforeUpload 里占住了（pendingCount 的口径是「还没结束的文件」），这里不再自增

  const task = uploadChain.then(
    () => runUpload(option),
    () => runUpload(option)
  )
  // 链上的失败已经被 runUpload 记进结果表，这里只保证链本身不断
  uploadChain = task.then(
    () => {},
    () => {}
  )
  return task
}

/** 真正上传一个文件；失败时抛出（让 el-upload 把该文件标成失败） */
async function runUpload(option) {
  try {
    return await mediaStore.uploadOne(selectedType.value, option.file, {
      onProgress: (percent) => option.onProgress({ percent })
    })
  } finally {
    pendingCount.value -= 1
    if (pendingCount.value === 0) {
      // 一批传完：统一刷新列表 + 汇总提示（失败也不影响已上传的文件，所以自己吞掉异常）
      await handleBatchFinished()
    }
  }
}

/** 一批结束后的收尾：汇总提示 + 刷新列表（列表只刷一次，避免 N 个文件刷 N 遍） */
async function handleBatchFinished() {
  const okCount = successCount.value
  const failCount = failureCount.value

  if (failCount === 0 && okCount > 0) {
    ElMessage.success(`上传完成：${okCount} 个文件全部成功，NAS 已分配文件 ID`)
  } else if (okCount + failCount > 0) {
    ElMessage.warning(
      `本批结束：成功 ${okCount} 个、失败 ${failCount} 个。⚠️ 上传不是原子操作——成功的文件已经写入 NAS，失败的不会回滚（详见弹窗里的结果表）`
    )
  }

  if (okCount + failCount === 0) return
  try {
    await mediaStore.fetchList(selectedType.value, { silent: true })
  } catch {
    // HTTP 层错误拦截器已提示；刷新失败不影响已经上传成功的文件
  }
}

/** 清空结果表（下一批从零开始） */
function handleClearResults() {
  mediaStore.startUploadBatch()
}

/** 清空 el-upload 的文件队列与结果表（一批做完后想重新开始时用） */
function handleReset() {
  if (uploading.value) return
  if (uploadRef.value) uploadRef.value.clearFiles()
  mediaStore.startUploadBatch()
}

</script>

<template>
  <el-dialog
    v-model="visible"
    title="上传媒体文件"
    width="760px"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
  >
    <el-alert
      class="media-upload__alert"
      type="warning"
      :closable="false"
      show-icon
      title="多个文件不是「要么全成功要么全失败」"
      description="选中的文件会按顺序逐个上传（NAS 的上传是会话式的，同一时刻只能有一个），因此前几个文件可能已经真的写入 NAS；某一个失败不会回滚已成功的文件。失败原因分三类：NAS 拒绝 / 未发出 / 请求失败，见下方结果表。"
    />

    <el-form label-position="top" class="media-upload__form">
      <el-form-item label="上传到">
        <el-radio-group v-model="selectedType" :disabled="uploading">
          <el-radio-button v-for="item in UPLOAD_MEDIA_TYPES" :key="item.key" :value="item.key">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
        <p class="media-upload__tip">
          只有系统媒体与报警媒体可以上传（NAS 没有提供上传到分控软件媒体的接口）。
          ⚠️ 两类媒体的 FileID 取值范围重叠，传错类型会出现在另一类列表里。
        </p>
      </el-form-item>
    </el-form>

    <el-upload
      ref="uploadRef"
      class="media-upload__drop"
      drag
      multiple
      action="#"
      accept="audio/*"
      :http-request="handleHttpRequest"
      :before-upload="handleBeforeUpload"
      :disabled="uploading"
    >
      <div class="media-upload__drop-text">
        把音频文件拖到这里，或<em>点击选择</em>（可多选）
      </div>
      <template #tip>
        <div class="media-upload__tip">
          单个文件 ≤ {{ MEDIA_UPLOAD_MAX_MB }}MB，文件名 ≤ {{ MEDIA_FILE_NAME_MAX_CHARS }} 个字符，
          一次最多 {{ MEDIA_UPLOAD_BATCH_LIMIT }} 个（要等这一批传完再选下一批）；后端会自动按
          {{ MEDIA_UPLOAD_CHUNK_MB }}MB 分块上传，前端不做切片。
        </div>
      </template>
    </el-upload>

    <div class="media-upload__results">
      <div class="media-upload__results-head">
        <span class="media-upload__results-title">上传结果</span>
        <span v-if="results.length" class="media-upload__count">
          共 {{ results.length }} 个：成功 {{ successCount }}、失败 {{ failureCount }}
        </span>
        <span v-else class="media-upload__count">还没有上传记录</span>
        <el-button
          link
          type="primary"
          :disabled="uploading || !results.length"
          @click="handleClearResults"
        >
          清空结果
        </el-button>
      </div>

      <el-table
        :data="results"
        size="small"
        max-height="240"
        stripe
        empty-text="上传结果会逐个显示在这里"
      >
        <el-table-column prop="fileName" label="文件名" min-width="200" show-overflow-tooltip />

        <el-table-column label="本地大小" width="100">
          <template #default="{ row }">{{ formatFileSize(row.localSize) }}</template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag
              :type="describeUploadResultStatus(row.status).tag"
              size="small"
              effect="plain"
              disable-transitions
            >
              {{ describeUploadResultStatus(row.status).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="FileID" width="90">
          <template #default="{ row }">
            <span v-if="row.fileId" class="media-upload__mono">{{ row.fileId }}</span>
            <span v-else class="media-upload__muted">-</span>
          </template>
        </el-table-column>

        <el-table-column label="时长" width="80">
          <template #default="{ row }">{{ formatPlayTime(row.playTime) }}</template>
        </el-table-column>

        <el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip />
      </el-table>
    </div>

    <template #footer>
      <el-button :disabled="uploading" @click="handleReset">清空列表与结果</el-button>
      <el-button type="primary" :disabled="uploading" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.media-upload__alert {
  margin-bottom: 16px;
}

.media-upload__form {
  margin-bottom: 4px;
}

.media-upload__tip {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.media-upload__drop {
  margin-bottom: 16px;
}

.media-upload__drop-text {
  padding: 28px 0;
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.media-upload__drop-text em {
  color: var(--el-color-primary);
  font-style: normal;
}

.media-upload__results-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.media-upload__results-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.media-upload__count {
  flex: 1;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.media-upload__mono {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.media-upload__muted {
  color: var(--el-text-color-placeholder);
}
</style>

