// src/constants/priority.js —— 任务优先级（任务请求源优先策略）的枚举字典与纯函数（不含请求）
//
// 取值来源：后端 `docs/impl-notes.md` §七（任务优先级，NAS 手册 P81-84），对外契约见
// `backend/docs/API.md` 的「任务优先级模块」。查询与设置共用同一个元素结构：
// **TaskClass**（任务类 1~13）/ **TCPriority**（任务类主优先级 1~16）/ **TCRule**（处理规则 0/1）。
//
// ⚠️ 这个模块只有 13 行数据，但很容易搞错的三件事（UI 上必须写清）：
//   1) `TCPriority` 的**接口取值是 1~16**（越大越优先），而 NAS **实际执行时用 0~15**（比接口值小 1）——
//      它正好是运行态 `TaskPriority`（4 位十六进制）的 bit15:12 那一段（见 constants/task.js 的拆解）；
//   2) 设置是**部分更新**：只影响请求里出现的任务类，未出现的任务类保持不变（不是「清空」）；
//   3) 优先等级**只在同一任务类内比较**，不是全局优先级；一个任务的最终优先级 =
//      **任务类主优先级（本页设置）+ 提交时申请的优先等级（`Priority` 0~15，见 /tasks）+ 同类任务的提交顺序**。
//
// ⚠️ 13 个任务类是**固定的**（1~13；14~16 是保留值，手册明确「勿用」），既不能增也不能删，
//    所以本模块的表格恒为 13 行 —— NAS 少返回哪一类，就补成空行让用户自己填，而不是少显示一行。
// ⚠️ 本后端（HTTP API）提交的临时任务固定属于**任务类 11「第三方软件插播」**
//    （手册 P82-84 / API.md），所以改第 11 行会直接影响 /tasks 里提交的任务。

/** 13 个任务类（NAS 手册 P82；14~16 是保留值，因此只列 1~13） */
export const TASK_CLASSES = {
  1: '自动定时任务',
  2: '普通寻呼对讲话筒',
  3: '主动采播设备',
  4: '紧急主动采播设备',
  5: '消防控制设备',
  6: '无线电遥控设备',
  7: '网络点播设备',
  8: '管理软件插播',
  9: '分控软件插播',
  10: '特定寻呼话筒',
  11: '第三方软件插播',
  12: '对讲面板',
  13: '主动（对讲）终端'
}

/** 任务类取值范围 1~13（14~16 保留勿用，其他值 NAS 会报错） */
export const TASK_CLASS_MIN = 1
export const TASK_CLASS_MAX = 13
/** 固定的 13 个任务类（表格恒为这么多行） */
export const TASK_CLASS_COUNT = Object.keys(TASK_CLASSES).length
/** 保留值（手册：保留勿用）—— 只用于文案说明，不参与任何比较 */
export const TASK_CLASS_RESERVED = [14, 15, 16]
/** 本后端（HTTP API）提交的临时任务固定属于的任务类 */
export const TEMP_TASK_CLASS = 11

/** 按 1~13 顺序排列的任务类清单（表格 / 下拉都遍历它） */
export const TASK_CLASS_OPTIONS = Object.keys(TASK_CLASSES).map((key) => ({
  value: Number(key),
  label: TASK_CLASSES[key]
}))

/** `TC` = Task Class：`TCPriority` 的接口取值范围 1~16（越大越优先） */
export const TCPRIORITY_MIN = 1
export const TCPRIORITY_MAX = 16
/**
 * ⚠️ NAS **实际执行**时用的范围：接口值 -1，即 0~15。
 * 这两个常量只用于提示文案，校验一律用 TCPRIORITY_MIN / MAX（接口值口径）。
 */
export const EXECUTED_PRIORITY_MIN = TCPRIORITY_MIN - 1
export const EXECUTED_PRIORITY_MAX = TCPRIORITY_MAX - 1

/** 处理规则（`TCRule`）：0 原任务优先 / 1 新任务优先（其他取值 NAS 会强制成 1） */
export const TC_RULES = {
  0: '原任务优先',
  1: '新任务优先'
}

/** 处理规则的单选项（hint 说明冲突时的取舍） */
export const TC_RULE_OPTIONS = [
  {
    value: 0,
    label: '原任务优先',
    hint: '同一任务类冲突时，保留「已经在执行的原任务」'
  },
  {
    value: 1,
    label: '新任务优先',
    hint: '同一任务类冲突时，让「新提交的任务」优先（NAS 对非法取值也强制成它）'
  }
]

// ---------------- 提示文案（页面直接渲染，保证各页面口径一致） ----------------

