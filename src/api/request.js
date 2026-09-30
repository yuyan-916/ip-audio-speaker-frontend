// src/api/request.js —— axios 实例、Token 存取与请求/响应拦截器
//
// 约定（来源：后端 docs/API.md）
//   · 请求体字段用小驼峰（deviceId / volume / devClass ...）；
//   · 响应字段是 NAS 风格大驼峰（DeviceID / DevClass ...），后端已开启大小写不敏感匹配；
//   · 除 POST /api/auth/login 与 GET /actuator/health 外，所有接口都要带 Authorization: Bearer <token>。
//
// ⚠️ 两层错误要分清（本项目特有）：
//   1) HTTP 4xx / 5xx —— 链路或后端错误（401 未登录、400 参数校验失败、502 调 NAS 失败……），
//      在本文件统一转成带 code / status 的 Error 抛给调用方，并弹全局提示；
//   2) HTTP 200 且响应体 `Result !== 0` —— NAS 业务拒绝（终端离线、任务号非法……），
//      **不是 HTTP 错误**，本文件不会抛出异常；各页面拿到 { DataType, Result, Data } 后自行判断并提示。

import axios from 'axios'
import { ElMessage } from 'element-plus'

/** localStorage 中存放 JWT 的键名 */
export const TOKEN_KEY = 'nas_token'
/** localStorage 中存放登录用户名的键名（仅用于界面展示） */
export const USERNAME_KEY = 'nas_username'

/** @returns {string} 已保存的 Token（未登录时为空串） */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

/** 保存 Token */
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

/** @returns {string} 已保存的用户名（未登录时为空串） */
export function getUsername() {
  return localStorage.getItem(USERNAME_KEY) || ''
}

/** 保存用户名 */
export function setUsername(username) {
  localStorage.setItem(USERNAME_KEY, username || '')
}

/** 清空登录态（Token 与用户名） */
export function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USERNAME_KEY)
}

/**
 * 后端错误码 → 中文提示。
 * 取值来源：401 的 code（UNAUTHORIZED / INVALID_CREDENTIALS）与 502 调 NAS 失败的 code。
 */
const ERROR_CODE_MESSAGES = {
  UNAUTHORIZED: '登录状态已失效，请重新登录',
  INVALID_CREDENTIALS: '用户名或密码错误',
  NAS_LOGIN_FAILED: '登录 NAS 失败，请检查后端配置的 NAS 账号',
  NAS_AUTH_FAILED: 'NAS 鉴权失败（Token 无效或权限不足）',
  NAS_TIMEOUT_OR_CONNECTION_FAILED: '连接 NAS 超时或不可达，请检查网络与 NAS 状态',
  NAS_UPSTREAM_HTTP_ERROR: 'NAS 返回了异常状态码',
  NAS_PARSE_FAILED: 'NAS 响应解析失败（返回内容与约定不符）'
}

/** 全局 axios 实例：baseURL 固定 /api（开发时由 Vite 代理到 http://localhost:8080，不存在跨域问题） */
const request = axios.create({
  baseURL: '/api',
  timeout: 15000
})

/** 请求拦截器：有 Token 就注入 Authorization 头 */
request.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** 响应拦截器：成功直接给出业务响应体；失败统一转成带 code / status / data 的 Error */
request.interceptors.response.use(
  // 成功：response.data 即 { DataType, Result, Data }，或登录接口的 { token, tokenType, ... }
  (response) => response.data,
  async (error) => {
    // ① 拿不到响应：网络中断 / 超时 / 被代理拒绝
    if (!error.response) {
      const message =
        error.code === 'ECONNABORTED'
          ? '请求超时，请稍后重试'
          : '网络异常，无法连接后端服务（请确认后端已在 8080 端口运行）'
      notifyError(message, error.config)
      return Promise.reject(createApiError({ message, code: error.code || 'NETWORK_ERROR' }))
    }

    // ② 拿到了 4xx / 5xx
    const body = error.response.data || {}
    const code = body.code || ''
    const message =
      ERROR_CODE_MESSAGES[code] || body.message || `请求失败（HTTP ${error.response.status}）`
    notifyError(message, error.config)

    // Token 缺失 / 过期 / 无效：清掉登录态并回登录页（排障用得上响应头里的 X-Request-Id）
    if (error.response.status === 401) {
      await handleUnauthorized()
    }

    return Promise.reject(
      createApiError({ message, code, status: error.response.status, data: body })
    )
  }
)

/**
 * 构造带业务信息的 Error，方便调用方用 `err.code` / `err.status` 分支处理。
 * @returns {Error & {code: string, status: number, data: object|null}}
 */
function createApiError({ message, code = '', status = 0, data = null }) {
  const apiError = new Error(message)
  apiError.code = code
  apiError.status = status
  apiError.data = data
  return apiError
}

/**
 * 弹全局错误提示。
 * 请求配置里写了 `silent: true` 的（例如登录接口）由页面自己展示，不再弹全局提示。
 */
function notifyError(message, config) {
  if (config && config.silent) return
  ElMessage.error(message)
}

/**
 * 401 处理：清空登录态（Pinia + localStorage），并把用户送回登录页。
 *
 * 用动态 import 拿 store / router，避免 request → stores|router → api → request 的静态循环依赖。
 * ⚠️ 只清 localStorage 是不够的：store.token 仍有值的话守卫会认为「已登录」，
 *    把刚被送到 /login 的用户又弹回首页，来回打转。
 */
async function handleUnauthorized() {
  clearAuthStorage() // 兜底：即使 Pinia 尚未就绪，也要先清掉本地凭证

  const [{ useUserStore }, { default: router }] = await Promise.all([
    import('../stores/user'),
    import('../router')
  ])

  useUserStore().logout() // 内部会再清一次 localStorage，并复位 state

  const current = router.currentRoute.value
  if (current.path !== '/login') {
    router.replace({ path: '/login', query: { redirect: current.fullPath } })
  }
}

export default request
