// src/stores/devicePermit.js —— 设备权限模块的仓库
//
// 为什么用 store：目录（catalog）与「某台设备的权限数据」是两个粒度不同、但都要跨弹窗复用的数据。
//   · catalog       —— 列表页的数据源；写入成功后必须重拉（NAS 会把新设置权限的设备加入目录）；
//   · currentPermit —— 按 deviceId 的缓存（最近一次读到的权限数据）。用途只有两个：
//                      打开弹窗时先铺一屏（避免白屏），以及写入成功后作废（下次打开必然重新读）。
//                      ⚠️ 打开弹窗时**仍然会重新读一次**：别的客户端（管理软件 / 分控软件）随时可能改它。
//
// 两层错误的分工与其它 store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面 / 弹窗提示。
//
// Result 码表（来源：后端 docs/impl-notes.md §九 3，抄进 src/utils/nas-result.js）：
//   · devicePermit —— DevicePermitSetAck（POST /api/device-permits）
//   · permitCatalog / permitInfo —— 两个**查询**接口手册都没给码表，未收录 → 走通用码兜底。
//
// ⚠️ `GET /api/device-permits/{deviceId}` 的 **Result = 1 是业务语义**（该设备尚未设置权限数据），
//    必须在 assertNasOk 之前单独放行，否则「还没配过」会被当成失败弹红条。

import { defineStore } from 'pinia'
import { getPermitCatalog, getPermitInfo, setPermit } from '@/api/devicePermit'
import {
  describeDeviceTypeForPermit,
  needsPermitDeviceType,
  normalizePermitCode,
  normalizePermitId,
  normalizePermitInfo
} from '@/constants/devicePermit'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const useDevicePermitStore = defineStore('devicePermit', {
  state: () => ({
    /** 已设置权限数据的设备目录（NAS 原始字段：DeviceID / DeviceType） */
    catalog: [],
    /**
     * 按 deviceId 的权限数据缓存。是**普通对象**而不是 JS Map —— 与项目里其它 store 保持同一种写法，
     * 形状：`{ '00001AB2': { deviceId, notSet, permitGroup, permitPlayer, permitCapturer } }`
     */
    currentPermit: {},
    /** 目录是否正在加载（给表格 v-loading 用） */
    loading: false,
    /** 是否正在读取某台设备的权限数据（给弹窗里的选择器用） */
    permitLoading: false,
    /** 是否正在保存 */
    saving: false,
    /** 最近一次成功加载目录的时间戳（0 表示还没读过） */
    lastLoadedAt: 0
  }),

  getters: {
    /**
     * 表格数据：目录按设备 ID 升序，并补上「类型文案」与「是否属于需要权限数据的类型」。
     * 行里不放设备名（目录本身没有名称字段），需要名称时由页面用 device store 的列表补。
     */
    catalogRows(state) {
      return state.catalog
        .map((item) => {
          const deviceId = normalizePermitId(item && item.DeviceID)
          const deviceType = normalizePermitCode(item && item.DeviceType)
          return {
            deviceId,
            deviceType,
            typeText: describeDeviceTypeForPermit(deviceType),
            needsPermit: needsPermitDeviceType(deviceType)
          }
        })
        .filter((row) => row.deviceId)
        .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
    },

    /** 目录里已设置权限数据的设备台数 */
    catalogCount: (state) => state.catalog.length
  },

  actions: {
    /** 缓存里某台设备的权限数据（没读过时返回 null，调用方据此决定是否要读） */
    cachedPermit(deviceId) {
      return this.currentPermit[normalizePermitId(deviceId)] || null
    },

    /**
     * 拉取「已设置权限数据的设备目录」。
     * @param {{silent?: boolean}} [options] silent: 写后重拉用，不切 loading（避免表格闪）
     * @returns {Promise<Array>} NAS 原始目录
     */
    async fetchCatalog({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        // 手册没给这个查询接口的码表：表名 'permitCatalog' 故意未收录 → 自动走通用码兜底
        this.catalog = nasList(await getPermitCatalog(), 'permitCatalog', '获取权限设备目录')
        this.lastLoadedAt = Date.now()
        return this.catalog
      } finally {
        if (!silent) this.loading = false
      }
    },

    /**
     * 读取某台设备的权限数据（**总是发请求**，成功后写进缓存供下次打开弹窗先铺一屏）。
     * ⚠️ Result = 1（尚未设置）不是错误：按「三类清单都空」返回，页面提示「还没配过」即可。
     *
     * @param {string} deviceId 8 位十六进制设备 ID
     * @returns {Promise<{deviceId: string, notSet: boolean, permitGroup: string[], permitPlayer: string[], permitCapturer: string[]}>}
     */
    async fetchPermit(deviceId) {
      const id = normalizePermitId(deviceId)
      if (!id) throw new Error('读取设备权限数据需要 8 位十六进制的设备 ID')

      this.permitLoading = true
      try {
        const response = await getPermitInfo(id)
        if (Number(response && response.Result) !== 1) {
          assertNasOk(response, 'permitInfo', `读取 ${id} 的权限数据`)
        }
        const permit = normalizePermitInfo(response)
        this.currentPermit[id] = permit
        return permit
      } finally {
        this.permitLoading = false
      }
    },

    /**
     * 提交权限数据（`buildPermitPayload` 的产物）。成功后：
     *   · **作废**这台设备的缓存（写进去的值以 NAS 为准，不本地伪造）；
     *   · 重新拉一次目录（首次设置会让设备入册，清空后设备可能从目录里消失）。
     *
     * @param {{deviceId: string, permitGroup: string[], permitPlayer: string[], permitCapturer: string[]}} payload
     * @returns {Promise<{DataType: string, Result: number}>} NAS 的 DevicePermitSetAck
     */
    async savePermit(payload) {
      this.saving = true
      try {
        const response = await setPermit(payload)
        assertNasOk(response, 'devicePermit', '设置设备权限数据')
        this.invalidatePermit(payload && payload.deviceId)
        await this.fetchCatalog({ silent: true })
        return response
      } finally {
        this.saving = false
      }
    },

    /** 作废某台设备的权限缓存（写入成功后调用；留成公开方法便于以后做「强制重读」） */
    invalidatePermit(deviceId) {
      const id = normalizePermitId(deviceId)
      if (id && this.currentPermit[id]) delete this.currentPermit[id]
    }
  }
})
