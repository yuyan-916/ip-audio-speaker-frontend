<script setup>
// src/views/LoginView.vue —— 登录页
//
// 说明：JS 侧的 API 一律**显式 import**（虽然 vite.config.js 里配了 AutoImport），
// 因为项目设了 dts: false，没有自动生成的 .d.ts 时 IDE 无法识别自动导入的 ref / ElMessage。
// 模板里的 <el-xxx> 组件则交给 unplugin-vue-components 按需注册。

import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref(null)
const loading = ref(false)
const errorMessage = ref('')

// 默认账号（admin / admin123）只写在 placeholder 里提示，不硬编码提交值
const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

/** 登录成功后要跳回的目标：优先用守卫传来的 redirect，只接受站内路径 */
function resolveRedirect() {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/'
}

async function handleSubmit() {
  if (!formRef.value) return
  // 防重入：el-form 渲染的就是真实 <form>，回车既会触发原生提交、也可能命中别处的监听，
  // 这里兜一层，避免同时发出两次登录请求。
  if (loading.value) return

  // validate() 校验不通过会 reject，这里转成 false，红字提示由 el-form-item 自己显示
  const passed = await formRef.value.validate().catch(() => false)
  if (!passed) return

  loading.value = true
  errorMessage.value = ''
  try {
    await userStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    // 用 replace：登录页不应留在浏览器的返回栈里
    router.replace(resolveRedirect())
  } catch (error) {
    // 登录接口在 api/auth.js 里设了 silent，所以 401 / 参数错误的文案需要本页自己展示
    errorMessage.value = error?.message || '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page app-page">
    <el-card class="login-card" shadow="always">
      <template #header>
        <div class="login-card__header">
          <h1 class="login-card__title">网络音频服务器管理后台</h1>
          <p class="login-card__subtitle">请使用后端配置的账号登录</p>
        </div>
      </template>

      <el-alert
        v-if="errorMessage"
        class="login-card__alert"
        :title="errorMessage"
        type="error"
        show-icon
        :closable="false"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="用户名" prop="username">
          <!-- 回车提交交给 el-form 的原生 submit（见 <el-form> 上的 @submit.prevent），
               不要再挂 @keyup.enter，否则一次回车会发两次登录请求 -->
          <el-input
            v-model="form.username"
            placeholder="admin"
            clearable
            autocomplete="username"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="admin123"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>

        <el-form-item>
          <el-button
            class="login-card__submit"
            type="primary"
            native-type="submit"
            :loading="loading"
          >
            登 录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 420px;
}

.login-card__header {
  text-align: center;
}

.login-card__title {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.login-card__subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.login-card__alert {
  margin-bottom: 16px;
}

.login-card__submit {
  width: 100%;
}
</style>