/** 接口值是 1~16，实际执行用 0~15 */
export const HINT_1_TO_16 = `接口值 ${TCPRIORITY_MIN}~${TCPRIORITY_MAX}，实际执行时用 ${EXECUTED_PRIORITY_MIN}~${EXECUTED_PRIORITY_MAX}（比接口值小 1）`
/** 部分更新语义 */
export const HINT_PARTIAL_UPDATE = '只影响请求里出现的任务类，未出现的保持不变'
/** 只在同类内比较 */
export const HINT_SAME_CLASS_ONLY = '优先等级只在同一任务类内比较，不是全局优先级'
/** 最终优先级由三部分共同决定 */
export const HINT_FINAL_PRIORITY =
  '任务的最终优先级 = 任务类主优先级（本页设置）+ 提交时申请的优先等级（0~15，见「任务管理」）+ 同类任务的提交顺序'
/** 14~16 保留勿用 */
export const HINT_RESERVED_CLASS = `任务类 14~16 是保留值（手册：保留勿用），所以只列 ${TASK_CLASS_MIN}~${TASK_CLASS_MAX} 这 ${TASK_CLASS_COUNT} 类`
/** 任务类 11 的特殊性 */
export const HINT_TEMP_TASK_CLASS = `本后台（HTTP API）提交的临时任务固定属于第 ${TEMP_TASK_CLASS} 类「${TASK_CLASSES[TEMP_TASK_CLASS]}」，改它会影响这些任务`
/** 一行没填齐就不能保存（后端三项都必填） */
export const HINT_TWO_FIELDS_REQUIRED = '主优先级与处理规则都是必填项，缺一项后端会直接拒（HTTP 400）'

// ---------------- 校验与文案 ----------------

/** 任务类是否合法（1~13） */
export function isValidTaskClass(value) {
  const num = Number(value)
  return Number.isInteger(num) && num >= TASK_CLASS_MIN && num <= TASK_CLASS_MAX
}

/** 任务类中文名（非法返回空串，便于调用方自己决定怎么显示） */
export function taskClassName(value) {
  return TASK_CLASSES[Number(value)] || ''
}

/** 任务类：`11 · 第三方软件插播`（非法时显示原始值并标注未知） */
export function describeTaskClass(value) {
  const name = taskClassName(value)
  return name ? `${Number(value)} · ${name}` : `未知任务类（${value}）`
}

/**
 * 主优先级（接口值）是否合法：**1~16**。
 * ⚠️ 不要用执行值 0~15 校验 —— `0` 在接口层是非法值（NAS 会拒）；
 *    没填（null / undefined / 空串）自然也在这里被挡掉（`Number(null) === 0` 也不是合法值）。
 */
export function isValidTCPriority(value) {
  if (value == null || value === '') return false
  const num = Number(value)
  return Number.isInteger(num) && num >= TCPRIORITY_MIN && num <= TCPRIORITY_MAX
}

/** 处理规则是否合法（0 原任务优先 / 1 新任务优先） */
export function isValidTCRule(value) {
  // ⚠️ 必须先挡掉 null / 空串：`Number(null) === 0`，否则「没填」会被当成合法的「0 原任务优先」
  if (value == null || value === '') return false
  const num = Number(value)
  return num === 0 || num === 1
}

/** 处理规则中文名（非法时显示原始值并标注未知） */
export function describeTCRule(value) {
  return TC_RULES[Number(value)] || `未知处理规则（${value}）`
}

/**
 * 接口值 → NAS 实际执行值（接口值 -1）。
 * @returns {number|null} 越界 / 未填时返回 null
 */
export function executedPriority(value) {
  return isValidTCPriority(value) ? Number(value) - 1 : null
}

/** 执行值文案：`实际执行 4` / `（主优先级未设置）` */
export function describeExecutedPriority(value) {
  const executed = executedPriority(value)
  return executed == null ? '（主优先级未设置）' : `实际执行 ${executed}`
}

/** 主优先级文案：`5（执行 4）` / `未设置` */
export function formatTCPriority(value) {
  return isValidTCPriority(value) ? `${Number(value)}（执行 ${executedPriority(value)}）` : '未设置'
}

// ---------------- 归一化（NAS 原始数据 → 固定 13 行的表格数据） ----------------

/**
 * 一行三项是否都填齐。
 * ⚠️ 后端 SetTaskPriority 的三个字段都是 `@NotNull`：缺任何一项都是 HTTP 400，
 *    所以「改过但没填齐」的行必须由页面拦住，不能提交。
 */
export function isCompletePriorityRule(row) {
  const source = row || {}
  return (
    isValidTaskClass(source.taskClass) &&
    isValidTCPriority(source.tcPriority) &&
    isValidTCRule(source.tcRule)
  )
}

/**
 * NAS 原始条目 → 表格行（保留原始三项 + 本地判断用的字段）。
 * 缺失 / 越界时 `tcPriority`、`tcRule` 为 `null`，页面显示「NAS 未返回」并允许用户补填。
 * 行里不放任务类中文名：展示一律走 `describeTaskClass(row.taskClass)`，免得同一个名字有两份来源。
 */
