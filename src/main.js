import { createApp } from 'vue'
import { createPinia } from 'pinia'

// Element Plus 组件/API 由 unplugin 按需自动引入；
// 这里额外引入一次完整样式（方案 A），确保 ElMessage / ElMessageBox 等动态组件不缺样式
import 'element-plus/dist/index.css'

// 自定义主题（设计 token + --el-* 变量覆盖）与全局样式。
// ⚠️ 必须在 element-plus/dist/index.css **之后**引入：CSS 变量与选择器都是后者胜，
//    顺序反了会被 EP 的默认主题盖回去（详见 src/styles/theme.css 顶部说明）。
// 两个文件都是**纯 CSS**（没用任何 Sass 语法），Vite 直接处理，
// 不需要 sass / sass-embedded 等预处理器依赖。
import './styles/theme.css'
import './styles/global.css'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
