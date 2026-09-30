// src/stores/timing.js —— 定时任务 / 定时程序模块的仓库
//
// 为什么用 store：定时任务页有两块**互相牵连**的数据 —— 某个程序的任务列表，以及全局只有一份的
// 「定时程序信息」（程序名 / 程序组合 / 当前执行程序 / 静默时段 / 自动切换）。
// 后者决定了前者的展示（程序下拉里的名字、静默期提示），而配置 / 清除 / 复制 / 剪切又会同时影响两者，
// 全放页面里会出现「谁先谁后」的拉取顺序问题。
//
// ⚠️ 缓存策略：任务列表按程序号分别缓存（`tasksByProgram`），切程序时不反复拉；
//    **任何写操作之后都强制重拉受影响的程序**（NAS 的 edit 是整体设置，本地拼出来的结果不可信），
//    清除 / 复制 / 剪切同时影响**源程序与目标程序**，两个都要重拉。
// ⚠️ 与其它 store 一样，这里**只断言 NAS 业务码**（assertNasOk）；HTTP 层错误交给 api/request.js 的拦截器。
//    两者都让异常继续上抛，由页面决定提示方式（页面只在 NasResultError 时再弹一次）。
//
// Result 码表（来源：后端 docs/impl-notes.md §四 / §五，逐条抄进 src/utils/nas-result.js）：
//   · timingTaskSet       —— TimingTaskSet（新建 / 编辑 / 删除共用一张表）
//   · timingProgramConfig —— TimingProgramConfig
//   · timingProgramSet    —— TimingProgramSet（清除 / 复制 / 剪切）
//   · 两个查询接口（timingTaskList / timingProgramInfo）手册没给码表 → 走通用码兜底。

