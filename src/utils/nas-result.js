// src/utils/nas-result.js —— HTTP 200 但 Result !== 0 的「NAS 业务拒绝」统一处理
//
// 背景（本项目特有，与 src/api/request.js 顶部的说明配套）：
//   · HTTP 4xx / 5xx —— 链路或后端错误，axios 响应拦截器已经统一转成 Error 并弹全局提示；
//   · HTTP 200 且响应体 `Result !== 0` —— NAS 业务层拒绝了这次操作，**不是 HTTP 错误**，
//     拦截器不会抛异常。若每个页面各写一遍 `if (res.Result !== 0)` 既啰嗦又容易漏。
// 于是把这一层收敛到这里：store / 页面只需 `assertNasOk(res, '码表名', '动作名')`。
//
// Result 码表来源：后端 docs/impl-notes.md §十二（NAS 手册 P9-14 的响应约定）与 §十四 2 / 3
// （媒体文件、播放列表），以及 §四 / §五（定时任务、定时程序），逐条抄录；手册更新时同步改这里即可。
// ⚠️ 例外（手册没给独立码表的接口）：终端分组；媒体文件 / 播放列表的**列表**接口；
//    任务模块的**列表**（taskList）与设备任务查询（taskWithDevice）；定时任务模块的**两个查询接口**
//    （timingTaskList / timingProgramInfo）——都没有码表，一律走 COMMON_RESULT_MESSAGES 兜底
//    （见 RESULT_TABLES 内的说明）。

/** 各接口共有的 Result 码（2/3/4/5/8 的语义每个接口都不同，所以只列真正通用的几个） */
const COMMON_RESULT_MESSAGES = {
  1: 'NAS 不识别请求类型（DataType 不符）',
  6: 'NAS 无法识别请求中的字段',
  7: 'NAS 执行失败（其他错误）'
}

/**
 * 各操作的 Result 码表，key 与 `assertNasOk` 的第二个参数一致。
 * 只列「0 成功」之外的码。
 */
