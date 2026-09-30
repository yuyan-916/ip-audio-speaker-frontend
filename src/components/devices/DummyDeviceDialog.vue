<script setup>
// src/components/devices/DummyDeviceDialog.vue —— 添加「虚假设备」
//
// ⚠️ 后端 docs/API.md 明确：这是**凑数**接口，不是添加真实硬件。
//    · 真实设备会自动上线；这里添加的只是占位记录，状态为「历史」、**没有 IP**、
//      设备类型被强制为非正常值、**加入任务不会有任何效果**；
//    · 设备 ID 要求：8 位十六进制、**高 5 位与系统内其它设备一致（用户编码）、低 3 位不得重复**；
//    · 若之后真实设备以同一 ID 上线，该 ID 的信息会被刷新为实际值。
// 因此这里把 5 位前缀沿用已有设备、低 3 位自动挑一个未占用的值（suggestDummyDeviceId）。

import { computed, ref, watch } from 'vue'
import { DEV_NAME_MAX_BYTES, gbkByteLength, isValidDeviceId } from '@/constants/device'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 推荐的设备 ID（父页面用已有设备算出来的未占用 ID） */
  suggestedId: { type: String, default: '' },
  /** 系统内已存在的设备 ID，用于重复校验 */
  deviceIds: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const deviceId = ref('')
const devName = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    deviceId.value = props.suggestedId || ''
    devName.value = ''
  }
)

const normalizedId = computed(() => deviceId.value.trim().toUpperCase())
const idInvalid = computed(() => !isValidDeviceId(normalizedId.value))
const idExists = computed(() =>
  props.deviceIds.some((id) => String(id || '').toUpperCase() === normalizedId.value)
)
const usedBytes = computed(() => gbkByteLength(devName.value.trim()))
const nameTooLong = computed(() => usedBytes.value > DEV_NAME_MAX_BYTES)
const errorText = computed(() => {
  if (idInvalid.value) return '设备 ID 必须是 8 位十六进制，例如 00001F90'
  if (idExists.value) return '该系统内已存在同一个设备 ID，请换一个'
  if (nameTooLong.value) return `设备名称超出 ${DEV_NAME_MAX_BYTES} 字节（GBK）上限`
  return ''
})
const canSubmit = computed(() => !errorText.value)

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', { deviceId: normalizedId.value, devName: devName.value.trim() })
}
</script>

<template>
  <el-dialog v-model="visible" title="添加虚假设备" width="560px" :close-on-click-modal="false">
    <el-alert
      class="dummy-dialog__alert"
      type="warning"
      :closable="false"
      show-icon
      title="仅用于「凑数」，不是添加真实硬件"
      description="真实设备会自动上线；这里添加的只是占位记录：状态为「历史」、没有 IP、设备类型为非正常值，加入任务不会有任何效果。若之后真实设备以同一 ID 上线，信息会被刷新为实际值。"
    />

    <el-form label-position="top" @submit.prevent="handleConfirm">
      <el-form-item label="设备 ID（8 位十六进制）">
        <el-input v-model="deviceId" placeholder="00001F90" clearable />
      </el-form-item>

      <el-form-item label="设备名称（可留空，缺省为 Dummy Device added by API）">
        <el-input v-model="devName" placeholder="留空即使用默认名称" clearable />
      </el-form-item>
    </el-form>

    <p v-if="devName" class="dummy-dialog__counter" :class="{ 'dummy-dialog__counter--error': nameTooLong }">
      GBK 字节数：{{ usedBytes }} / {{ DEV_NAME_MAX_BYTES }}
    </p>

    <p class="dummy-dialog__tip">
      设备 ID 的高 5 位需与系统内其它设备一致（用户编码），低 3 位不能重复；已按现有设备自动推荐。
    </p>

    <p v-if="errorText" class="dummy-dialog__error">{{ errorText }}</p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        添加
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dummy-dialog__alert {
  margin-bottom: 16px;
}

.dummy-dialog__counter {
  margin: -8px 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dummy-dialog__counter--error {
  color: var(--el-color-danger);
}

.dummy-dialog__tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.dummy-dialog__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
