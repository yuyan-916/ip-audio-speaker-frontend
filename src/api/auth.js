// src/api/auth.js —— 鉴权接口
import request from './request'

/**
 * 登录换取 Token —— POST /api/auth/login（无需鉴权）
 *
 * 这是**唯一**一个响应体也是小驼峰的接口（本项目自定义）：
 * `{ token, tokenType: 'Bearer', expiresIn, username }`（expiresIn 单位：秒，默认 43200 = 12 小时）。
 *
 * @param {string} username 后端配置的账号（app.security.username，与 NAS 账号无关）
 * @param {string} password 后端配置的口令
 * @returns {Promise<{token: string, tokenType: string, expiresIn: number, username: string}>}
 */
export function login(username, password) {
  // silent: true —— 登录失败的提示由登录页内联展示（ElAlert），不要再弹全局 ElMessage，
  // 否则同一句“用户名或密码错误”会出现两遍。
  return request.post('/auth/login', { username, password }, { silent: true })
}
