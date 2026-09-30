// src/stores/media.js —— 媒体文件列表与上传 / 删除动作的仓库
//
// 为什么用 store：媒体文件会被「播放列表」（只能引用系统媒体文件）与「任务管理」（FileList 里用 4 位 FileID）
// 引用，三个页签的列表也都是同一份数据，放这里只拉一次、跨页面共享。
//
// 两层错误的分工与 device / group store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面提示。
//
// ⚠️ 上传：本 store 只负责**单个文件**（uploadOne）。多个文件必须**串行**——NAS 的上传是会话式的
//    （上一次 Open 没 Close 之前再 Open 会拿到 Result=8），所以串行链与逐项结果都放在弹窗里，
//    列表刷新也由弹窗在一批传完后统一做一次（否则 N 个文件会把列表刷 N 遍）。

import { defineStore } from 'pinia'
import {
  deleteAlarmMediaFile,
  deleteSystemMediaFile,
  getAlarmMediaFiles,
  getSubUserMediaFiles,
  getSystemMediaFiles,
  uploadMediaFile
} from '@/api/media'
import {
  MEDIA_TYPES,
  MediaUploadGuardError,
  SUB_USER_ID_PATTERN,
  createUploadFailureResult,
  createUploadSuccessResult,
  describeUploadGuardProblem,
  uploadTimeoutMs
} from '@/constants/media'
import { assertNasOk, nasList } from '@/utils/nas-result'

const LIST_KEYS = MEDIA_TYPES.map((item) => item.key)

/** 生成 { system: [], alarm: [], subUser: [] } 形状的初始对象 */
function createKeyedValue(value) {
  return Object.fromEntries(LIST_KEYS.map((key) => [key, value]))
}

/** 列表 key → 取数函数（subUser 需要额外的设备 ID，在 fetchList 里单独处理） */
const FETCHERS = {
  system: getSystemMediaFiles,
  alarm: getAlarmMediaFiles
}

/** 列表 key → 删除函数（⚠️ 系统 / 报警的 FileID 取值范围重叠，删除必须走各自的路径） */
const DELETERS = {
  system: deleteSystemMediaFile,
  alarm: deleteAlarmMediaFile
}

