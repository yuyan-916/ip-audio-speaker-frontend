<script setup>
// src/components/devices/RenameDialog.vue —— 修改在线设备名称
//
// 约束（后端 docs/API.md「修改在线设备名称」/ docs/impl-notes.md §十二 第 5 条）：
//   · devName 转义前最多 **31 字节（GBK 内码，中文/全角按 2 字节计）**，超出后端会 400；
//   · 设备必须**在线**，且当前 NAS 版本**仅支持修改播放终端**；
//   · 成功后约 10 秒才会在设备信息里刷出新名称。
// 前端先按 GBK 规则算一遍字节数，超限直接拦下，不白跑一次请求。

import { computed, ref, watch } from 'vue'
import { DEV_NAME_MAX_BYTES, gbkByteLength } from '@/constants/device'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  device: { type: Object, default: null },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 待提交的新名称 */
const devName = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    // 预填当前名称，方便在原名基础上改
    devName.value = String((props.device && props.device.DevName) || '')
  }
)

const usedBytes = computed(() => gbkByteLength(devName.value.trim()))
const tooLong = computed(() => usedBytes.value > DEV_NAME_MAX_BYTES)
const empty = computed(() => !devName.value.trim())
const canSubmit = computed(() => !empty.value && !tooLong.value)

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', devName.value.trim())
}
</script>

<template>
  <el-dialog v-model="visible" title="修改设备名称" width="520px" :close-on-click-modal="false">
    <div v-if="device" class="rename-dialog__device">
      <span class="rename-dialog__name">当前名称：{{ device.DevName || '（空）' }}</span>
      <span class="rename-dialog__id">{{ device.DeviceID }}</span>
    </div>

    <el-alert
      class="rename-dialog__alert"
      type="warning"
      :closable="false"
      show-icon
      title="仅在线设备可改名，且当前 NAS 版本只支持修改播放终端"
      description="提交成功后约 10 秒才会在设备列表里看到新名称，请稍后刷新确认。"
    />

    <el-form label-position="top" @submit.prevent="handleConfirm">
      <el-form-item label="新设备名称">
        <el-input
          v-model="devName"
          maxlength="31"
          placeholder="例如：一楼大厅音柱"
          clearable
        />
      </el-form-item>
    </el-form>

    <p class="rename-dialog__counter" :class="{ 'rename-dialog__counter--error': tooLong }">
      GBK 字节数：{{ usedBytes }} / {{ DEV_NAME_MAX_BYTES }}（中文、全角字符按 2 字节计）
    </p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.rename-dialog__device {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}

.rename-dialog__name {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.rename-dialog__id {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.rename-dialog__alert {
  margin-bottom: 16px;
}

.rename-dialog__counter {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.rename-dialog__counter--error {
  color: var(--el-color-danger);
}
</style>
