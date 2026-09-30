// src/stores/deviceTask.js —— 设备任务模块的仓库
//
// 为什么用 store：设备任务页有两块互相牵连的数据 ——
//   · catalog         —— 已配置设备任务的设备目录；加入 / 移出目录、以及任何写操作之后都要重拉；
//   · tasksByDevice   —— 按 deviceId 缓存的设备任务清单（切设备时不反复拉）。
//
// ⚠️ 缓存策略：**任何写操作之后都强制重拉受影响的那一份**（NAS 是权威，本地拼出来的结果不可信）：
//   · 保存任务 → 重拉该设备的清单；
//   · 移出目录 → 丢掉该设备的清单缓存 + 重拉目录（NAS 那边任务已经一起被删了）。
//
// 两层错误的分工与其它 store 一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，由页面 / 弹窗提示。
//
// Result 码表（来源：后端 docs/impl-notes.md §六，抄进 src/utils/nas-result.js）：
//   · deviceTaskSet      —— DeviceTaskSetAck（POST /api/device-tasks，手册 P74-80）
//   · deviceTaskCatalog  —— Add/DelAck（POST /api/device-tasks/catalog，手册 P69-70）
//   · 两个**查询**接口手册都没给码表（deviceTaskCatalogList / deviceTaskList）→ 走通用码兜底。
//
// ⚠️ `GET /api/device-tasks/{deviceId}` 的 **Result = 1 是业务语义**（该设备没有配置设备任务，
//    响应里连 `Data` 都没有），必须在 assertNasOk 之前单独放行，否则「还没配过」会被当成失败弹红条。

import { defineStore } from 'pinia'
import {
  addDeviceToTaskCatalog,
  getDeviceTaskCatalog,
  getDeviceTasks,
  removeDeviceFromTaskCatalog,
  setDeviceTask
} from '@/api/deviceTask'
import {
  describeDeviceSupport,
  describeDeviceTypeForTask,
  normalizeDeviceTaskCode,
  normalizeDeviceTaskId,
  normalizeDeviceTaskList
} from '@/constants/deviceTask'
import { assertNasOk, nasList } from '@/utils/nas-result'

