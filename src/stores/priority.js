// src/stores/priority.js —— 任务优先级（任务请求源优先策略）模块的仓库
//
// 为什么用 store：这一页只有一份全局数据（13 个任务类的主优先级 + 处理规则），
// 但页面需要「NAS 上的现状」与「用户正在编辑的草稿」两份，并在每次成功写入后重新拉一遍核对；
// 把「拉取 / 写入 / 写后重拉」收在这里，页面只管编辑和提示。
//
// ⚠️ 缓存策略：**没有缓存**。这一页的数据量极小（13 行），而且优先级是全局生效的运行时配置，
//    别的客户端（管理软件 / 分控软件）随时可能改它 —— 所以每次进页面都重新拉一次，
//    写入成功后也立即重拉（NAS 不会回传改后的完整列表，本地拼出来的结果不可信）。
// ⚠️ 与其它 store 一样，这里**只断言 NAS 业务码**（assertNasOk）；HTTP 层错误交给 api/request.js 的拦截器。
//    两者都让异常继续上抛，由页面决定提示方式（页面只在 NasResultError 时再弹一次）。
//
// Result 码表（来源：后端 docs/impl-notes.md §七 2，逐条抄进 src/utils/nas-result.js）：
//   · priority     —— SetTaskPriorityAck（POST /api/priority）
//   · priorityInfo —— 查询接口手册没给码表，未收录 → 走通用码兜底。

import { defineStore } from 'pinia'
import { getPriority, setPriority } from '@/api/priority'
import { isValidTaskClass, normalizePriorityRules } from '@/constants/priority'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const usePriorityStore = defineStore('priority', {
  state: () => ({
    /** NAS 原始策略行：`[{ TaskClass, TCPriority, TCRule }]`（空数组 = 还没读过） */
    rules: [],
    /** 是否正在加载（只有非 silent 的加载会切它，避免静默刷新让表格闪 loading） */
    loading: false,
    /** 是否正在保存 */
    saving: false,
    /** 最近一次成功加载的时间戳（0 = 还没读过） */
    lastLoadedAt: 0
  }),

  getters: {
    /** 表格数据：恒为 13 行、顺序 1~13（NAS 少返回的类补成空行） */
    ruleRows(state) {
      return normalizePriorityRules(state.rules)
    },

    /** NAS 已返回策略的任务类条数（正常是 13） */
    returnedCount(state) {
      return normalizePriorityRules(state.rules).filter((row) => row.returned).length
    }
  },

  actions: {
    /**
     * 拉取任务源优先策略（13 个任务类）。
     * @param {{silent?: boolean}} options `silent: true` 时不切 loading（写后重拉用）
     * @returns {Promise<Array>} NAS 原始行
     */
    async fetchPriority({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        const response = await getPriority()
        // ⚠️ 查询接口手册没给码表（只有 SetTaskPriorityAck 那张），所以表名用 'priorityInfo'，
        //    未收录 → 自动走通用码兜底（见 utils/nas-result.js 的说明）
        this.rules = nasList(response, 'priorityInfo', '获取任务源优先策略')
        this.lastLoadedAt = Date.now()
        return this.rules
      } finally {
        if (!silent) this.loading = false
      }
    },

    /**
     * 提交变更（**部分更新**：只发请求里出现的任务类，其余保持不变）。
     * ⚠️ 空数组会被后端 400 拒（`data` 上标了 `@NotEmpty`），所以这里直接拦掉。
     * 成功后**强制重拉一次**列表，让页面显示的是 NAS 上的真实结果。
     *
     * @param {Array<{taskClass: number, tcPriority: number, tcRule: number}>} updatedList 只含改过的行
     * @returns {Promise<{DataType: string, Result: number}>} NAS 的 SetTaskPriorityAck
     */
    async updateRules(updatedList) {
      const data = (Array.isArray(updatedList) ? updatedList : []).filter(
        (item) => item && isValidTaskClass(item.taskClass)
      )
      if (!data.length) {
        throw new Error('没有需要提交的变更：只提交改过的任务类，空请求会被后端拒绝（400）')
      }

      this.saving = true
      try {
        const response = await setPriority(data)
        assertNasOk(response, 'priority', '设置任务源优先策略')
        await this.fetchPriority({ silent: true })
        return response
      } finally {
        this.saving = false
      }
    }
  }
})
