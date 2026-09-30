// src/api/group.js —— 终端分组模块接口
//
// 后端对应 GroupController（docs/API.md「终端分组模块」），三个写操作在 NAS 侧共用同一个
// /NAS/API/PlayerGroupSet，靠 DataType（PlayerGroupNew / Edit / Delete）区分。
//
// 响应仍是 NAS 风格：{ DataType, Result, Data }（HTTP 状态码 200）。
// **Result === 0 才算成功**；Result !== 0 表示 NAS 业务拒绝，由 store 用 assertNasOk 抛出，
// 页面提示（本层不做判断）。

import request from './request'

/**
 * 获取全部分组 —— GET /api/groups
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<object>}>}
 *   Data 元素字段（NAS 原始大驼峰）：
 *   · GroupID   —— 2 位十六进制，放进任务的 PlayerList 时要写成 FFFFFFxx；
 *   · GroupName —— 分组名；
 *   · Creater   —— ⚠️ 手册拼写就是 Creater（少一个 o）。分控软件 / 本后端（API 用户）创建的分组才有该字段，
 *                  管理软件创建的分组没有；取值是创建者设备 ID（API 用户为 00000001~00000008）；
 *   · PlayerList —— 成员终端设备 ID 数组（8 位十六进制）。
 */
export function getGroups() {
  return request.get('/groups')
}

/**
 * 新建分组 —— POST /api/groups/new
 *
 * @param {{groupName?: string, playerList?: string[]}} payload
 *   · groupName：**转义前最多 31 个字符**（是字符，不是字节）；缺省时 NAS 用默认名 `New Group`；
 *   · playerList：成员终端设备 ID 列表，缺省视为空分组。
 * @returns {Promise<{DataType: string, Result: number, GroupID?: string}>}
 *   GroupID 是 **NAS 新分配**的 2 位十六进制 ID（只有新建会返回；失败时无此字段）。
 */
export function newGroup(payload) {
  return request.post('/groups/new', payload)
}

/**
 * 编辑分组 —— POST /api/groups/edit
 *
 * ⚠️ NAS 语义（手册 P22）：**缺省 PlayerList 等于把成员清空**，因此调用方必须始终提交完整成员列表
 *    （即使要清空，也显式发 `[]`）——本项目的 store 已经这样收口。
 *
 * @param {{groupId: string, groupName?: string, playerList?: string[]}} payload
 *   · groupId：2 位十六进制（必填，否则后端 400）；
 *   · groupName：缺省表示保持原名；
 *   · playerList：本次操作后的**完整**成员列表。
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function editGroup(payload) {
  return request.post('/groups/edit', payload)
}

/**
 * 删除分组 —— POST /api/groups/delete
 *
 * @param {{groupId: string, groupName: string}} payload
 *   · groupId：2 位十六进制（必填）；
 *   · groupName：必填，NAS 用它确认要删的是哪个分组，**必须与列表里的原名完全一致**。
 * @returns {Promise<{DataType: string, Result: number}>}
 */
export function deleteGroup(payload) {
  return request.post('/groups/delete', payload)
}