export const RESULT_TABLES = {
  // POST /api/devices/volume → DeviceSetVolAck
  volume: {
    2: '音量超出取值范围（0 ~ 127）',
    3: '请求缺少设备 ID',
    4: '请求缺少音量值',
    8: '终端不存在（可能已离线或已被删除）'
  },
  // POST /api/devices/delete → DeviceSetDeleteAck
  delete: {
    2: '设备类别（devClass）取值错误',
    3: '请求缺少设备 ID',
    5: '该类别下不存在此设备 ID',
    8: '设备在线，无法删除（只能删除离线或历史设备）'
  },
  // POST /api/devices/reconfig → DeviceSetReconfigAck
  reconfig: {
    3: '请求缺少设备 ID',
    4: '请求缺少设备名称',
    5: '设备不在线，无法改名',
    8: '设备 ID 不存在'
  },
  // POST /api/devices/dummy → DeviceSetAddAck
  dummy: {
    2: '设备类别（devClass）取值错误',
    3: '请求缺少设备 ID',
    4: '设备 ID 取值错误（需为 8 位十六进制，且高 5 位与系统一致、低 3 位未占用）',
    5: '该设备 ID 已存在',
    8: '设备数量已达上限'
  },
  // POST /api/media/system|alarm/delete → DeleteFileAck
  // （来源：NAS 手册 P24-25，见后端 docs/impl-notes.md §十四 2；
  //   1=DataType 不符、6=无法识别字段 用通用码）
  mediaDelete: {
    3: '请求缺少文件 ID',
    4: '请求缺少文件名',
    7: 'NAS 删除失败（文件可能正在被任务或播放列表使用）',
    8: 'NAS 拒绝删除（文件 ID 不存在，或文件名与列表里的原名不一致）'
  },
  // POST /api/media/{system|alarm}/upload → UploadFileCloseAck
  // （来源：NAS 手册 P27-28。注意：NAS 拒绝 Open 或写数据失败时后端直接返回 HTTP 502，
  //   根本走不到这里；能走到这儿的只有「上传已结束但没成功」的两种情况）
  mediaUpload: {
    7: 'NAS 上传异常，文件没有进入媒体清单（需要重新上传）',
    8: 'NAS 添加到媒体清单失败（文件已关闭、上传过程已结束，需要重新上传）'
  },
  // POST /api/playlists/new|edit|delete → FilePlayListNewAck / FilePlayListEditAck / FilePlayListSetAck
  // （来源：NAS 手册 P32-34；三个操作共用同一张码表。手册给出的是 0~8 的完整名单，仓库内
  //   只核对了「0 成功 / 8 被服务器拒绝」，3 / 4 按同族 Set 接口（device volume / delete、
  //   媒体删除）的同样编号推断为「缺第 1 / 2 个必填字段」；2 / 5 的语义未经核对 → 不在表里，
  //   未收录的码会显示「未知的结果码 Result=N」，便于照手册人工排查）
  playlist: {
    3: '请求缺少播放列表 ID（PlayListID：2 位十六进制）',
    4: '请求缺少播放列表名称（PlayListName）',
    8: 'NAS 拒绝操作（ID 不存在，或名称与列表里的原名不一致）'
  },
  // ⚠️ 媒体文件 / 播放列表的**列表**接口这里**故意没有留空表**：
  //    手册的列表章节只给出字段，没有列 Result 码，仓库内也无据可查。
  //    调用 nasList 时传的 tableName 是 'mediaList' / 'playListList'，未收录 → 走通用码兜底。

  // POST /api/tasks/submit → TempTaskAck
  // （来源：NAS 手册 P64-65「提交临时任务」的应答表，逐条抄录；见后端 docs/impl-notes.md §三）
  // ⚠️ 本表里 2 / 3 / 4 / 5 都是**请求内容有问题**：其中 taskType 只支持 0 / 1 / 7（对讲 3 会落到 2），
  //    文字语音的 voiceText 超过 358 个 GBK 字节也会落到 2。
  taskSubmit: {
    2: '任务类型 / 启停模式 / 日期时间缺失或越界（taskType 只支持 0 文件播放 / 1 采播 / 7 文字语音）',
    3: '缺少播放内容或内容为空（文件播放缺 fileList、采播缺 capturerId、文字语音缺 voiceText）',
    4: '缺少播放目标或播放清单为空（playerList 必填，且至少 1 项）',
    5: '时间设置异常（如起始时间已过、结束时间与所选时间模式不匹配）',
    8: 'NAS 拒绝提交（内容或播放目标不合法，如超过 180 项文件 / 248 项目标上限）'
  },

  // POST /api/tasks/control（及 /api/tasks/stop-all）→ TaskExecCtrlAck
  // （来源：NAS 手册 P67-68「任务控制」的应答表，逐条抄录）
  // ⚠️ 8 的两种常见原因都写进去了：TaskID + TaskSN 对不上（任务已结束 / 从没存在过），
  //    或者 TaskSN 填了 00000000（手册明确「为 0 时命令无效」）。
  taskControl: {
    2: '参数越界（taskCmd / taskCmdPara 取值不合法）',
    3: '缺少 TaskID 或 TaskSN（控制具体任务时两者必须都给）',
    4: '缺少 TaskCmdPara（命令字 7 没给音量，或命令字 9 没给动作）',
    8: 'NAS 拒绝执行（TaskID + TaskSN 对应的任务不存在，或 TaskSN 为 00000000）'
  },

  // ⚠️ 任务模块的两个**查询**接口也**故意没有留空表**：
  //    GET /api/tasks/running（TaskExecList）与 GET /api/tasks/with-device/{deviceId}
  //    （TaskExecWithDevice）——手册这两节只给字段表、没有列 Result 码。
  //    调用时传的 tableName 是 'taskList' / 'taskWithDevice'，未收录 → 走通用码兜底。

  // POST /api/timing/tasks/new|edit|delete → TimingTaskNewAck / TimingTaskEditAck / TimingTaskDeleteAck
  // （来源：NAS 手册 P39-44「新建 / 编辑 / 删除定时任务」的应答表，见后端 docs/impl-notes.md §四 2；三个操作共用）
  // ⚠️ 同一编号在三处的含义略有差别：2 在新建时是「缺 ProgramIndex」，编辑 / 删除时是「缺 TaskIndex / TaskName」。
  timingTaskSet: {
    2: '缺少程序号 / 任务序号 / 任务名（新建要 programIndex，编辑与删除要 taskIndex，删除还要 taskName）',
    3: '时间与星期参数缺失或越界（startTime 必填、按星期循环的 weekDay 不能是 0000000、绝对时刻要 startDate）',
    4: '播放内容字段有问题（文件任务缺 fileList，或超过 180 项）',
    5: '播放目标字段有问题（playerList 必填，或超过 248 项）',
    8: 'NAS 拒绝执行（数量超限、任务序号不存在，或删除时 taskName 与 NAS 上的原名不一致）'
  },

  // POST /api/timing/program/config → TimingProgramConfigAck
  // （来源：NAS 手册 P47-51，见后端 docs/impl-notes.md §五 2）
  timingProgramConfig: {
    2: '程序名必须给满 16 个、程序组合必须给满 4 个（每个 16 位 0/1）',
    3: '时间段参数错误（静默时段 / 自动切换的日期时间不合法或区间颠倒）',
    4: '程序号越界（currentProgram / programIndex 都是 1~24），或 AutoProgIdx 重复',
    5: '段内字段不完整（例如静默时段只给了一半时间字段）',
    8: 'NAS 拒绝写入'
  },

  // POST /api/timing/program/set → TimingProgramSetAck（CLEAR / COPY / CUT 共用）
  // （来源：NAS 手册 P51-52，见后端 docs/impl-notes.md §五 3）
  timingProgramSet: {
    2: '缺少程序号或目标程序号（复制 / 剪切必须给 programIndex1）',
    3: '源程序与目标程序相同',
    4: '源程序号越界（1~16）',
    5: '目标程序号越界（1~16）',
    8: 'NAS 拒绝执行'
  },

  // ⚠️ 定时任务模块的两个**查询**接口也**故意没有留空表**：
  //    GET /api/timing/tasks/{programIndex}（TimingTaskList）与 GET /api/timing/program（TimingProgramInfo）
  //    —— 手册这两节只给出字段，没有列 Result 码。
  //    调用时传的 tableName 是 'timingTaskList' / 'timingProgramInfo'，未收录 → 走通用码兜底。

  // ⚠️ 终端分组（POST /api/groups/new|edit|delete → PlayerGroupNewAck / PlayerGroupSetAck）
  //    这里**故意没有留空表**：手册的分组章节（P19-23）只写明三个操作的必填字段，
  //    没有列出 Result 取值，仓库内也无据可查（见前端 README §八「已知限制」）。
  //    因此分组一律走 COMMON_RESULT_MESSAGES 兜底：未收录的码会显示
  //    「NAS 返回了未知的结果码 Result=N」，便于照着手册人工排障。
}

