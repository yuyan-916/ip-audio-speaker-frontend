import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // 自动引入 Vue / Vue Router / Pinia 的常用 API 与 Element Plus 的组件 / API
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: false // 纯 JS 项目，不生成 auto-imports.d.ts
    }),
    // 自动按需注册 Element Plus 组件（无需手写 import，也无需 app.use(ElementPlus)）
    Components({
      resolvers: [ElementPlusResolver()],
      dts: false // 纯 JS 项目，不生成 components.d.ts
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      // 后端路由自身带 /api 前缀，因此不做 rewrite
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
