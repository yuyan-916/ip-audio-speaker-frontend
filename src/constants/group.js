// src/constants/group.js —— 终端分组模块的枚举字典与纯函数
//
// 取值来源：后端 docs/API.md「终端分组模块」与 docs/impl-notes.md §十四 1（NAS 手册 P19-23）。
// 响应字段是 NAS 风格大驼峰（GroupID / GroupName / Creater / PlayerList）。

/**
 * 分组名长度上限：手册 P22「转义前最多 31 个字符」，对应后端 PlayerGroupSetRequestDto 的
 * `@Size(max = 31)`。
 *
 * ⚠️ 这里是**字符**口径，与设备名的 31 个 **GBK 字节**（constants/device.js 的 DEV_NAME_MAX_BYTES）
 *    是两套标准，不能互用：16 个汉字对设备名已经超限，对分组名却只算 16 个字符。
 */
export const GROUP_NAME_MAX_CHARS = 31

/** 分组 ID 的正则：2 位十六进制（新建时由 NAS 分配） */
export const GROUP_ID_PATTERN = /^[0-9A-Fa-f]{2}$/

/**
 * 分组 ID 放进任务的 PlayerList 时的 8 位形式：`FFFFFFxx`。
 * 手册明确「分组成员必须是终端设备 ID」，`FFFFFFxx` 只用于**任务**的播放目标。
 */
export const GROUP_TASK_ID_PATTERN = /^FFFFFF[0-9A-Fa-f]{2}$/

/** 分组 ID 是否合法（2 位十六进制） */
export function isValidGroupId(groupId) {
  return GROUP_ID_PATTERN.test(String(groupId == null ? '' : groupId).trim())
}

/**
 * 分组 ID → 任务里使用的 8 位形式 FFFFFFxx。
 * @param {string} groupId 2 位十六进制的分组 ID
 * @returns {string} 8 位十六进制 ID；入参非法时返回空串
 */
export function toTaskPlayerId(groupId) {
  const id = String(groupId == null ? '' : groupId).trim().toUpperCase()
  return isValidGroupId(id) ? `FFFFFF${id}` : ''
}

/**
 * 成员是否被误填成了**分组 ID**（FFFFFFxx）。
 * 手册要求分组成员是终端设备 ID；FFFFFFxx 语法上同样合法（8 位十六进制），接口层拦不住，
 * 只能在前端提示，避免用户把「分组」当成「终端」加进分组。
 */
export function looksLikeGroupId(memberId) {
  return GROUP_TASK_ID_PATTERN.test(String(memberId == null ? '' : memberId).trim().toUpperCase())
}

/** 分组名是否超长（按**字符数**，中文 / 全角均记 1 个字符） */
export function isGroupNameTooLong(groupName) {
  return String(groupName == null ? '' : groupName).length > GROUP_NAME_MAX_CHARS
}

/** 分组成员数（PlayerList 缺失时按 0 处理） */
export function groupMemberCount(group) {
  const list = group && group.PlayerList
  return Array.isArray(list) ? list.length : 0
}

/** 本后端（HTTP API 用户）创建分组时 Creater 的取值区间：00000001 ~ 00000008 */
const API_CREATER_PATTERN = /^0000000[1-8]$/

/**
 * 分组创建者 → 展示文案。
 * NAS 手册拼写是 **Creater**（少一个 o），"管理软件创建的分组没有该字段"。
 * @param {string} creater 分组对象里的 Creater 字段
 * @returns {{text: string, tag: string}} text 给标签文案，tag 给 el-tag 的 type
 */
export function describeGroupCreater(creater) {
  const id = String(creater == null ? '' : creater).trim().toUpperCase()
  if (!id) return { text: '管理软件创建', tag: 'info' }
  if (API_CREATER_PATTERN.test(id)) return { text: `API 用户 ${id}`, tag: 'primary' }
  return { text: `分控软件 ${id}`, tag: 'warning' }
}

/**
 * 在设备列表里找出分组成员对应的设备（成员选择与名称显示共用）。
 * @param {string} memberId 分组成员里的设备 ID
 * @param {Array} devices 播放终端列表（NAS 原始字段）
 * @returns {object|null} 找不到返回 null（设备可能已离线很久 / 已从系统删除）
 */
export function findMemberDevice(memberId, devices = []) {
  const id = String(memberId == null ? '' : memberId).trim().toUpperCase()
  if (!id) return null
  return (
    devices.find((item) => String(item.DeviceID == null ? '' : item.DeviceID).trim().toUpperCase() === id) ||
    null
  )
}

/** 分组成员的展示名：优先设备名，其次设备 ID；设备不在列表里时标注出来 */
export function describeMemberName(memberId, devices = []) {
  const device = findMemberDevice(memberId, devices)
  if (!device) return ''
  return device.DevName || ''
}