/** NAS 业务拒绝（HTTP 200 + Result !== 0）时抛出的错误，便于调用方分支处理 */
export class NasResultError extends Error {
  constructor(message, { result, dataType } = {}) {
    super(message)
    this.name = 'NasResultError'
    /** 原始 Result 码 */
    this.result = result
    /** 响应体里的 DataType（排障用，如 DeviceSetDeleteAck） */
    this.dataType = dataType
  }
}

/**
 * 业务是否成功：只有 `Result === 0` 算成功（顺带容错字符串 `"0"`）。
 * ⚠️ 必须先判空：`Number(null) === 0`，若写成 `Number(response && response.Result) === 0`，
 *    传进来 null / undefined 会被误判成「成功」。
 */
export function isNasOk(response) {
  if (!response || typeof response !== 'object') return false
  return Number(response.Result) === 0
}

/** Result 码 → 中文说明（先查接口专属码表，再查通用码，都没有则兜底） */
export function describeNasResult(response, tableName) {
  const result = Number(response && response.Result)
  const table = RESULT_TABLES[tableName] || {}
  return (
    table[result] ||
    COMMON_RESULT_MESSAGES[result] ||
    `NAS 返回了未知的结果码 Result=${result}`
  )
}

/**
 * 断言 NAS 业务成功，失败时抛 `NasResultError`。
 * @param {object} response 拦截器给出的响应体 `{ DataType, Result, Data }`
 * @param {string} tableName RESULT_TABLES 的 key（取该接口专属码表）
 * @param {string} actionLabel 动作名，用于拼提示语，如「设置音量失败：终端不存在」
 * @returns {object} 原样返回 response，便于链式使用
 */
export function assertNasOk(response, tableName, actionLabel = '操作') {
  if (isNasOk(response)) return response

  throw new NasResultError(`${actionLabel}失败：${describeNasResult(response, tableName)}`, {
    result: Number(response && response.Result),
    dataType: response && response.DataType
  })
}

/**
 * 断言成功并取出列表数据。
 * NAS 拒绝时先抛错，成功但 `Data` 缺失时返回空数组（避免页面到处写 `|| []`）。
 * @returns {Array}
 */
export function nasList(response, tableName, actionLabel) {
  assertNasOk(response, tableName, actionLabel)
  return Array.isArray(response.Data) ? response.Data : []
}
