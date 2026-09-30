// src/constants/devicePermit.js —— 设备权限模块的字典与纯函数
//
// 取值来源：NAS 手册第三部分「设备权限」（P14-18），逐条抄进后端 docs/impl-notes.md §九；
// 对外契约见 ip-audio-speaker-backend/docs/API.md「设备权限模块」。响应字段是 NAS 风格大驼峰
// （DeviceID / DeviceType / PermitGroup / PermitPlayer / PermitCapturer）。
//
// 用途：限制「主动设备 / 软件」（分控软件、寻呼话筒、手机 APP、中间件等）能看到并选择哪些分组 / 终端 / 采播器。
// ⚠️ 手册 P18 明确：**HTTP API 用户本身可完整获取设备与分组信息，无需设置权限数据** ——
//    所以这一页是本项目里最「冷门」的功能：它的价值是「代替管理软件去配置那些设备」，
//    不是本后台自身运行所必需（README §八「已知限制」里也写了这一条）。
//
// 四条最容易踩的规则（校验、UI 限制、README 都围绕它们）：
//   1) `PermitGroup` 的元素必须是 **FFFFFFxx**（分组 2 位 ID 扩展成 8 位，写法与任务的播放目标一致）；
//   2) `PermitPlayer` / `PermitCapturer` 的元素是 8 位十六进制设备 ID，**不能**是 FFFFFFxx（分组写法）
//      也不能是 00000000 —— 手册的判据是「不能 ≥ FFFFFF00」，在 8 位十六进制里等价于「不能是 FFFFFFxx」；
//   3) 任一清单里都**不能包含被设置权限的设备自身**（后端 DTO 的 @AssertTrue 也会拦，返回 400）；
//   4) 三类**都为空 = 清除**该设备的权限数据（手册定义的语义，**不是错误**）。
//
// ⚠️ 服务器不会校验这些 ID 是否真实存在（填了不存在的 ID 不会报错，设备真正下载清单时才会被过滤掉），
//    但手册建议只填有效数据 —— 所以候选项一律从「设备 / 分组列表」里选，手输的 ID 只做格式校验。

import { getDeviceState, getDeviceTypeName, isValidDeviceId } from '@/constants/device'
import { GROUP_TASK_ID_PATTERN, describeGroupCreater, isPrivateGroup, toTaskPlayerId } from '@/constants/group'

/**
 * 需要设置权限数据的设备类型（手册 P18 原文列出的 9 种，设备类型是 2 位十六进制）：
 * `E8` 分控软件、`D8`/`DE` 中间件（第三方软件）、`1E` 寻呼话筒、`DA` 手机 APP、
 * `CE` 声卡采集软件、`5E` 对讲话筒、`5F`/`9F` 网络对讲话筒终端。
 *
 * 中文名与 constants/device.js 的 DEVICE_TYPE_NAMES 同源（同一张手册表），这里只标明「哪些类型要配权限」。
 */
export const DEVICE_TYPES_NEED_PERMIT = {
  E8: '分控软件',
  DA: '手机 APP',
  CE: '声卡采集软件',
  DE: '中间件（第三方软件）',
  D8: '中间件（第三方软件）',
  '1E': '寻呼话筒',
  '5E': '对讲话筒',
  '5F': '网络对讲话筒终端',
  '9F': '网络对讲话筒终端'
}

/** 需要权限数据的类型编码清单（候选设备筛选、下拉遍历都用它） */
export const NEED_PERMIT_TYPE_CODES = Object.keys(DEVICE_TYPES_NEED_PERMIT)

/**
 * ⚠️ 手册 P19 用「`Passive = 1`（支持被动启动采播）的主动采播器」来描述可写进 `PermitCapturer`
 * 的主动设备，并明确列出类型是 **`1E` / `2E` / `4E` / `CE`**。
 * 本项目后端的 `DeviceItemDto` **没有透出 `Passive` 字段**（只有 DeviceID / DevName / IP / Port /
 * MAC / State / Volume / DeviceType），因此前端按这张**类型表**等价筛选，而不是按 `Passive` 字段。
 */
export const PASSIVE_ACT_CAPTURER_TYPES = ['1E', '2E', '4E', 'CE']

/** 手册 P19：`PermitCapturer` 还可以放「对讲面板 / 对讲话筒」（类型 `2E` / `5E` / `6E`） */
export const TALK_CAPTURER_TYPES = ['5E', '6E']

