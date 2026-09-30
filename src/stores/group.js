// src/stores/group.js —— 终端分组列表与分组操作的仓库
//
// 为什么用 store：分组不只本页面用，「任务管理」「定时任务」「设备任务」都要让用户按分组选播放目标，
// 放这里跨页面共享、只拉一次。
//
// 两层错误的分工与 device store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面提示。

import { defineStore } from 'pinia'
import { deleteGroup, editGroup, getGroups, newGroup } from '@/api/group'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const useGroupStore = defineStore('group', {
  state: () => ({
    /** 分组列表（NAS 返回的原始字段：GroupID / GroupName / Creater / PlayerList） */
    groups: [],
    /** 加载状态（给 el-table 的 v-loading 用） */
    loading: false,
    /** 最近一次成功加载的时间戳（0 表示还没加载过，页面据此决定是否首次拉取） */
    loadedAt: 0,
    /** 最近一次新建成功后 NAS 分配的分组 ID（2 位十六进制，空串表示后端没回传） */
    lastCreatedGroupId: ''
  }),

  actions: {
    /**
     * 拉取分组列表。
     * @param {{silent?: boolean}} [options] silent: 自动刷新时用，不切换 loading（避免表格反复闪 loading）
     * @returns {Promise<Array>} 分组列表
     */
    async fetchGroups(options = {}) {
      if (!options.silent) this.loading = true
      try {
        const list = nasList(await getGroups(), 'group', '获取分组列表')
        this.groups = list
        this.loadedAt = Date.now()
        return list
      } finally {
        if (!options.silent) this.loading = false
      }
    },

    /**
     * 新建分组 —— POST /api/groups/new
     * @param {{groupName?: string, playerList?: string[]}} payload
     * @returns {Promise<string>} NAS 分配的新分组 ID（后端未回传时为空串）
     */
    async createGroup({ groupName, playerList }) {
      const payload = { playerList: Array.isArray(playerList) ? playerList : [] }
      // 名称为空时交给 NAS 用默认名（New Group），不要发空串
      if (groupName) payload.groupName = groupName

      const response = assertNasOk(await newGroup(payload), 'group', '新建分组')
      this.lastCreatedGroupId = String(response && response.GroupID ? response.GroupID : '')
      await this.fetchGroups()
      return this.lastCreatedGroupId
    },

    /**
     * 编辑分组 —— POST /api/groups/edit
     * ⚠️ 必须传**完整**成员列表：NAS 的语义是「缺省 playerList = 清空成员」，
     *    所以这里始终显式带上 playerList（哪怕要清空也发 []）。
     */
    async updateGroup({ groupId, groupName, playerList }) {
      const payload = {
        groupId,
        playerList: Array.isArray(playerList) ? playerList : []
      }
      if (groupName) payload.groupName = groupName

      assertNasOk(await editGroup(payload), 'group', '编辑分组')
      await this.fetchGroups()
    },

    /**
     * 删除分组 —— POST /api/groups/delete
     * ⚠️ groupName 必填且要与列表里的原名一致：NAS 用它确认目标分组。
     */
    async removeGroup({ groupId, groupName }) {
      assertNasOk(await deleteGroup({ groupId, groupName }), 'group', '删除分组')
      await this.fetchGroups()
    }
  }
})