import { defineStore } from 'pinia'
import {
  configTimingProgram,
  deleteTimingTask,
  editTimingTask,
  getTimingProgram,
  getTimingTasks,
  newTimingTask,
  setTimingProgram
} from '@/api/timing'
import {
  describeAutoProgram,
  describeCurrentProgram,
  describeSilenceTime,
  isValidProgramIndex,
  programOptions
} from '@/constants/timing'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const useTimingStore = defineStore('timing', {
  state: () => ({
    /** 当前正在看（也就是正在操作）的程序号 1~16 */
    currentProgramIndex: 1,
    /** 按程序号缓存的任务列表：{ [programIndex]: NAS 原始行[] } */
    tasksByProgram: {},
    /** 每个程序的任务列表最近一次成功加载的时间戳（0 / 缺失 = 还没加载过） */
    tasksLoadedAt: {},
    /** 定时程序信息（NAS 原始：ProgramName / ProgramComb / CurrentProgram / SilenceTime / AutoProgram）；null = 还没读过 */
    programInfo: null,
    /** 程序信息最近一次成功加载的时间戳 */
    programLoadedAt: 0,
    /** 任务列表是否正在加载（只有非 silent 的加载会切它） */
    loading: false,
    /** 程序信息是否正在加载 */
    programLoading: false
  }),

  getters: {
    /** `ProgramName` 数组（缺省空数组；它只是辅助显示，不作为标识） */
    programNames(state) {
      return Array.isArray(state.programInfo && state.programInfo.ProgramName)
        ? state.programInfo.ProgramName
        : []
    },

    /** 16 个程序的下拉选项（带程序名） */
    programSelectOptions() {
      return programOptions(this.programNames)
    },

    /** 当前程序号对应的标签：`程序 3｜夏季` */
    currentProgramLabel() {
      const option = this.programSelectOptions.find((item) => item.value === Number(this.currentProgramIndex))
      return option ? option.label : `程序 ${this.currentProgramIndex}`
    },

    /** 当前程序的任务列表（没加载过就是空数组） */
    currentTasks(state) {
      const rows = state.tasksByProgram[state.currentProgramIndex]
      return Array.isArray(rows) ? rows : []
    },

    /** 当前程序的任务条数 */
    currentTaskCount() {
      return this.currentTasks.length
    },

    /** 当前程序里被禁用的任务条数（禁用只是不执行，单独提示） */
    disabledTaskCount() {
      return this.currentTasks.filter((item) => Number(item && item.Disable) === 1).length
    },

    /** 「当前执行程序」的可读描述（1~16 程序名 / 17~19 固定组合 / 20 无程序 / 21~24 自定义组合） */
    currentProgramDesc(state) {
      return describeCurrentProgram(state.programInfo && state.programInfo.CurrentProgram, this.programNames)
    },

    /** 四条程序组合编码（恒为 4 条；没读过就是空数组） */
    programCombs(state) {
      const list = state.programInfo && state.programInfo.ProgramComb
      return Array.isArray(list) ? list : []
    },

    /** 静默时段的可读描述 */
    silenceTimeDesc(state) {
      return describeSilenceTime(state.programInfo && state.programInfo.SilenceTime)
    },

    /** 自动切换设置（NAS 只返回**有效**条目，一条都没有时是空数组） */
    autoPrograms(state) {
      const list = state.programInfo && state.programInfo.AutoProgram
      return Array.isArray(list) ? list : []
    },

    /** 自动切换设置的可读文案（只读展示用） */
    autoProgramTexts() {
      return this.autoPrograms.map((item) => describeAutoProgram(item, this.programNames))
    },

    /** 当前程序的任务列表最近一次加载时间（0 = 还没加载过） */
    currentTasksLoadedAt(state) {
      return Number(state.tasksLoadedAt[state.currentProgramIndex]) || 0
    }
  },

  actions: {
    /**
     * 取某个程序的定时任务列表。
     * @param {number} [programIndex] 缺省用当前程序
     * @param {{silent?: boolean}} [options] silent = 不切 loading（自动刷新用）
     * @returns {Promise<Array>} NAS 原始行
     */
    async fetchTasks(programIndex = this.currentProgramIndex, { silent = false } = {}) {
      const index = Number(programIndex)
      if (!isValidProgramIndex(index)) {
        throw new Error(`定时程序号必须是 1~16（收到 ${programIndex}）`)
      }
      if (!silent) this.loading = true
      try {
        const response = await getTimingTasks(index)
        // 列表接口没有专属码表（手册只给字段），走通用码兜底
        const rows = nasList(response, 'timingTaskList', `读取程序 ${index} 的定时任务`)
        this.tasksByProgram = { ...this.tasksByProgram, [index]: rows }
        this.tasksLoadedAt = { ...this.tasksLoadedAt, [index]: Date.now() }
        return rows
      } finally {
        if (!silent) this.loading = false
      }
    },

    /** 取定时程序信息（全局只有一份：程序名 / 组合 / 当前程序 / 静默时段 / 自动切换） */
    async fetchProgramInfo({ silent = false } = {}) {
      if (!silent) this.programLoading = true
      try {
        const response = await getTimingProgram()
        assertNasOk(response, 'timingProgramInfo', '读取定时程序信息')
        this.programInfo = response
        this.programLoadedAt = Date.now()
        return response
      } finally {
        if (!silent) this.programLoading = false
      }
    },

    /** 同时刷新「程序信息 + 当前程序的任务」——列表页进入 / 手动刷新时用 */
    async loadAll({ silent = false } = {}) {
      const [programInfo, tasks] = await Promise.all([
        this.fetchProgramInfo({ silent }),
        this.fetchTasks(this.currentProgramIndex, { silent })
      ])
      return { programInfo, tasks }
    },

    /** 丢掉某个程序的任务缓存（写操作后用；不传就丢当前程序） */
    invalidateTasks(programIndex = this.currentProgramIndex) {
      const index = Number(programIndex)
      if (Object.prototype.hasOwnProperty.call(this.tasksByProgram, index)) {
        const nextTasks = { ...this.tasksByProgram }
        delete nextTasks[index]
        this.tasksByProgram = nextTasks
      }
      if (Object.prototype.hasOwnProperty.call(this.tasksLoadedAt, index)) {
        const nextLoadedAt = { ...this.tasksLoadedAt }
        delete nextLoadedAt[index]
        this.tasksLoadedAt = nextLoadedAt
      }
    },

    /** 切换当前程序（只改指针；是否重新拉取由页面决定，有缓存就直接显示） */
    setCurrentProgram(programIndex) {
      const index = Number(programIndex)
      if (!isValidProgramIndex(index)) return false
      this.currentProgramIndex = index
      return true
    },

    /** 这个程序的任务列表是否已经有缓存 */
    hasCachedTasks(programIndex = this.currentProgramIndex) {
      return Array.isArray(this.tasksByProgram[Number(programIndex)])
    },

    /**
     * 新建定时任务：成功后 NAS 会**分配 taskIndex**，必须回传给页面展示（编辑 / 删除都靠它）。
     * @returns {Promise<{programIndex: number, taskIndex: number}>}
     */
    async createTask(payload) {
      const response = await newTimingTask(payload)
      assertNasOk(response, 'timingTaskSet', '新建定时任务')
      const programIndex = Number(response.ProgramIndex == null ? payload.programIndex : response.ProgramIndex)
      await this.fetchTasks(programIndex, { silent: true })
      return { programIndex, taskIndex: Number(response.TaskIndex) }
    },

    /** 编辑定时任务（请求体必须带 taskIndex；**缺字段 = 清空该字段**，所以页面要发完整内容） */
    async updateTask(payload) {
      const response = await editTimingTask(payload)
      assertNasOk(response, 'timingTaskSet', '编辑定时任务')
      await this.fetchTasks(payload.programIndex, { silent: true })
      return response
    },

    /** 删除定时任务（必须带 taskName：NAS 用它确认目标） */
    async removeTask({ programIndex, taskIndex, taskName }) {
      const response = await deleteTimingTask({ programIndex, taskIndex, taskName })
      assertNasOk(response, 'timingTaskSet', '删除定时任务')
      await this.fetchTasks(programIndex, { silent: true })
      return response
    },

    /** 配置定时程序参数（**段式覆盖**：payload 里放哪些段就整体重置哪些段，页面负责先读后写） */
    async configureProgram(payload) {
      const response = await configTimingProgram(payload)
      assertNasOk(response, 'timingProgramConfig', '配置定时程序')
      // 程序名 / 组合 / 当前程序 / 静默 / 自动切换都可能变 → 重拉程序信息（任务列表不受影响）
      await this.fetchProgramInfo({ silent: true })
      return response
    },

    /**
     * 定时程序操作：清除 / 复制 / 剪切。
     * ⚠️ 复制与剪切会**覆盖目标程序**，所以源与目标两个程序的任务缓存都要丢掉并重拉。
     */
    async operateProgram({ action, programIndex, programIndex1 }) {
      const response = await setTimingProgram({ action, programIndex, programIndex1 })
      assertNasOk(response, 'timingProgramSet', `定时程序操作（${action}）`)
      const source = Number(programIndex)
      const target = Number(programIndex1)
      this.invalidateTasks(source)
      if (isValidProgramIndex(target)) this.invalidateTasks(target)
      // 程序名等参数按理不变，但重拉一次最省心（也顺手确认任务确实被改动）
      await Promise.all([
        this.fetchProgramInfo({ silent: true }),
        this.fetchTasks(this.currentProgramIndex, { silent: true })
      ])
      return response
    }

  }
})