/** 内部：统一把 ID / 类型码规范成「去空格 + 大写」的字符串（NAS 两种大小写都可能回） */
function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toUpperCase()
}

/**
 * 对外的规范化函数：设备类型码 / 各种 ID 都用它（store 与页面里比较类型码时也需要）。
 * 与下面的 `normalizePermitId` 是同一个实现，分开命名只是为了读代码时能区分「类型码」与「ID」。
 */
export function normalizePermitCode(value) {
  return normalizeCode(value)
}

/** 设备类型是否需要加载权限数据（目录里可能出现手册之外的编码，只返回 false 不报错） */
export function needsPermitDeviceType(deviceType) {
  return NEED_PERMIT_TYPE_CODES.includes(normalizeCode(deviceType))
}

/**
 * 设备类型 → 展示文案：`E8 · 分控软件`。
 * 名称优先取「需要权限」的 9 类，其次取 constants/device.js 的完整 DeviceType 表；
 * 都不认识时显示 `未知类型（xx）` —— 目录是 NAS 给的，原样显示编码比藏起来更好排障。
 */
export function describeDeviceTypeForPermit(deviceType) {
  const code = normalizeCode(deviceType)
  if (!code) return '未知类型（设备目录里没有 DeviceType）'
  const name = DEVICE_TYPES_NEED_PERMIT[code] || getDeviceTypeName(code)
  return name ? `${code} · ${name}` : `未知类型（${code}）`
}

/** `PermitGroup` 元素的格式：FFFFFFxx（与 constants/group.js 里「任务的播放目标」写法完全一致，直接复用） */
export const PERMIT_GROUP_ID_PATTERN = GROUP_TASK_ID_PATTERN

/** `PermitPlayer` / `PermitCapturer` 元素的格式：8 位十六进制，且不是 FFFFFFxx、不是 00000000 */
export const PERMIT_DEVICE_ID_PATTERN = /^(?!FFFFFF)(?!00000000)[0-9A-Fa-f]{8}$/

/** 每类清单最多 248 项（后端 DTO 的 `@Size(max = 248)`，NAS 也按这个上限拒绝） */
export const PERMIT_LIST_MAX = 248

/** `PermitGroup` 元素是否合法（必须 FFFFFFxx；不能填 `"05"` 这种 2 位分组 ID） */
export function isValidPermitGroupId(groupId) {
  return PERMIT_GROUP_ID_PATTERN.test(normalizeCode(groupId))
}

/** `PermitPlayer` / `PermitCapturer` 元素是否合法（8 位十六进制，且不是 FFFFFFxx / 00000000） */
export function isValidPermitDeviceId(deviceId) {
  return PERMIT_DEVICE_ID_PATTERN.test(normalizeCode(deviceId))
}

/** 这个 ID 是不是「分组写法」（FFFFFFxx）—— 用于提示用户「为什么不能填进终端 / 采播器清单」 */
export function isPermitGroupFormId(id) {
  return PERMIT_GROUP_ID_PATTERN.test(normalizeCode(id))
}

// ---------------- 提示文案（页面与弹窗直接渲染，保证各处口径一致） ----------------

/** 这个模块是给谁用的（手册 P18 的结论）—— 每条入口都要出现一次，否则用户会困惑「我到底要不要配」 */
export const HINT_NO_NEED =
  'HTTP API 用户本身可完整获取设备与分组信息，无需设置权限数据；此页主要用于给分控软件 / 对讲话筒 / 手机 APP 这类「需要在本地显示播放目标清单」的设备，配置它们能看到的分组、终端与采播器'

/** 三类都为空 = 清除（这是语义，不是错误） */
export const HINT_EMPTY_ALL = '三类清单全为空 = 清除该设备的权限数据（手册定义的语义，不是错误）'

/** 不能包含自身 */
export const HINT_SELF_EXCLUDE = '任一清单里都不能包含该设备自身（后端会返回 400 VALIDATION_FAILED）'

/** 分组清单元素格式 */
export const HINT_GROUP_FORMAT = '分组清单的元素必须是 FFFFFFxx（分组 2 位 ID 扩展成 8 位），不能直接填 "05"'

/** 终端 / 采播器清单元素格式 */
export const HINT_DEVICE_FORMAT =
  '终端 / 采播器清单的元素是 8 位十六进制设备 ID，不能是 FFFFFFxx（分组写法），也不能是 00000000'