export const useDeviceTaskStore = defineStore('deviceTask', {
  state: () => ({
    /** 已配置设备任务的设备目录（NAS 原始字段：DeviceID / DeviceType） */
    catalog: [],
    /**
     * 按 deviceId 缓存的设备任务清单（元素是 NAS 原始行）。
     * 是**普通对象**而不是 JS Map —— 与其它 store（timing.tasksByProgram / devicePermit.currentPermit）保持同一种写法，
     * 形状：`{ '00001A01': { deviceId, notConfigured, rows: [...] } }`
     */
    tasksByDevice: {},
    /** 目录是否正在加载（给表格 v-loading 用） */
    loading: false,
    /** 是否正在读取某台设备的任务清单（给列表卡片 v-loading 用） */
    taskLoading: false,
    /** 是否正在保存 / 改目录 */
    saving: false,
    /** 最近一次成功加载目录的时间戳（0 表示还没读过） */
    lastLoadedAt: 0
  }),

  getters: {
    /**
     * 表格数据：目录按设备 ID 升序，并补上「类型文案」与「该类型支持的任务类型」。
     * 目录本身没有设备名字段，需要名称时由页面用 device store 的列表补。
     */
    catalogRows(state) {
      return state.catalog
        .map((item) => {
          const deviceId = normalizeDeviceTaskId(item && item.DeviceID)
          const deviceType = normalizeDeviceTaskCode(item && item.DeviceType)
          return {
            deviceId,
            deviceType,
            typeText: describeDeviceTypeForTask(deviceType),
            supportText: describeDeviceSupport(deviceType)
          }
        })
        .filter((row) => row.deviceId)
        .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
    },

    /** 目录里已配置设备任务的设备台数 */
    catalogCount: (state) => state.catalog.length
  },

  actions: {
    /** 某台设备的缓存（没读过时返回 null，调用方据此决定是否要拉） */
    cachedTasks(deviceId) {
      return this.tasksByDevice[normalizeDeviceTaskId(deviceId)] || null
    },

    /** 这台设备的任务清单是否已经有缓存 */
    hasCachedTasks(deviceId) {
      return Boolean(this.cachedTasks(deviceId))
    },

    /** 丢掉某台设备的任务缓存（写操作后用） */
    invalidateTasks(deviceId) {
      const id = normalizeDeviceTaskId(deviceId)
      if (!id || !this.tasksByDevice[id]) return
      const next = { ...this.tasksByDevice }
      delete next[id]
      this.tasksByDevice = next
    },

    /**
     * 拉取「已配置设备任务的设备目录」。
     * @param {{silent?: boolean}} [options] silent: 写后重拉用，不切 loading（避免表格闪）
     * @returns {Promise<Array>} NAS 原始目录
     */
    async fetchCatalog({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        // 手册没给这个查询接口的码表：表名 'deviceTaskCatalogList' 故意未收录 → 自动走通用码兜底
        this.catalog = nasList(await getDeviceTaskCatalog(), 'deviceTaskCatalogList', '获取设备任务目录')
        this.lastLoadedAt = Date.now()
        return this.catalog
      } finally {
        if (!silent) this.loading = false
      }
    },

    /**
     * 读取某台设备的全部设备任务（**总是发请求**，成功后写进缓存供切回来时直接显示）。
     * ⚠️ Result = 1（该设备没有配置设备任务）不是错误：按空列表返回，页面提示「还没配过」即可。
     *
     * @param {string} deviceId 8 位十六进制设备 ID
     * @returns {Promise<{deviceId: string, notConfigured: boolean, rows: Array}>}
     */
    async fetchTasks(deviceId) {
      const id = normalizeDeviceTaskId(deviceId)
      if (!id) throw new Error('读取设备任务需要 8 位十六进制的设备 ID')

      this.taskLoading = true
      try {
        const response = await getDeviceTasks(id)
        if (Number(response && response.Result) !== 1) {
          assertNasOk(response, 'deviceTaskList', `读取 ${id} 的设备任务`)
        }
        const normalized = normalizeDeviceTaskList(response)
        // 响应里的 DeviceID 可能缺席（Result=1 时），用请求里的 ID 兜底
        this.tasksByDevice[id] = { ...normalized, deviceId: normalized.deviceId || id }
        return this.tasksByDevice[id]
      } finally {
        this.taskLoading = false
      }
    },

    /**
     * 把设备加入设备任务目录 —— POST /api/device-tasks/catalog（action=ADD）。
     * 成功后重拉目录（这台设备会出现在目录里）。
     * @returns {Promise<{DataType: string, Result: number, DeviceID?: string, DeviceType?: string}>}
     */
    async addDevice(deviceId) {
      const id = normalizeDeviceTaskId(deviceId)
      if (!id) throw new Error('加入设备任务目录需要 8 位十六进制的设备 ID')

      this.saving = true
      try {
        const response = await addDeviceToTaskCatalog(id)
        assertNasOk(response, 'deviceTaskCatalog', `把 ${id} 加入设备任务目录`)
        await this.fetchCatalog({ silent: true })
        return response
      } finally {
        this.saving = false
      }
    },

    /**
     * 把设备移出设备任务目录 —— POST /api/device-tasks/catalog（action=REMOVE）。
     * ⚠️ **NAS 会同步删除该设备的全部设备任务**，所以本地的任务缓存也必须一起丢掉。
     * @returns {Promise<{DataType: string, Result: number, DeviceID?: string}>}
     */
    async removeDevice(deviceId) {
      const id = normalizeDeviceTaskId(deviceId)
      if (!id) throw new Error('移出设备任务目录需要 8 位十六进制的设备 ID')

      this.saving = true
      try {
        const response = await removeDeviceFromTaskCatalog(id)
        assertNasOk(response, 'deviceTaskCatalog', `把 ${id} 移出设备任务目录`)
        this.invalidateTasks(id)
        await this.fetchCatalog({ silent: true })
        return response
      } finally {
        this.saving = false
      }
    },

    /**
     * 启用 / 修改 / 禁用一条设备任务 —— POST /api/device-tasks。
     * 成功后重拉该设备的清单（**不本地伪造**：NAS 的字段映射与默认值都可能与请求不同）。
     *
     * @param {object} payload `buildDeviceTaskPayload` / `deviceTaskToPayload` 的产物
     * @returns {Promise<{DataType: string, Result: number}>} NAS 的 DeviceTaskSetAck
     */
    async saveTask(payload) {
      const deviceId = normalizeDeviceTaskId(payload && payload.deviceId)
      if (!deviceId) throw new Error('保存设备任务需要 8 位十六进制的设备 ID')

      this.saving = true
      try {
        const response = await setDeviceTask(payload)
        assertNasOk(response, 'deviceTaskSet', '保存设备任务')
        await this.fetchTasks(deviceId)
        return response
      } finally {
        this.saving = false
      }
    }
  }
})

