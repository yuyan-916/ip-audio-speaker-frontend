// src/constants/media.js —— 媒体文件模块的枚举字典与纯函数
//
// 取值来源：后端 docs/API.md「媒体文件模块」与 docs/impl-notes.md §十四 2 / §十四 4（NAS 手册 P23-25、P30）。
// 响应字段是 NAS 风格大驼峰（FileID / FileName / PlayTime；**只有分控列表**额外带 DeviceID）。
//
// ⚠️ 三处「长度」口径互不相同，别互相套用：
//   · 媒体文件名 —— 255 个**字符**（本文件 MEDIA_FILE_NAME_MAX_CHARS，后端 UploadableFileValidator）
//   · 分组名 / 播放列表名 —— 31 个**字符**（constants/group.js）
//   · 设备名 —— 31 个 **GBK 字节**（constants/device.js）

/** 媒体文件名上限：255 个**字符**（NAS 手册 P26；后端 `UploadableFileValidator`） */
export const MEDIA_FILE_NAME_MAX_CHARS = 255

/** 单个上传文件上限：100MB（后端 multipart 上限，超过直接 400） */
export const MEDIA_UPLOAD_MAX_MB = 100
export const MEDIA_UPLOAD_MAX_BYTES = MEDIA_UPLOAD_MAX_MB * 1024 * 1024

/**
 * 分块大小：8MB。
 * ⚠️ 这是**后端**的事（一次性上传接口内部自动按 8MB 分块、自动带 `UploadAddress` 偏移），
 *    前端只做 100MB 的整体校验，不要自己切片、也不要传这个值给后端。
 * 页面上的说明文字直接用 `MEDIA_UPLOAD_CHUNK_MB`；`..._BYTES` 是留给将来真要自己切片
 * （分步上传 / 断点续传）时用的，**目前没有任何代码引用它**。
 */
export const MEDIA_UPLOAD_CHUNK_MB = 8
export const MEDIA_UPLOAD_CHUNK_BYTES = MEDIA_UPLOAD_CHUNK_MB * 1024 * 1024

/** 上传请求超时的估算参数（全局 axios 实例只有 15s，装不下媒体上传，必须单独覆盖） */
export const MEDIA_UPLOAD_MIN_TIMEOUT_MS = 60000
export const MEDIA_UPLOAD_MS_PER_MB = 2000

/**
 * 批量上传接口（`POST /api/media/{mediaType}/upload-batch`）里「后端没有上传该文件」的标记：
 * **`-1` 是后端自定的值，NAS 永远不会返回它**（NAS 侧只有 0/7/8）。
 * 用它把「NAS 拒绝」和「前端/后端根本没发出」区分开。
 */
export const BATCH_UPLOAD_NOT_SENT_RESULT = -1

/**
 * 上传队列里**同时允许存在的未完成文件数**（队列空闲时即「一次最多选 20 个」）。
 * 取值理由：NAS 上传是会话式串行的，太多了体验差、也更容易中途断。
 * ⚠️ **不要**改成 el-upload 的 `:limit`：它判的是队列**总长度**（会把上一批已成功的文件也算进去），
 *    会把第二次选择整批拒掉；弹窗是自己在放行文件时占额度、文件传完归还（见 MediaUploadDialog）。
 */
export const MEDIA_UPLOAD_BATCH_LIMIT = 20

/** 文件 ID 正则：4 位十六进制（上传成功后由 NAS 分配） */
export const FILE_ID_PATTERN = /^[0-9A-Fa-f]{4}$/

/** 分控软件设备 ID 正则：8 位十六进制（与后端 `@Pattern` 一致） */
export const SUB_USER_ID_PATTERN = /^[0-9A-Fa-f]{8}$/

/**
 * 上传的媒体类型（只有系统媒体与报警媒体支持上传）。
 * 分控软件媒体**没有上传接口**（NAS 只提供列表 + 删除），所以页面里上传按钮对它是禁用的。
 */
