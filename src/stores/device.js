// src/stores/device.js —— 设备列表与设备操作的仓库
//
// 为什么用 store 而不是页面内的局部 state：后面「任务提交」「定时任务」「设备任务」都要复用
// 同一份「终端 / 采播器」列表来让用户选设备，放 store 里只拉一次、跨页面共享。
//
// 两层错误都在这里体现（本项目特有）：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已经弹了全局提示，本 store 让异常继续上抛；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，用 assertNasOk 抛 NasResultError，
//     由页面捕获后提示（拦截器不管这一层）。

import { defineStore } from 'pinia'
import {
  addDummyDevice,
  deleteDevices,
  getActCapturerDevices,
  getActRequesterDevices,
  getCapturerDevices,
  getPlayerDevices,
  reconfigDevice,
  setDeviceVolume
} from '@/api/device'
import { DEVICE_CLASSES } from '@/constants/device'
import { assertNasOk, nasList } from '@/utils/nas-result'

/** 列表 key → 取数函数（key 与 DEVICE_CLASSES 的 key 一致） */
const FETCHERS = {
  player: getPlayerDevices,
  capturer: getCapturerDevices,
  actCapturer: getActCapturerDevices,
  actRequester: getActRequesterDevices
}

const LIST_KEYS = DEVICE_CLASSES.map((item) => item.key)

/** 按 devClass 找列表 key：写操作成功后据此刷新对应列表 */
function listKeyOfDevClass(devClass) {
  const found = DEVICE_CLASSES.find((item) => item.devClass === Number(devClass))
  return found ? found.key : ''
}

/** 生成 { player: [], capturer: [], … } 形状的初始对象 */
function createKeyedValue(value) {
  return Object.fromEntries(LIST_KEYS.map((key) => [key, value]))
}

export const useDeviceStore = defineStore('device', {
  state: () => ({
    /** 四类设备的列表数据（元素是 NAS 返回的原始字段：DeviceID / DevName / IP / …） */
    lists: createKeyedValue([]),
    /** 每类的加载状态（给 el-table 的 v-loading 用） */
    loading: createKeyedValue(false),
    /** 每类最近一次成功加载的时间戳（0 表示还没加载过，页面据此决定是否首次拉取） */
    loadedAt: createKeyedValue(0)
  }),

  getters: {
    /** 系统内所有已知设备 ID（添加虚假设备时用于挑一个未被占用的 ID） */
    allDeviceIds: (state) =>
      LIST_KEYS.flatMap((key) => state.lists[key].map((item) => item.DeviceID))
  },

  actions: {
    /**
     * 拉取某一类设备列表。
     * @param {string} key DEVICE_CLASSES 的 key
     * @param {{silent?: boolean}} [options] silent: 自动刷新时用，不切换 loading（避免表格反复闪 loading）
     * @returns {Promise<Array>} 列表数据
     */
    async fetchList(key, options = {}) {
      const fetcher = FETCHERS[key]
      if (!fetcher) return []

      if (!options.silent) this.loading[key] = true
      try {
        const list = nasList(await fetcher(), '', '获取设备列表')
        this.lists[key] = list
        this.loadedAt[key] = Date.now()
        return list
      } finally {
        if (!options.silent) this.loading[key] = false
      }
    },

    /** 依次拉取四类列表（任一类失败不影响其它类，一并返回失败的 key） */
    async fetchAll(options = {}) {
      const results = await Promise.allSettled(
        LIST_KEYS.map((key) => this.fetchList(key, options))
      )
      return LIST_KEYS.filter((key, index) => results[index].status === 'rejected')
    },

    /**
     * 设置终端基础音量 —— POST /api/devices/volume
     * ⚠️ 0 = 最大、127 = 静音；基础音量影响该终端上的全部任务。
     */
    async setVolume({ deviceId, volume, devClass }) {
      assertNasOk(await setDeviceVolume({ deviceId, volume }), 'volume', '设置音量')
      await this.fetchList(listKeyOfDevClass(devClass))
    },

    /**
     * 修改在线设备名称 —— POST /api/devices/reconfig
     * ⚠️ 当前 NAS 仅支持改播放终端，且改动约 10 秒后才在列表里刷新。
     */
    async rename({ deviceId, devName, devClass }) {
      assertNasOk(
        await reconfigDevice({ deviceId, devName, devClass }),
        'reconfig',
        '修改设备名称'
      )
      await this.fetchList(listKeyOfDevClass(devClass))
    },

    /** 删除离线设备 —— POST /api/devices/delete（只能删除离线 / 历史设备） */
    async remove({ deviceId, devClass }) {
      assertNasOk(await deleteDevices({ deviceId, devClass }), 'delete', '删除设备')
      await this.fetchList(listKeyOfDevClass(devClass))
    },

    /** 添加虚假设备 —— POST /api/devices/dummy（仅凑数用，加入任务无效） */
    async addDummy({ deviceId, devName, devClass }) {
      const payload = { deviceId, devClass }
      // 名称为空时交给后端用默认名（Dummy Device added by API），不要发空串
      if (devName) payload.devName = devName

      assertNasOk(await addDummyDevice(payload), 'dummy', '添加虚假设备')
      await this.fetchList(listKeyOfDevClass(devClass))
    }
  }
})
