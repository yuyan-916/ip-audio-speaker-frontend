// src/stores/playlist.js —— 播放列表与增删改动作的仓库
//
// 为什么用 store：播放列表不只本页面用，「任务管理」「定时任务」「设备任务」都要把
// 4 位的 FFxx（引用播放列表）放进 FileList，放这里跨页面共享、只拉一次。
//
// 两层错误的分工与 device / group / media store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面提示。
//
// ⚠️ 播放列表的 FileList 是**有序**的（数组顺序 = 播放顺序），所以这里只做规范化（去空白 / 大写 /
//    去重），**绝不排序**；也始终提交**完整**数组——NAS 的语义是「编辑时缺省 FileList = 清空」。

import { defineStore } from 'pinia'
import { deletePlayList, editPlayList, getPlayLists, newPlayList } from '@/api/playlist'
import { normalizeFileIds } from '@/constants/playlist'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const usePlayListStore = defineStore('playlist', {
  state: () => ({
    /** 播放列表（NAS 返回的原始字段：PlayListID / PlayListName / FileList） */
    playlists: [],
    /** 加载状态（给 el-table 的 v-loading 用） */
    loading: false,
    /** 最近一次成功加载的时间戳（0 表示还没加载过，页面据此决定是否首次拉取） */
    loadedAt: 0,
    /** 最近一次新建成功后 NAS 分配的播放列表 ID（2 位十六进制，空串表示后端没回传） */
    lastCreatedPlayListId: ''
  }),

  actions: {
    /**
     * 拉取播放列表。
     * @param {{silent?: boolean}} [options] silent: 自动刷新时用，不切换 loading（避免表格反复闪 loading）
     * @returns {Promise<Array>} 播放列表
     */
    async fetchPlayLists(options = {}) {
      if (!options.silent) this.loading = true
      try {
        const list = nasList(await getPlayLists(), 'playListList', '获取播放列表')
        this.playlists = list
        this.loadedAt = Date.now()
        return list
      } finally {
        if (!options.silent) this.loading = false
      }
    },

    /**
     * 新建播放列表 —— POST /api/playlists/new
     * @param {{playListName?: string, fileList?: string[]}} payload
     * @returns {Promise<string>} NAS 分配的新播放列表 ID（后端未回传时为空串）
     */
    async createPlayList({ playListName, fileList }) {
      const payload = { fileList: normalizeFileIds(fileList) }
      // 名称为空时交给 NAS 用默认名（New Play List），不要发空串
      if (playListName) payload.playListName = playListName

      const response = assertNasOk(await newPlayList(payload), 'playlist', '新建播放列表')
      this.lastCreatedPlayListId = String(response && response.PlayListID ? response.PlayListID : '')
      await this.fetchPlayLists()
      return this.lastCreatedPlayListId
    },

    /**
     * 编辑播放列表 —— POST /api/playlists/edit
     * ⚠️ 必须传**完整、有序**的文件列表：NAS 的语义是「缺省 fileList = 清空文件列表」，
     *    所以这里始终显式带上 fileList（哪怕要清空也发 []）。
     */
    async updatePlayList({ playListId, playListName, fileList }) {
      const payload = {
        playListId,
        fileList: normalizeFileIds(fileList)
      }
      if (playListName) payload.playListName = playListName

      assertNasOk(await editPlayList(payload), 'playlist', '编辑播放列表')
      await this.fetchPlayLists()
    },

    /**
     * 删除播放列表 —— POST /api/playlists/delete
     * ⚠️ playListName 必填且要与列表里的原名一致：NAS 用它确认目标列表。
     */
    async removePlayList({ playListId, playListName }) {
      assertNasOk(await deletePlayList({ playListId, playListName }), 'playlist', '删除播放列表')
      await this.fetchPlayLists()
    }
  }
})