/** 每类清单上限 */
export const HINT_LIST_MAX = `每类清单最多 ${PERMIT_LIST_MAX} 项`

/** 服务器不校验 ID 是否存在 */
export const HINT_SERVER_NO_CHECK = '服务器不会校验这些 ID 是否真实存在（不影响保存），但官方建议只填有效数据'

/** 目录的自动入册语义 */
export const HINT_CATALOG_AUTO = '目录不需要专门添加：给某台设备设置权限数据后，它会自动出现在目录里'

/** Result = 1 的语义（查询接口特有） */
export const HINT_NOT_SET_YET = 'NAS 返回 Result=1 表示该设备尚未设置权限数据（不是错误，按三类清单都空处理）'

/** 私有分组提醒（手册 P19 的数据有效性限定） */
export const HINT_PRIVATE_GROUP = 'Creater 不是 00000000~00000008 的分组属于分控软件的私有分组，手册建议不要给其它设备使用'

/** 可写进采播器清单的设备范围（手册 P19） */
export const HINT_CAPTURER_SCOPE =
  '采播器清单可填：被动采播器、支持被动启动的主动采播器（类型 1E / 2E / 4E / CE）、对讲面板与对讲话筒（类型 5E / 6E）'

// ---------------- 归一化 ----------------

/** 单个 ID 的规范形式：去空格 + 大写（NAS 回的小写、手输的小写都统一成大驼峰里的写法） */
export function normalizePermitId(id) {
  return normalizeCode(id)
}

/**
 * ID 数组的规范形式：大写、丢掉空值、**按首次出现顺序去重**。
 * 去重是有意义的：NAS 不禁止重复项，但重复项对设备侧的清单没有任何意义。
 */
export function normalizePermitIds(list) {
  const result = []
  for (const item of Array.isArray(list) ? list : []) {
    const id = normalizePermitId(item)
    if (id && !result.includes(id)) result.push(id)
  }
  return result
}

/** 空的三类清单（弹窗表单与 store 的初值） */
export function emptyPermit() {
  return { permitGroup: [], permitPlayer: [], permitCapturer: [] }
}

/**
 * NAS 的 `DevicePermitInfo` 响应（或缓存里的一份权限）→ 页面统一形态。
 * ⚠️ `Result === 1` = 该设备尚未设置权限数据：此时响应里**没有**三个数组字段，
 *    这里按「都为空」处理，并把 `notSet` 标出来，页面据此提示用户「还没配过」而不是「读取失败」。
 *
 * @returns {{deviceId: string, notSet: boolean, permitGroup: string[], permitPlayer: string[], permitCapturer: string[]}}
 */
export function normalizePermitInfo(response) {
  const source = response && typeof response === 'object' ? response : {}
  return {
    deviceId: normalizePermitId(source.DeviceID),
    notSet: Number(source.Result) === 1,
    permitGroup: normalizePermitIds(source.PermitGroup),
    permitPlayer: normalizePermitIds(source.PermitPlayer),
    permitCapturer: normalizePermitIds(source.PermitCapturer)
  }
}

/** 三类是否都为空（= 保存后会**清除**该设备的权限数据） */
export function isPermitEmpty(permit) {
  const source = permit || {}
  return (
    normalizePermitIds(source.permitGroup).length === 0 &&
    normalizePermitIds(source.permitPlayer).length === 0 &&
    normalizePermitIds(source.permitCapturer).length === 0
  )
}

/**
 * 表单值 → 请求体。**总是带齐三个数组**：要清空就显式发 `[]`，语义最清楚
 * （后端只在字段为 null 时才会省略，`[]` 与「缺省」在手册里都算空，但显式更不容易误解）。
 * 顺手做规范：大写、去重、去空串；`deviceId` 只做 trim + 大写，格式交给 `validatePermitPayload`。
 */
export function buildPermitPayload(deviceId, permit) {
  const source = permit || {}
  return {
    deviceId: normalizePermitId(deviceId),
    permitGroup: normalizePermitIds(source.permitGroup),
    permitPlayer: normalizePermitIds(source.permitPlayer),
    permitCapturer: normalizePermitIds(source.permitCapturer)
  }
}

