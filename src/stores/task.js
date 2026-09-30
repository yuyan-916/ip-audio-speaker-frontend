// src/stores/task.js —— 运行中任务列表 / 提交 / 控制 / 轮询的仓库
//
// 为什么用 store：运行中任务要按 5 秒轮询，后面的「定时任务」页也要用同一份数据；
// 轮询开关也收在这里，页面只管开 / 关（离开页面时必须调 stopPolling()）。
//
// ⚠️ 轮询定时器的句柄放在**模块作用域**而不是 state：它不是给模板用的数据，放进 state 会被
//    Vue 的响应式代理包一层（没必要），而且页面的 state 里留着裸定时器容易漏清理。
//    state 里只放一个可读的 `polling` 标记。
// ⚠️ 轮询用 silent 加载，避免表格 loading 反复闪动；轮询这一次失败不额外提示（真正的链路错误
//    由 api/request.js 的拦截器提示），下一次轮询会自己重试。
//
// 两层错误的分工与其它 store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面提示。

import { defineStore } from 'pinia'
import {
  controlTask,
  getRunningTasks,
  getTaskWithDevice,
  stopAllTasks,
  submitTask
} from '@/api/task'
import { TASK_POLL_INTERVAL_MS } from '@/constants/task'
import { assertNasOk, nasList } from '@/utils/nas-result'

/** 轮询定时器句柄（模块级：见文件头说明，不进 state） */
let pollTimer = null

export const useTaskStore = defineStore('task', {
  state: () => ({
    /** 正在运行的任务（NAS 原始字段：TaskID / TaskSN / TaskName / TaskType / TaskState …） */
    runningTasks: [],
    /** 是否正在加载（只有非 silent 的加载会切它，轮询不切） */
    loading: false,
    /** 最近一次成功加载的时间戳（0 表示还没加载过） */
    lastLoadedAt: 0,
    /** 是否正在轮询的标记（真正的定时器在模块作用域） */
    polling: false
  }),

  getters: {
    /** 运行中任务数（列表页的计数与「停止全部」按钮的禁用状态都用它） */
    runningCount: (state) => state.runningTasks.length
  },

  actions: {
    /**
     * 拉取正在运行的任务列表 —— GET /api/tasks/running
     *
     * @param {{silent?: boolean}} [options] `silent`: 轮询 / 自动刷新时用，不切换 loading
     * @returns {Promise<Array>} 任务列表 —— **空数组是正常情况**（页面要显示「当前没有正在运行的任务」）
     */
    async fetchRunning(options = {}) {
      if (!options.silent) this.loading = true
      try {
        const list = nasList(await getRunningTasks(), 'taskList', '获取运行中任务')
        this.runningTasks = list
        this.lastLoadedAt = Date.now()
        return list
      } finally {
        if (!options.silent) this.loading = false
      }
    },

    /**
     * 开启轮询（会先停掉上一次，避免重复调用叠出多份定时器）。
     * @param {number} [intervalMs] 间隔毫秒，缺省 5 秒（TASK_POLL_INTERVAL_MS）
     */
    startPolling(intervalMs = TASK_POLL_INTERVAL_MS) {
      this.stopPolling()
      const interval = Number(intervalMs) > 0 ? Number(intervalMs) : TASK_POLL_INTERVAL_MS
      this.polling = true
      pollTimer = setInterval(() => {
        // 轮询失败只吞掉：一次失败不该弹一屏错误，下一次轮询会自己重试
        this.fetchRunning({ silent: true }).catch(() => {})
      }, interval)
    },

    /** 停止轮询（离开页面 / 关掉开关时调用；没在轮询时是空操作） */
    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      this.polling = false
    },

    /**
     * 查询指定设备参与的任务 —— GET /api/tasks/with-device/{deviceId}
     *
     * 结果**故意不放进 state**：它只服务于「任务管理」页下半部分的临时查询，换个设备就要重查，
     * 没有跨页面共享的价值 —— 页面自己接返回值存一份就行。
     *
     * @param {string} deviceId 8 位十六进制设备 ID
     * @returns {Promise<object>} 响应体；**没有相关任务时除 DataType / Result 外字段全缺**
     *   （页面必须先判空，用 constants/task.js 的 hasTaskWithDevice）
     */
    async fetchWithDevice(deviceId) {
      return assertNasOk(
        await getTaskWithDevice(deviceId),
        'taskWithDevice',
        '查询设备参与的任务'
      )
    },

    /**
     * 提交临时任务 —— POST /api/tasks/submit
     *
     * 成功后顺手**静默刷新一次运行中列表**（临时任务通常立即开始，用户马上能在列表里看到）；
     * 刷新失败不影响「提交成功」这个结论，所以这里吞掉刷新异常。
     *
     * @param {object} payload 请求体（字段说明见 api/task.js）
     * @returns {Promise<{taskId: string, taskSn: string, response: object}>}
     *   ⚠️ taskId 与 taskSn 要**成对保存**：控制这条任务（停止 / 调音量 / 暂停 / 下一曲）必须两者都给。
     */
    async submit(payload) {
      const response = assertNasOk(await submitTask(payload), 'taskSubmit', '提交任务')
      const taskId = String(response.TaskID == null ? '' : response.TaskID).trim().toUpperCase()
      const taskSn = String(response.TaskSN == null ? '' : response.TaskSN).trim().toUpperCase()
      await this.fetchRunning({ silent: true }).catch(() => {})
      return { taskId, taskSn, response }
    },

    /**
     * 任务控制 —— POST /api/tasks/control
     *
     * @param {{taskId: string, taskSn: string, taskCmd: number, taskCmdPara?: number}} payload
     *   ⚠️ `taskSn` 不能是 00000000（NAS 会拒绝）；要停全部请用 stopAll()，不要在这里发命令字 6。
     */
    async control(payload) {
      assertNasOk(await controlTask(payload), 'taskControl', '控制任务')
      await this.fetchRunning({ silent: true }).catch(() => {})
    },

    /**
     * 停止所有正在运行的任务 —— POST /api/tasks/stop-all
     *
     * ⚠️ 会停掉系统上**所有**任务（含管理软件 / 定时任务 / 其它用户提交的）→ 页面上必须二次确认。
     */
    async stopAll() {
      assertNasOk(await stopAllTasks(), 'taskControl', '停止全部任务')
      await this.fetchRunning({ silent: true }).catch(() => {})
    }
  }
})