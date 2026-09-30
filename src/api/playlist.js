// src/api/playlist.js —— 播放列表模块接口
//
// 后端对应 PlayListController（docs/API.md「播放列表模块」），三个写操作在 NAS 侧共用同一个
// /NAS/API/FilePlayListSet，靠 DataType（FilePlayListNew / Edit / Delete）区分。
//
// 响应仍是 NAS 风格：{ DataType, Result, Data }（HTTP 状态码 200）。
// **Result === 0 才算成功**；Result !== 0 表示 NAS 业务拒绝，由 store 用 assertNasOk 抛出，
// 页面提示（本层不做判断）。

import request from './request'

/**
 * 获取全部播放列表 —— GET /api/playlists
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<object>}>}
 *   Data 元素字段（NAS 原始大驼峰）：
 *   · PlayListID   —— 2 位十六进制，放进任务的 FileList 时要写成 FFxx；
 *   · PlayListName —— 播放列表名（**转义前最多 31 个字符**）；
 *   · FileList     —— **有序**的系统媒体文件 ID 数组（4 位十六进制，最多 1024 个），播放顺序就是数组顺序。
 */
export function getPlayLists() {
  return request.get('/playlists')
}

/**
 * 新建播放列表 —— POST /api/playlists/new
 *
 * @param {{playListName?: string, fileList?: string[]}} payload
 *   · playListName：**转义前最多 31 个字符**（是字符，不是字节）；缺省时 NAS 用默认名 `New Play List`；
 *   · fileList：有序的系统媒体文件 ID 数组（4 位十六进制）；缺省视为空列表。
 * @returns {Promise<{DataType: string, Result: number, PlayListID?: string}>}
 *   PlayListID 是 **NAS 新分配**的 2 位十六进制 ID（只有新建会返回；失败时无此字段）。
 */
export function newPlayList(payload) {
  return request.post('/playlists/new', payload)
}

/**
 * 编辑播放列表 —— POST /api/playlists/edit
 *
 * ⚠️ NAS 语义（手册 P33）：**缺省 FileList 等于把文件列表清空**，因此调用方必须始终提交完整文件列表
 *    （即使要清空，也显式发 `[]`）——本项目的 store 已经这样收口。
 *
 * @param {{playListId: string, playListName?: string, fileList: string[]}} payload
 *   · playListId：2 位十六进制（必填，否则后端 400）；
 *   · playListName：缺省表示保持原名；
 *   · fileList：本次操作后的**完整、有序**文件列表。
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function editPlayList(payload) {
  return request.post('/playlists/edit', payload)
}

/**
 * 删除播放列表 —— POST /api/playlists/delete
 *
 * @param {{playListId: string, playListName: string}} payload
 *   · playListId：2 位十六进制（必填）；
 *   · playListName：必填，NAS 用它确认要删的是哪个列表，**必须与列表里的原名完全一致**。
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function deletePlayList(payload) {
  return request.post('/playlists/delete', payload)
}