/** 三类清单的数量摘要：`分组 2 项 · 终端 5 项 · 采播器 1 项` / `三类都为空（= 清除权限数据）` */
export function permitSummary(permit) {
  const source = permit || {}
  const groups = normalizePermitIds(source.permitGroup)
  const players = normalizePermitIds(source.permitPlayer)
  const capturers = normalizePermitIds(source.permitCapturer)
  if (!groups.length && !players.length && !capturers.length) return '三类都为空（= 清除权限数据）'
  return `分组 ${groups.length} 项 · 终端 ${players.length} 项 · 采播器 ${capturers.length} 项`
}

// ---------------- 校验（页面在提交前拦住明显不合法的数据） ----------------

/**
 * 校验一份待提交的权限数据，返回错误文案数组（空数组 = 可以提交）。
 * 判据与后端 `DevicePermitSetRequestDto` 的校验注解一一对应，只是把 400 提前到前端：
 *   · `deviceId` 必须是 8 位十六进制（后端 `@NotBlank` + `@Pattern`）；
 *   · 每类清单 ≤ 248 项（`@Size(max = 248)`）；
 *   · 分组元素必须 FFFFFFxx；终端 / 采播器元素必须 8 位十六进制且不是 FFFFFFxx / 00000000（元素上的 `@Pattern`）；
 *   · 任一清单里不能出现该设备自身（`@AssertTrue isSelfNotPermitted`）。
 * ⚠️ 比后端**更严**的一点：后端的自身校验只覆盖终端 / 采播器两类，这里三类都查
 *    （分组 ID 写成 `FFFFFFxx` 时同样不可能等于设备自身，但要真出现也一定不是用户想要的）。
 * ⚠️ 「三类都为空」**不是错误**：手册里它是「清除权限数据」的语义，这里不报错（弹窗会做二次确认）。
 *
 * @param {{deviceId?: string, permitGroup?: string[], permitPlayer?: string[], permitCapturer?: string[]}} payload
 * @param {string} [deviceId] 目标设备 ID（不传时取 payload.deviceId）
 * @returns {string[]} 错误文案数组
 */
export function validatePermitPayload(payload, deviceId) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const errors = []
  const target = normalizePermitId(deviceId || source.deviceId)

  if (!isValidDeviceId(target)) {
    errors.push('设备 ID 必须是 8 位十六进制（例如 00001AB2）：请先选择要设置权限的设备')
  }

  const lists = [
    { key: 'permitGroup', label: '分组清单', format: HINT_GROUP_FORMAT, isValid: isValidPermitGroupId },
    { key: 'permitPlayer', label: '终端清单', format: HINT_DEVICE_FORMAT, isValid: isValidPermitDeviceId },
    { key: 'permitCapturer', label: '采播器清单', format: HINT_DEVICE_FORMAT, isValid: isValidPermitDeviceId }
  ]

  for (const item of lists) {
    const ids = normalizePermitIds(source[item.key])
    if (ids.length > PERMIT_LIST_MAX) {
      errors.push(`${item.label}超过上限：${HINT_LIST_MAX}（当前 ${ids.length} 项）`)
    }
    const invalid = ids.filter((id) => !item.isValid(id))
    if (invalid.length) {
      errors.push(`${item.label}里有格式不合法的 ID：${invalid.join('、')}。${item.format}`)
    }
    if (target && ids.includes(target)) {
      errors.push(`${item.label}里不能包含该设备自身（${target}）`)
    }
  }

  return errors
}

// ---------------- 候选项（从设备 / 分组列表生成，UI 里尽量只能选到真实存在的对象） ----------------

/** 按 value 去重（同一个 ID 出现在多个设备列表里时，保留第一次出现的来源说明） */
function dedupeOptions(options) {
  const result = []
  const seen = new Set()
  for (const option of options) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    result.push(option)
  }
  return result
}

/** 设备对象 → 下拉选项（value = 8 位 ID，label = 名称（ID），另带在线状态与来源说明） */
function toDeviceOption(device, source) {
  const value = normalizePermitId(device && device.DeviceID)
  if (!isValidDeviceId(value)) return null
  const state = getDeviceState(device.State)
  const deviceType = normalizeCode(device.DeviceType)
  const typeName = DEVICE_TYPES_NEED_PERMIT[deviceType] || getDeviceTypeName(deviceType)
  const deviceName = device.DevName || '未命名'
  return {
    value,
    label: `${deviceName}（${value}）`,
    deviceName,
    deviceType,
    typeText: typeName ? `${deviceType} · ${typeName}` : '',
    stateText: state.text,
    stateTag: state.tag,
    source
  }
}