export const useMediaStore = defineStore('media', {
  state: () => ({
    /** 三类的列表数据（元素是 NAS 原始字段：FileID / FileName / PlayTime；分控列表另有 DeviceID） */
    lists: createKeyedValue([]),
    /** 每类的加载状态（给 el-table 的 v-loading 用） */
    loading: createKeyedValue(false),
    /** 每类最近一次成功加载的时间戳（0 表示还没加载过，页面据此决定是否首次拉取） */
    loadedAt: createKeyedValue(0),
    /** 分控软件媒体当前查询的设备 ID（8 位十六进制，空串表示还没选） */
    subUserId: '',
    /** 最近一批上传的逐项结果（弹窗里的「上传结果表」） */
    uploadResults: []
  }),

  actions: {
    /**
     * 切换分控软件设备 —— **必须清掉已加载标记**，否则切了设备还显示上一台设备的文件。
     * @param {string} subUserId 8 位十六进制设备 ID（空串表示清空选择）
     */
    setSubUserId(subUserId) {
      const id = String(subUserId == null ? '' : subUserId).trim().toUpperCase()
      if (id === this.subUserId) return
      this.subUserId = id
      this.lists.subUser = []
      this.loadedAt.subUser = 0
    },

    /**
     * 拉取某一类媒体文件列表。
     * @param {'system'|'alarm'|'subUser'} key 页签标识
     * @param {{silent?: boolean, subUserId?: string}} [options]
     *   `silent`: 自动刷新时用，不切换 loading（避免表格反复闪 loading）；
     *   `subUserId`: 本次查询使用的分控设备 ID（缺省用 state 里的）
     * @returns {Promise<Array>} 列表数据
     */
    async fetchList(key, options = {}) {
      if (!options.silent) this.loading[key] = true
      try {
        let response

        if (key === 'subUser') {
          const subUserId = String(options.subUserId || this.subUserId || '').trim().toUpperCase()
          if (!SUB_USER_ID_PATTERN.test(subUserId)) {
            // 还没选分控软件设备：不发请求，直接给空列表（页面会提示「请先选择分控软件设备」）
            this.lists.subUser = []
            this.loadedAt.subUser = 0
            return []
          }
          this.subUserId = subUserId
          response = await getSubUserMediaFiles(subUserId)
        } else {
          const fetcher = FETCHERS[key]
          if (!fetcher) return []
          response = await fetcher()
        }

        const list = nasList(response, 'mediaList', '获取媒体文件列表')
        this.lists[key] = list
        this.loadedAt[key] = Date.now()
        return list
      } finally {
        if (!options.silent) this.loading[key] = false
      }
    },

    /**
     * 删除媒体文件 —— POST /api/media/{system|alarm}/delete
     *
     * ⚠️ `fileName` 必须与列表里的**原名完全一致**：NAS 用它确认要删的是哪个文件，不一致返回 Result=8。
     * ⚠️ 系统媒体与报警媒体的 FileID 取值范围重叠 → 只能按当前媒体类型走对应的删除路径。
     * ⚠️ 文件正在被任务 / 播放列表使用时，NAS 可能返回 Result=7（删除失败）。
     */
    async removeFile(key, { fileId, fileName }) {
      const deleter = DELETERS[key]
      if (!deleter) {
        // 安全网：分控软件媒体只有列表接口，没有删除接口（页面上不会给这个入口）
        throw new Error('分控软件媒体文件不支持删除（后端没有提供对应接口）')
      }
      assertNasOk(await deleter({ fileId, fileName }), 'mediaDelete', '删除媒体文件')
      await this.fetchList(key)
    },

    /** 开始新的一批上传：清空上一批的逐项结果（弹窗打开 / 用户点「清空结果」时调用） */
    startUploadBatch() {
      this.uploadResults = []
    },

    /**
     * 上传**一个**文件 —— POST /api/media/{mediaType}/upload
     *
     * 无论成功还是失败，都会往 `uploadResults` 里 push 一行；**失败时抛出**，
     * 好让 el-upload 的 `http-request`（返回的 Promise 被 reject）把该文件标成失败，
     * 弹窗也靠它推进串行链。
     *
     * @param {'system'|'alarm'} mediaType 目标媒体类型（分控媒体没有上传接口）
     * @param {File} file 待上传文件
     * @param {{onProgress?: (percent: number) => void}} [options] onProgress 会拿到 0~99 的百分比
     * @returns {Promise<object>} Close 响应（含 NAS 分配的 `FileID`）
     */
    async uploadOne(mediaType, file, { onProgress } = {}) {
      try {
        // 本地能判的先判掉：空文件 / 超 100MB / 文件名超 255 字符（后端也会拒，但没必要白跑一趟网络）
        const problem = describeUploadGuardProblem(file)
        if (problem) throw new MediaUploadGuardError(problem)

        const ack = assertNasOk(
          await uploadMediaFile(mediaType, file, {
            // 全局 15s 装不下媒体上传：默认按文件大小估算，弹窗可覆盖
            timeout: uploadTimeoutMs([file]),
            onProgress
          }),
          'mediaUpload',
          '上传媒体文件'
        )

        this.uploadResults.push(createUploadSuccessResult(file, ack))
        return ack
      } catch (error) {
        this.uploadResults.push(createUploadFailureResult(file, error))
        throw error
      }
    },

    /**
     * 记录一次「本地拦截、根本没发出去」的上传。
     * 弹窗的 `before-upload` 返回 false 之前必须调一次，否则结果表里看不到这个文件
     * （用户会以为它上传成功了）。
     */
    rejectUpload(file, reason) {
      this.uploadResults.push(
        createUploadFailureResult(file, new MediaUploadGuardError(reason || '文件不符合上传要求'))
      )
    }

  }
})