export function normalizePriorityRule(item) {
  const source = item && typeof item === 'object' ? item : {}
  const taskClass = Number(source.TaskClass)
  return {
    taskClass,
    tcPriority: isValidTCPriority(source.TCPriority) ? Number(source.TCPriority) : null,
    tcRule: isValidTCRule(source.TCRule) ? Number(source.TCRule) : null,
    /** NAS 是否返回了这一类（false = 这一类还没有策略，需要自己填） */
    returned: source.TaskClass != null
  }
}

/**
 * NAS 列表 → **固定 13 行**的表格数据（顺序恒为 1~13）。
 * ⚠️ 任务类是固定的，NAS 少给哪一类就补成空行（`returned: false`），不能因此少显示一行 ——
 *    否则用户没法给缺的那一类设置策略。重复的任务类只取第一条。
 */
export function normalizePriorityRules(list) {
  const byClass = new Map()
  const source = Array.isArray(list) ? list : []
  source.forEach((item) => {
    const row = normalizePriorityRule(item)
    if (isValidTaskClass(row.taskClass) && !byClass.has(row.taskClass)) byClass.set(row.taskClass, row)
  })
  return TASK_CLASS_OPTIONS.map(({ value }) => {
    return byClass.get(value) || { taskClass: value, tcPriority: null, tcRule: null, returned: false }
  })
}

// ---------------- 变更检测与提交（部分更新：只提交改过的行） ----------------

/** 把值转成可比较的数字（null / 空串 → null，非数字 → null） */
function toComparableNumber(value) {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** 两个值（可能是 null）在数值上是否相同 —— 用 `Number(null) === 0` 判会误判成「相等」 */
function sameNumber(left, right) {
  return toComparableNumber(left) === toComparableNumber(right)
}

/** 任务类 → 行 的索引（`baselineRows` 恒有 13 行，但调用方可能传空数组） */
function indexByClass(rows) {
  const map = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const taskClass = Number(row && row.taskClass)
    if (!map.has(taskClass)) map.set(taskClass, row)
  })
  return map
}

/** 这一行相对基线有没有被改过（只比较会被提交的两项：tcPriority / tcRule） */
export function isPriorityRuleChanged(row, baseline) {
  if (!row || !baseline) return false
  return (
    !sameNumber(row.tcPriority, baseline.tcPriority) || !sameNumber(row.tcRule, baseline.tcRule)
  )
}

/**
 * 相对基线**改过且三项都齐**的行 → POST /api/priority 的 `data` 元素数组。
 *
 * ⚠️ 为什么必须跟基线比对，而不是把 13 行全发上去：NAS 侧是**部分更新**（发哪一类就覆盖哪一类的三项），
 *    提交没改过的行虽然结果一样，但会平白多写一遍 —— 万一期间有别的会话（管理软件 / 其它客户端）
 *    改过同一类，就会把它悄悄覆盖回去。**只提交真正改过的行**才是这个接口的正确用法。
 * ⚠️ 改过但没填齐的行**不会**被偷偷补默认值，而是由 `pendingPriorityRows` 返回给页面拦住保存。
 *
 * @returns {Array<{taskClass: number, tcPriority: number, tcRule: number}>} 没有变更时是空数组
 */
export function changedPriorityRules(rows, baselineRows) {
  const baseByClass = indexByClass(baselineRows)
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      return isCompletePriorityRule(row) && isPriorityRuleChanged(row, baseByClass.get(Number(row && row.taskClass)))
    })
    .map((row) => ({
      taskClass: Number(row.taskClass),
      tcPriority: Number(row.tcPriority),
      tcRule: Number(row.tcRule)
    }))
}

/**
 * 改过但**没填齐**的行（页面据此提示「第 N 类还没填完」并禁用保存按钮）。
 * @returns {Array} 行本身（不是 payload）
 */
export function pendingPriorityRows(rows, baselineRows) {
  const baseByClass = indexByClass(baselineRows)
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    return !isCompletePriorityRule(row) && isPriorityRuleChanged(row, baseByClass.get(Number(row && row.taskClass)))
  })
}

/**
 * 单行变更摘要（保存前的确认框逐行列出）：
 * `11 · 第三方软件插播：主优先级 4（执行 3） → 5（执行 4）；处理规则 原任务优先 → 新任务优先`
 * @returns {string} 没变更时返回空串
 */
export function describePriorityChange(row, baseline) {
  const parts = []
  if (!sameNumber(row && row.tcPriority, baseline && baseline.tcPriority)) {
    parts.push(`主优先级 ${formatTCPriority(baseline && baseline.tcPriority)} → ${formatTCPriority(row && row.tcPriority)}`)
  }
  if (!sameNumber(row && row.tcRule, baseline && baseline.tcRule)) {
    const before = isValidTCRule(baseline && baseline.tcRule) ? describeTCRule(baseline.tcRule) : '未设置'
    const after = isValidTCRule(row && row.tcRule) ? describeTCRule(row.tcRule) : '未设置'
    parts.push(`处理规则 ${before} → ${after}`)
  }
  if (!parts.length) return ''
  return `${describeTaskClass(row && row.taskClass)}：${parts.join('；')}`
}