export const MEDIA_TYPES = [
  {
    key: 'system',
    label: '系统媒体',
    dataType: 'MediaFileList_System',
    uploadable: true,
    hint: '普通播放用的音频文件。播放列表只能引用系统媒体文件（列表里的 FileID 必定来自这里）。'
  },
  {
    key: 'alarm',
    label: '报警媒体',
    dataType: 'MediaFileList_Alarm',
    uploadable: true,
    hint: '消防 / 报警类任务使用的音频。⚠️ 系统媒体与报警媒体的 FileID 取值范围重叠，同一个 ID 在两类里对应不同文件，删除时务必先看清属于哪一类。'
  },
  {
    key: 'subUser',
    label: '分控软件媒体',
    dataType: 'MediaFileList_SubUser',
    uploadable: false,
    needsSubUserId: true,
    hint: '按分控软件设备查询（后端用 SubUserID 请求头指定），只读：NAS 没有提供上传到分控媒体的接口。只有这种列表会额外返回 DeviceID。'
  }
]

/** 支持上传的媒体类型（新建上传弹窗的类型单选） */
export const UPLOAD_MEDIA_TYPES = MEDIA_TYPES.filter((item) => item.uploadable)

/** 本地拦截（根本没发请求）时抛的错误，用于在结果表里和「NAS 拒绝」区分开 */
export class MediaUploadGuardError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MediaUploadGuardError'
  }
}

/** 按 key 找媒体类型定义（找不到时返回第一个，避免页面拿到 undefined 崩掉） */
export function findMediaType(key) {
  return MEDIA_TYPES.find((item) => item.key === key) || MEDIA_TYPES[0]
}

/** 该媒体类型是否支持上传（system / alarm 才支持） */
export function isUploadableMediaType(key) {
  return Boolean(findMediaType(key).uploadable)
}

/** 文件 ID 是否合法（4 位十六进制） */
export function isValidFileId(fileId) {
  return FILE_ID_PATTERN.test(String(fileId == null ? '' : fileId).trim())
}

/** 分控软件设备 ID 是否合法（8 位十六进制） */
export function isValidSubUserId(subUserId) {
  return SUB_USER_ID_PATTERN.test(String(subUserId == null ? '' : subUserId).trim())
}

/** 文件名取值（兼容不同浏览器 / 上传器给的对象） */
function fileNameOf(file) {
  if (!file) return ''
  return String(file.name || (file.raw && file.raw.name) || '').trim()
}

/*
 * ⚠️ 这里**故意没有**「文件 ID → xx 形式」之类的转换函数：
 *    4 位文件 ID 与 2 位播放列表 ID 是两套编号，任务 / 播放列表的 `FileList` 里
 *    **文件本身就写 4 位 ID**（如 `001A`），只有 `FFxx` 才是「引用播放列表 xx」的写法；
 *    把文件 ID 的低 2 位拼成 `FFxx` 是错的（NAS 会把它当成另一个播放列表）。
 *    「FileList 里误填了 FFxx」这类校验留到做播放列表 / 任务模块时再加。
 */

/** 播放时长（秒）→ `m:ss` / `h:mm:ss`；缺值返回 `-` */
export function formatPlayTime(playTime) {
  if (playTime === null || playTime === undefined || playTime === '') return '-'
  const total = Math.floor(Number(playTime))
  if (!Number.isFinite(total) || total < 0) return '-'

  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}

