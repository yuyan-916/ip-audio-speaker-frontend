import { createApp } from 'vue'
import { createPinia } from 'pinia'

// Element Plus 组件/API 由 unplugin 按需自动引入；
// 这里额外引入一次完整样式（方案 A），确保 ElMessage / ElMessageBox 等动态组件不缺样式
import 'element-plus/dist/index.css'

import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
