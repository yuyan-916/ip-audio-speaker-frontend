// src/api/priority.js —— 任务优先级（任务请求源优先策略）模块接口
//
// 后端对应 PriorityController，契约见 ip-audio-speaker-backend/docs/API.md「任务优先级模块」，
// 上游（NAS 手册）见同项目 docs/impl-notes.md §七（P81-84）。
//
//   GET  /api/priority   获取任务源优先策略（13 个任务类，每类一条 { TaskClass, TCPriority, TCRule }）
//   POST /api/priority   设置任务源优先策略（⚠️ **部分更新**：只影响请求里出现的任务类）
//
// 这一层只负责「路径 + 参数」，不做任何判断：
//   · HTTP 层错误由 src/api/request.js 的拦截器抛 Error 并弹全局提示；
//   · HTTP 200 但 `Result !== 0`（NAS 业务拒绝）由 store 用 assertNasOk 断言后抛 NasResultError。
//
// ⚠️ 两个最容易踩的点：
//   1) 请求体外面**还包了一层 `data` 数组**（后端 SetTaskPriorityRequestDto 里 `@NotEmpty` 的就是它），
//      直接发一个裸数组会被 400 拒掉；
//   2) `tcPriority` 的接口取值是 **1~16**，而 NAS 实际执行时用 **0~15**（比接口值小 1）。
//
// ⚠️ 大小写（README §五 1）：请求体按约定发小驼峰（taskClass / tcPriority / tcRule），
//    响应是 NAS 风格大驼峰（TaskClass / TCPriority / TCRule）。后端开了大小写不敏感匹配，
//    两种写法都能绑定；这里统一按「请求小驼峰、响应对照着 NAS 读」来写。

import request from './request'

/**
 * 获取任务源优先策略（只读，无参数）。
 *
 * @returns {Promise<{DataType: string, Result: number, Data: Array<{TaskClass: number, TCPriority: number, TCRule: number}>}>}
 *          `Data` 每个任务类一条（`TaskClass` 1~13，含义见 constants/priority.js 的 `TASK_CLASSES`）；
 *          ⚠️ 手册没给这个查询接口的 Result 码表，未收录的码走通用码兜底
 */
export function getPriority() {
  return request.get('/priority')
}

/**
 * 设置任务源优先策略（**部分更新**）。
 *
 * 只把要改的任务类放进 `data`：未出现的任务类**保持不变**（不是「清空」）。
 * 空数组会被后端 400 拒（`@NotEmpty`），所以调用方要先确认真的改过东西。
 *
 * @param {Array<{taskClass: number, tcPriority: number, tcRule: number}>} data
 *        至少一条；`taskClass` 1~13（14~16 保留勿用）；`tcPriority` 1~16；`tcRule` 0 原任务优先 / 1 新任务优先
 * @returns {Promise<{DataType: string, Result: number}>} DataType = `SetTaskPriorityAck`
 */
export function setPriority(data) {
  return request.post('/priority', { data })
}
