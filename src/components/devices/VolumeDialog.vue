<script setup>
// src/components/devices/VolumeDialog.vue —— 设置终端基础音量
//
// ⚠️ NAS 的音量语义是反的：**0 = 0dB（最大）**，数值越大越小声，**127 = 静音**。
// 这里刻意保留与 NAS 一致的原始数值（不翻转成「响度」），
// 免得以后任务模块里的 TaskVolume 与这里出现两种含义。
//
// 组件只负责取新值，真正的请求由父页面发起（父页面据结果决定是否关弹窗）。

import { computed, ref, watch } from 'vue'
import { formatVolume } from '@/constants/device'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 目标设备（列表里的原始行数据） */
  device: { type: Object, default: null },
  /** 父页面是否正在提交（禁用按钮 + 转圈） */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 待提交的音量值 */
const volume = ref(0)
/** 打开弹窗时的原始值，用于「恢复」按钮 */
const originalVolume = ref(0)

// 每次打开都从设备当前值开始，取消后不留脏数据
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const current = Number(props.device && props.device.Volume)
    volume.value = Number.isFinite(current) ? current : 0
    originalVolume.value = volume.value
  }
)

function handleConfirm() {
  emit('confirm', volume.value)
}
</script>

<template>
  <el-dialog v-model="visible" title="设置基础音量" width="520px" :close-on-click-modal="false">
    <div v-if="device" class="volume-dialog__device">
      <span class="volume-dialog__name">{{ device.DevName || '未命名设备' }}</span>
      <span class="volume-dialog__id">{{ device.DeviceID }}</span>
    </div>

    <el-alert
      class="volume-dialog__alert"
      type="info"
      :closable="false"
      show-icon
      title="0 = 最大音量（0dB），数值越大声音越小，127 = 静音"
      description="基础音量影响该终端上的所有任务；终端实际音量 = 基础音量 + 任务音量。"
    />

    <el-slider v-model="volume" :min="0" :max="127" :step="1" show-input />

    <p class="volume-dialog__current">当前设置：{{ formatVolume(volume) }}</p>

    <div class="volume-dialog__quick">
      <el-button size="small" @click="volume = 0">最大（0）</el-button>
      <el-button size="small" @click="volume = 127">静音（127）</el-button>
      <el-button size="small" :disabled="volume === originalVolume" @click="volume = originalVolume">
        恢复当前值（{{ originalVolume }}）
      </el-button>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleConfirm">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.volume-dialog__device {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 12px;
}

.volume-dialog__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.volume-dialog__id {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.volume-dialog__alert {
  margin-bottom: 16px;
}

.volume-dialog__current {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.volume-dialog__quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
</style>
