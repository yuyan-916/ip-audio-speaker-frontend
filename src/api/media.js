// src/api/media.js —— 媒体文件模块接口
//
// 后端对应 MediaController（docs/API.md「媒体文件模块」）：
//   GET  /api/media/system | /alarm | /sub-user/{subUserId}   列表（DataType 为 MediaFileList_*）
//   POST /api/media/system|alarm/delete                      删除（NAS 侧 DataType=DeleteFile）
//   POST /api/media/{mediaType}/upload                       一次性上传（multipart，单文件）
//   POST /api/media/{mediaType}/upload-batch                 批量上传（multipart，字段名 files）
//   POST /api/media/upload/open|data|close                   分步上传（本项目前端不用，见文件末尾说明）
//
// 响应仍是 NAS 风格：{ DataType, Result, Data }（HTTP 状态码 200）。
// **Result === 0 才算成功**；Result !== 0 由 store 用 assertNasOk 抛出，页面提示（本层不做判断）。

import request from './request'
import { uploadTimeoutMs } from '@/constants/media'

/** 获取系统媒体文件列表 —— GET /api/media/system */
export function getSystemMediaFiles() {
  return request.get('/media/system')
}

/** 获取报警媒体文件列表 —— GET /api/media/alarm */
export function getAlarmMediaFiles() {
  return request.get('/media/alarm')
}

/**
 * 获取某个分控软件的媒体文件列表 —— GET /api/media/sub-user/{subUserId}
 *
 * @param {string} subUserId **8 位十六进制**的分控软件设备 ID（格式非法后端直接 400；
 *   NAS 侧用 `SubUserID` 请求头指定，返回的列表会额外带一个 `DeviceID` = 此值）
 */
export function getSubUserMediaFiles(subUserId) {
  return request.get(`/media/sub-user/${encodeURIComponent(subUserId)}`)
}

/**
 * 删除系统媒体文件 —— POST /api/media/system/delete
 *
 * ⚠️ NAS 的删除接口要求 **FileID + FileName 同时给对**（FileName 用于确认目标，不一致返回 Result=8），
 *    因此这里的 fileName 必须用列表里的原名，不要让用户改。
 * ⚠️ 系统媒体与报警媒体的 FileID **取值范围重叠**，所以删除的路径必须与当前媒体类型严格对应。
 *
 * @param {{fileId: string, fileName: string}} payload fileId 为 4 位十六进制
 * @returns {Promise<{DataType: string, Result: number}>} DataType 为 DeleteFileAck
 */
export function deleteSystemMediaFile({ fileId, fileName }) {
  return request.post('/media/system/delete', { fileId, fileName })
}

/** 删除报警媒体文件 —— POST /api/media/alarm/delete（语义同 deleteSystemMediaFile） */
export function deleteAlarmMediaFile({ fileId, fileName }) {
  return request.post('/media/alarm/delete', { fileId, fileName })
}

/**
 * 把 axios 的 onUploadProgress 转成「百分比回调」。
 * ⚠️ 浏览器传完字节数后响应还要等 NAS 走完 Close，所以这里**最多报到 99%**：
 *    否则进度条早早满格、用户以为传完了，实际还在等 NAS。
 */
function toProgressHandler(onProgress) {
  if (typeof onProgress !== 'function') return undefined
  return (event) => {
    const total = Number((event && event.total) || 0)
    const loaded = Number((event && event.loaded) || 0)
    const percent = total > 0 ? Math.round((loaded / total) * 100) : 0
    onProgress(Math.max(0, Math.min(99, percent)))
  }
}

/**
 * 上传单个媒体文件 —— POST /api/media/{mediaType}/upload（multipart，字段名 `file`）
 *
 * 后端会在**一次请求内**完成 NAS 的 Open → Data… → Close（自动按 8MB 分块、自动带偏移），
 * 所以前端只负责把文件原样发出去，不要自己切片。
 *
 * ⚠️ 必须覆盖全局 15s 超时（api/request.js）：默认按文件大小估算（见 uploadTimeoutMs），调用方可传 timeout 覆盖。
 * ⚠️ 上传**不能并发**：NAS 的上传是会话式的（上一次 Open 没 Close 之前再 Open 会拿到 Result=8）。
 *    本项目由弹窗把多个文件串成一条链逐个上传，见 components/media/MediaUploadDialog.vue。
 *
 * @param {'system'|'alarm'} mediaType 系统媒体 / 报警媒体（分控媒体没有上传接口）
 * @param {File} file 待上传文件
 * @param {{timeout?: number, onProgress?: (percent: number) => void}} [options]
 * @returns {Promise<{DataType: string, Result: number, FileID?: string, FileSize?: number, PlayTime?: number}>}
 *   DataType 为 UploadFileCloseAck；**Result !== 0 时没有 FileID**（7 上传异常 / 8 加入媒体清单失败）
 */
export function uploadMediaFile(mediaType, file, { timeout, onProgress } = {}) {
  const form = new FormData()
  form.append('file', file)

  return request.post(`/media/${mediaType}/upload`, form, {
    timeout: timeout || uploadTimeoutMs([file]),
    onUploadProgress: toProgressHandler(onProgress)
  })
}

/**
 * 批量上传 —— POST /api/media/{mediaType}/upload-batch（multipart，字段名 **复数** `files`，可重复）
 *
 * 后端**串行**逐个上传，响应是**与入参顺序一一对应**的数组：
 *   · 成功项 `{ DataType: "UploadFileCloseAck", Result: 0, FileID: "00D3", … }`；
 *   · 失败项 `{ DataType: "UploadFileCloseAck", Result: -1 }` —— `-1` 是**后端自定**的
 *     「这个文件后端没上传」标记（空文件 / 缺文件名 / 名字超 255 / 上传过程出错），
 *     整批不会因此中断。前端用 constants/media.js 的 BATCH_UPLOAD_NOT_SENT_RESULT 识别它，
 *     以便和「NAS 拒绝」区分（NAS 只会返回 0 / 7 / 8）。
 *
 * ⚠️ **不是原子操作**：前几个文件可能已经真的写进 NAS 了。
 * ⚠️ 本项目的上传弹窗默认**不用**这个接口，而是逐个调 uploadMediaFile（NAS 会话式上传本来就不能并发，
 *    而逐个传能拿到每个文件自己的进度与错误）；这个函数保留下来是为了接口面完整，
 *    需要「一次请求带走整批」时可以直接用（超时按**整批总大小**估算）。
 *
 * @param {'system'|'alarm'} mediaType 系统媒体 / 报警媒体
 * @param {File[]} files 待上传文件（建议 ≤20 个）
 * @param {{timeout?: number, onProgress?: (percent: number) => void}} [options]
 * @returns {Promise<Array<{DataType: string, Result: number, FileID?: string}>>}
 */
export function uploadMediaFilesBatch(mediaType, files, { timeout, onProgress } = {}) {
  const form = new FormData()
  files.forEach((file) => form.append('files', file))

  return request.post(`/media/${mediaType}/upload-batch`, form, {
    timeout: timeout || uploadTimeoutMs(files),
    onUploadProgress: toProgressHandler(onProgress)
  })
}

// 分步上传（POST /api/media/upload/open → /data → /close）本项目前端**没有使用**：
// 后端的一次性上传接口已经把 Open→Data→Close 封装好了，而分步接口的价值在于「前端自己控制时序 / 断点续传」，
// 本项目暂不做断点续传。需要时再照 docs/API.md 的三个步骤接入（注意 unionCode 是会话态、4 分钟不动作会被丢弃）。