/** 字节数 → 人类可读（NAS 的 FileSize 与本地 File.size 对照时用） */
export function formatFileSize(bytes) {
  const value = Number(bytes)
  if (bytes === null || bytes === undefined || bytes === '' || !Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 上传请求的超时时间（毫秒）——**必须覆盖全局 axios 的 15s**，否则稍大的文件必被前端掐断。
 * 口径：`max(60s, ceil(总字节 / 1000000) * 2000ms)`
 *   · 5MB → 60s、50MB → 100s、100MB → 200s
 * ⚠️ 只传一个文件时按该文件算；如果哪天改成用批量接口（一次请求带多个文件），
 *    要把**整批文件的总大小**传进来（传数组或传字节数都可以）。
 *
 * @param {File|File[]|number} filesOrBytes 文件、文件数组，或直接用字节数
 * @returns {number} 超时毫秒数
 */
export function uploadTimeoutMs(filesOrBytes) {
  const files = Array.isArray(filesOrBytes) ? filesOrBytes : [filesOrBytes]
  const totalBytes =
    typeof filesOrBytes === 'number'
      ? filesOrBytes
      : files.reduce((sum, file) => sum + Number((file && file.size) || 0), 0)

  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return MEDIA_UPLOAD_MIN_TIMEOUT_MS
  return Math.max(
    MEDIA_UPLOAD_MIN_TIMEOUT_MS,
    Math.ceil(totalBytes / 1000000) * MEDIA_UPLOAD_MS_PER_MB
  )
}

/**
 * 上传前的本地校验（**在请求发出之前**就能判断的问题）。
 * 这些情况后端也会拒（空文件 / 名字超 255 → 400；超 100MB → 后端 multipart 上限），
 * 但白跑一趟网络、还可能被拒在网关层，不如提前拦住。
 *
 * @param {File} file 待上传文件
 * @returns {string} 不允许上传的原因；合规时返回空串
 */
export function describeUploadGuardProblem(file) {
  if (!file) return '没有拿到文件对象'
  if (!file.size) return '文件是空的（0 字节；后端与 NAS 都不接受空文件）'
  if (file.size > MEDIA_UPLOAD_MAX_BYTES) {
    return `文件大小 ${formatFileSize(file.size)} 超过 ${MEDIA_UPLOAD_MAX_MB}MB 上限`
  }
  if (fileNameOf(file).length > MEDIA_FILE_NAME_MAX_CHARS) {
    return `文件名超过 ${MEDIA_FILE_NAME_MAX_CHARS} 个字符（NAS 限制）`
  }
  return ''
}

/**
 * 上传成功的一行结果（给「上传结果表」用）。
 * @param {File} file 本地文件
 * @param {object} ack Close 响应 `{ DataType, Result, FileID, FileSize, PlayTime }`
 */
export function createUploadSuccessResult(file, ack) {
  const fileId = ack && ack.FileID ? String(ack.FileID) : ''
  return {
    fileName: fileNameOf(file) || '（无文件名）',
    localSize: (file && file.size) || 0,
    status: 'success',
    fileId,
    playTime: ack ? ack.PlayTime : null,
    serverSize: ack ? ack.FileSize : null,
    message: fileId
      ? `上传成功，NAS 分配 FileID=${fileId}`
      : '上传成功（但 NAS 没返回 FileID，列表里可能查不到，请刷新确认）'
  }
}

/**
 * 失败的一行结果。三种失败来源必须分清（用户在结果表里要能一眼看出来到底谁的问题）：
 *   · `local` —— 前端 / 后端**根本没发出**这次上传（本地校验没过，或批量接口的 `Result=-1` 标记）；
 *   · `nas`   —— 请求发到了、NAS 业务层拒绝（`Result` 非 0，如 7 异常 / 8 加入清单失败）；
 *   · `http`  —— HTTP 层失败（400 / 502 / 超时 / 网络中断），提示由 request.js 拦截器给出。
 *
 * @param {File} file 本地文件
 * @param {Error} error 抛出的错误
 * @returns {object} 结果行
 */
export function createUploadFailureResult(file, error) {
  const base = {
    fileName: fileNameOf(file) || '（无文件名）',
    localSize: (file && file.size) || 0,
    fileId: '',
    playTime: null,
    serverSize: null
  }

  // 批量接口自定的「未上传」标记（-1）：不是 NAS 返回的，说明该文件压根没发出去
  if (Number(error && error.result) === BATCH_UPLOAD_NOT_SENT_RESULT) {
    return {
      ...base,
      status: 'local',
      message: '后端没有上传该文件（批量接口自定的 Result=-1 标记；整批不会因此中断）'
    }
  }

  // 本地拦截（空文件 / 超 100MB / 文件名超 255 字符）
  if (error && error.name === 'MediaUploadGuardError') {
    return { ...base, status: 'local', message: error.message }
  }

  // NAS 业务拒绝（HTTP 200 + Result !== 0）
  if (error && error.name === 'NasResultError') {
    return { ...base, status: 'nas', message: error.message }
  }

  return {
    ...base,
    status: 'http',
    message: `请求失败：${(error && error.message) || '未知错误'}（详见页面右下角的全局提示）`
  }
}

/** 结果行的状态 → 展示文案与 el-tag 类型 */
export function describeUploadResultStatus(status) {
  if (status === 'success') return { text: '成功', tag: 'success' }
  if (status === 'nas') return { text: 'NAS 拒绝', tag: 'danger' }
  if (status === 'local') return { text: '未发出', tag: 'warning' }
  return { text: '请求失败', tag: 'info' }
}

