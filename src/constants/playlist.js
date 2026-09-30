// src/constants/playlist.js —— 播放列表模块的枚举字典与纯函数
//
// 取值来源：后端 docs/API.md「播放列表模块」与 docs/impl-notes.md §十四 3 / §十四 4（NAS 手册 P31-34）。
// 响应字段是 NAS 风格大驼峰（PlayListID / PlayListName / FileList）。
//
// ⚠️ 四条必须记住的口径（都来自手册）：
//   1) 播放列表的 `FileList` **是有序的**：数组顺序就是播放顺序，UI 必须支持上移 / 下移；
//   2) `FileList` 里只能放**系统媒体文件**的 4 位 FileID（报警媒体 / 分控媒体都不行，NAS 也不校验）；
//   3) `FileList` 里的 4 位元素 `FFxx` **不是文件**，而是「引用播放列表 xx」的写法
//      → 选文件时必须把形如 FFxx 的系统媒体 ID 挡掉（looksLikePlayListRef）；
//   4) 一个列表最多 1024 个文件；名字上限 31 个**字符**（与分组名同口径，不是设备名的 GBK 字节）。

import { isValidFileId } from '@/constants/media'

/**
 * 播放列表名长度上限：手册 P33「转义前最多 31 个字符」，对应后端 PlayListSetRequestDto 的
 * `@Size(max = 31)`。
 *
 * ⚠️ 与分组名同口径（**字符**），与设备名的 31 个 **GBK 字节**（constants/device.js 的
 *    DEV_NAME_MAX_BYTES）不是一套标准，不能互相套用。
 */
export const PLAYLIST_NAME_MAX_CHARS = 31

/** 一个播放列表最多能包含的文件数（手册 P33；后端 @Size(max = 1024) 同样拦一道） */
export const PLAYLIST_MAX_FILES = 1024

/** 播放列表 ID 正则：2 位十六进制（新建时由 NAS 分配） */
export const PLAYLIST_ID_PATTERN = /^[0-9A-Fa-f]{2}$/

/**
 * 播放列表 ID 放进任务的 `FileList` 时的 4 位形式：`FFxx`。
 * ⚠️ 与文件 ID 的低 2 位无关：`FF1A` 只表示「引用播放列表 1A」，不要由文件 ID 拼出来。
 */
export const PLAYLIST_TASK_REF_PATTERN = /^FF[0-9A-Fa-f]{2}$/

/** 播放列表 ID 是否合法（2 位十六进制） */
export function isValidPlayListId(playListId) {
  return PLAYLIST_ID_PATTERN.test(String(playListId == null ? '' : playListId).trim())
}

/**
 * 播放列表 ID → 任务 `FileList` 里引用的 4 位形式 `FFxx`。
 * @param {string} playListId 2 位十六进制的播放列表 ID
 * @returns {string} 4 位十六进制引用；入参非法时返回空串
 */
export function toTaskFileListRef(playListId) {
  const id = String(playListId == null ? '' : playListId).trim().toUpperCase()
  return isValidPlayListId(id) ? `FF${id}` : ''
}

/**
 * 这个 4 位 ID 是否会被 NAS 当成**播放列表引用**（`FFxx`）。
 *
 * 手册：任务的 `FileList`（以及播放列表自己的 `FileList`）里，`FFxx` 表示「引用播放列表 xx」，
 * 语法上与普通文件 ID 完全一致（`FF1A` 就是合法的 4 位十六进制），接口层拦不住 ——
 * 只能在前端把形如 `FFxx` 的系统媒体文件挡在候选之外，否则用户以为加进去的是文件、
 * NAS 却会去播另一个播放列表。
 */
export function looksLikePlayListRef(fileId) {
  return PLAYLIST_TASK_REF_PATTERN.test(String(fileId == null ? '' : fileId).trim().toUpperCase())
}

/** 播放列表名是否超长（按**字符数**，中文 / 全角均记 1 个字符） */
export function isPlayListNameTooLong(playListName) {
  return String(playListName == null ? '' : playListName).length > PLAYLIST_NAME_MAX_CHARS
}

/** 播放列表的文件数（FileList 缺失时按 0 处理） */
export function playListFileCount(playList) {
  const list = playList && playList.FileList
  return Array.isArray(list) ? list.length : 0
}

/**
 * 规范化文件 ID 列表：去空白、转大写、丢掉空值与非法项、**保留顺序**、去重。
 *
 * 为什么要去重：NAS 不校验重复，重复项只会让同一个文件被播两次；表单在添加时已经去重，
 * 这里再兜一层（编辑历史数据、粘贴导入等场景）。
 *
 * @param {Array} fileList 原始 ID 数组
 * @returns {string[]} 规范化后的数组（顺序与入参一致）
 */
export function normalizeFileIds(fileList) {
  const result = []
  const seen = new Set()
  const list = Array.isArray(fileList) ? fileList : []
  list.forEach((item) => {
    const id = String(item == null ? '' : item).trim().toUpperCase()
    if (!isValidFileId(id) || seen.has(id)) return
    seen.add(id)
    result.push(id)
  })
  return result
}

/**
 * 在系统媒体文件列表里找出某个 FileID 对应的媒体文件（文件名 / 时长显示共用）。
 * @param {string} fileId 4 位十六进制文件 ID
 * @param {Array} mediaFiles 系统媒体列表（NAS 原始字段：FileID / FileName / PlayTime）
 * @returns {object|null} 找不到返回 null（文件可能已被删除）
 */
export function findMediaFile(fileId, mediaFiles = []) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  if (!id) return null
  return (
    mediaFiles.find(
      (item) => String(item.FileID == null ? '' : item.FileID).trim().toUpperCase() === id
    ) || null
  )
}

/** 文件 ID 对应的文件名；文件已不在系统媒体列表里时返回空串 */
export function describeFileId(fileId, mediaFiles = []) {
  const file = findMediaFile(fileId, mediaFiles)
  return file ? String(file.FileName || '') : ''
}

/**
 * 把播放列表里的一个元素展开成展示行（列表页的文件预览、查看弹窗的表格都用它）。
 *
 * 三种「需要注意」的情况都标出来，不要静默隐藏：
 *   · `suspicious` —— 形如 `FFxx`，NAS 会把它当成**播放列表引用**而不是文件；
 *   · `known=false` —— 不在当前系统媒体列表里（文件可能已被删除，列表里仍留着引用）；
 *   · 非法 ID（理论上传不进来，防御性处理）。
 *
 * @param {string} fileId FileList 里的元素
 * @param {Array} mediaFiles 系统媒体列表
 * @returns {{fileId: string, fileName: string, playTime: (number|string), known: boolean, suspicious: boolean, valid: boolean}}
 */
export function describePlayListFile(fileId, mediaFiles = []) {
  const id = String(fileId == null ? '' : fileId).trim().toUpperCase()
  const file = findMediaFile(id, mediaFiles)
  return {
    fileId: id,
    fileName: file ? String(file.FileName || '') : '',
    playTime: file ? file.PlayTime : '-',
    known: Boolean(file),
    suspicious: looksLikePlayListRef(id),
    valid: isValidFileId(id)
  }
}

/**
 * 统计 FileList 里形如 `FFxx` 的元素（列表页 / 弹窗用来给出「有条目会被当成播放列表引用」的提示）。
 * @returns {number}
 */
export function countPlayListRefs(playList) {
  const list = playList && Array.isArray(playList.FileList) ? playList.FileList : []
  return list.filter((id) => looksLikePlayListRef(id)).length
}