/** 一组设备列表 → 选项数组（设备 ID 不是 8 位十六进制的直接跳过；不去重，由调用方决定） */
function toDeviceOptions(devices, source) {
  return (Array.isArray(devices) ? devices : [])
    .map((device) => toDeviceOption(device, source))
    .filter(Boolean)
}

/**
 * `PermitGroup` 候选项：来自（终端）分组列表。
 * value 直接用 **FFFFFFxx**（写进 NAS 的形式），label 里同时给出分组 ID、名称与「私有分组」提醒。
 */
export function buildPermitGroupOptions(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      const groupId = normalizePermitId(group && group.GroupID)
      const value = toTaskPlayerId(groupId) // 复用分组模块的「2 位 → FFFFFFxx」扩展
      if (!value) return null
      const creater = describeGroupCreater(group.Creater)
      const groupName = group.GroupName || '未命名分组'
      return {
        value,
        groupId,
        groupName,
        label: `${groupId} · ${groupName}`,
        createrText: creater.text,
        private: isPrivateGroup(group)
      }
    })
    .filter(Boolean)
}

/** `PermitPlayer` 候选项：播放终端列表（手册 P19：Player 里的终端都可选，含对讲话筒终端 5F / 9F） */
export function buildPlayerOptions(devices) {
  return dedupeOptions(toDeviceOptions(devices, '播放终端'))
}

/**
 * `PermitCapturer` 候选项。手册 P19 允许的范围对应三处来源：
 *   · 被动采播器 —— `capturer` 列表全部；
 *   · 支持被动启动（`Passive = 1`）的主动采播器 —— `actCapturer` 里类型属于 `PASSIVE_ACT_CAPTURER_TYPES`
 *     （1E / 2E / 4E / CE）的那些。⚠️ 后端 `DeviceItemDto` 没有透出 `Passive` 字段，这里按手册给出的
 *     类型表做等价筛选（原因见文件头说明）；
 *   · 对讲面板 / 对讲话筒（类型 5E / 6E）—— 这类设备可能落在主动采播或主动插播列表里，两处都扫。
 *
 * @param {{capturer?: Array, actCapturer?: Array, actRequester?: Array}} lists 设备列表（NAS 原始字段）
 * @returns {Array} 去重后的候选项（每一项的 `source` 说明它来自哪一类）
 */
export function buildCapturerOptions(lists = {}) {
  const capturers = toDeviceOptions(lists.capturer, '被动采播器')
  const passiveAct = toDeviceOptions(lists.actCapturer, '被动启动的主动采播器').filter((item) =>
    PASSIVE_ACT_CAPTURER_TYPES.includes(item.deviceType)
  )
  const talkers = toDeviceOptions(lists.actRequester, '对讲设备').filter((item) =>
    TALK_CAPTURER_TYPES.includes(item.deviceType)
  )
  return dedupeOptions([...capturers, ...passiveAct, ...talkers])
}

/**
 * 「可能需要权限数据」的候选设备：把四类设备列表合起来，筛出 `DEVICE_TYPES_NEED_PERMIT` 里的类型。
 * ⚠️ 为什么在本地筛：后端只有 4 个「按设备类别取列表」的接口，没有「按 DeviceType 筛」的接口，
 *    所以「新增权限数据」之前必须先把设备列表拉全（页面进入时会补齐这四类）。
 */
export function buildPermitDeviceCandidates(lists = {}) {
  const options = [
    ['player', '播放终端'],
    ['capturer', '被动采播器'],
    ['actCapturer', '主动采播设备'],
    ['actRequester', '主动插播设备']
  ].flatMap(([key, label]) => toDeviceOptions(lists[key], label))

  return dedupeOptions(options.filter((item) => needsPermitDeviceType(item.deviceType)))
}

/**
 * 设备 ID → 设备对象（列表页用它把目录里的设备 ID 换成名称 / 在线状态）。
 * 同一个 ID 出现在多个列表时取第一次出现的那个（同一台设备在各列表里的字段是一致的）。
 */
export function buildDeviceIndex(lists = {}) {
  const index = {}
  for (const key of ['player', 'capturer', 'actCapturer', 'actRequester']) {
    for (const device of Array.isArray(lists[key]) ? lists[key] : []) {
      const id = normalizePermitId(device && device.DeviceID)
      if (id && !index[id]) index[id] = device
    }
  }
  return index
}
