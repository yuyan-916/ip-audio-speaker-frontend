// src/stores/user.js —— 登录态仓库（Token / 用户名）
import { defineStore } from 'pinia'
import { login as loginApi } from '../api/auth'
import { clearAuthStorage, getToken, getUsername, setToken, setUsername } from '../api/request'

export const useUserStore = defineStore('user', {
  /** 初值直接取自 localStorage：刷新页面后仍然算已登录 */
  state: () => ({
    token: getToken(),
    username: getUsername()
  }),

  getters: {
    /** 是否已登录（路由守卫据此放行 / 拦截） */
    isLoggedIn: (state) => Boolean(state.token)
  },

  actions: {
    /**
     * 登录：调 POST /api/auth/login，成功后把 Token 与用户名同时写入 state 与 localStorage。
     * 失败时不做任何状态变更，异常原样抛给登录页展示。
     * @returns {Promise<string>} 登录用户名
     */
    async login(username, password) {
      const data = await loginApi(username, password)
      this.token = data.token || ''
      this.username = data.username || username
      setToken(this.token)
      setUsername(this.username)
      return this.username
    },

    /** 退出登录：清空 state 与 localStorage（JWT 由前端丢弃即可，无需调后端） */
    logout() {
      this.token = ''
      this.username = ''
      clearAuthStorage()
    }
  }
})
