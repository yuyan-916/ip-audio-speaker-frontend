<script setup>
// src/components/devicePermits/DevicePermitEditDialog.vue —— 设置某台设备的权限数据
//
// 契约：ip-audio-speaker-backend/docs/API.md「设备权限模块」（NAS 手册 P14-18，见 docs/impl-notes.md §九）。
//
// 这个弹窗承担四件事（都是手册里有明文依据的）：
//   1) **先读再改**：打开时总是 `GET /api/device-permits/{deviceId}` 读一次现状；`Result=1` 表示
//      「尚未设置」，按三类清单都空处理（不是错误）。读失败时**禁止保存**（避免用一份读不全的数据覆盖 NAS）；
//   2) 三类清单在 UI 上只有「选择器 + 显示友好名」，提交时统一转成 ID（分组 2 位 → FFFFFFxx）；
//   3) 前端先按后端 DTO 的口径校验（格式 / 每类 248 项 / 不能包含设备自身），不合法就禁用保存；
//   4) **三类都为空 = 清除**（手册语义）：此时明确警告并做二次确认，再提交三个空数组。
//
// 提示：本弹窗顶部与底部都把「HTTP API 用户无需设置权限数据」与「三类都为空 = 清除」写出来，
//       因为这个模块最容易被误解成「必须配」或者「配空了是出错」。

import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  DEVICE_TYPES_NEED_PERMIT,
  HINT_CAPTURER_SCOPE,
  HINT_DEVICE_FORMAT,
  HINT_EMPTY_ALL,
  HINT_GROUP_FORMAT,
  HINT_LIST_MAX,
  HINT_NO_NEED,
  HINT_NOT_SET_YET,
  HINT_PRIVATE_GROUP,
  HINT_SERVER_NO_CHECK,
  HINT_SELF_EXCLUDE,
  buildPermitPayload,
  emptyPermit,
  isPermitEmpty,
  isPermitGroupFormId,
  needsPermitDeviceType,
  normalizePermitCode,
  normalizePermitId,
  normalizePermitIds,
  permitSummary,
  validatePermitPayload
} from '@/constants/devicePermit'
import { useDevicePermitStore } from '@/stores/devicePermit'
import { NasResultError } from '@/utils/nas-result'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 目标设备 ID（8 位十六进制） */
  deviceId: { type: String, default: '' },
  /** 目标设备类型（2 位十六进制，来自设备列表；拿不到时传空串） */
  deviceType: { type: String, default: '' },
  /** 目标设备名称（来自设备列表；目录接口本身没有名称字段，拿不到时传空串） */
  deviceName: { type: String, default: '' },
  /** 分组候选项（buildPermitGroupOptions 的产物，value 已是 FFFFFFxx） */
  groupOptions: { type: Array, default: () => [] },
  /** 播放终端候选项（buildPlayerOptions 的产物） */
  playerOptions: { type: Array, default: () => [] },
  /** 采播器候选项（buildCapturerOptions 的产物） */
  capturerOptions: { type: Array, default: () => [] },
  /** 父页面正在提交（保存按钮转圈） */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const permitStore = useDevicePermitStore()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 三类清单的表单值（元素都是 ID：分组是 FFFFFFxx，设备是 8 位十六进制） */
const permitGroup = ref([])
const permitPlayer = ref([])
const permitCapturer = ref([])

/** 是否处于「该设备尚未设置权限数据」（Result=1）的状态 */
const notSet = ref(false)
/** 读取失败的原因（非空时禁止保存，并提供「重试」） */
const readFailed = ref('')
/** 用户是否动过表单：动过之后，后台读回来的值不再覆盖用户的输入 */
const touched = ref(false)

const normalizedDeviceId = computed(() => normalizePermitId(props.deviceId))
const deviceType = computed(() => normalizePermitCode(props.deviceType))
const needsPermit = computed(() => needsPermitDeviceType(deviceType.value))
const typeText = computed(() =>
  deviceType.value
    ? `${deviceType.value} · ${DEVICE_TYPES_NEED_PERMIT[deviceType.value] || '手册的 9 种「需要权限数据」类型之外'}`
    : '设备类型未知（设备列表里没找到这台设备）'
)

const reading = computed(() => permitStore.permitLoading)

/** 用一份权限数据（缓存的或刚读到的）铺表单 */
function seed(permit) {
  const source = permit || emptyPermit()
  permitGroup.value = normalizePermitIds(source.permitGroup)
  permitPlayer.value = normalizePermitIds(source.permitPlayer)
  permitCapturer.value = normalizePermitIds(source.permitCapturer)
}

/** 用户动过表单后置位（选择器的 change 只由用户交互触发，程序赋值不会走这里） */
function markTouched() {
  touched.value = true
}

/** 读一次该设备在 NAS 上的权限数据 */
async function loadPermit() {
  const id = normalizedDeviceId.value
  if (!id) return
  readFailed.value = ''
  try {
    const permit = await permitStore.fetchPermit(id)
    notSet.value = permit.notSet
    // 读取期间用户已经改过表单就不覆盖，只保留用户的操作
    if (!touched.value) seed(permit)
  } catch (error) {
    // HTTP 层的错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
    readFailed.value =
      error instanceof NasResultError
        ? error.message
        : '读取该设备的权限数据失败（网络或 NAS 异常）：为避免用不完整的数据覆盖 NAS，请重试后再保存'
  }
}

// 每次打开：先用缓存铺一屏（避免白屏），再回源读一次
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    touched.value = false
    readFailed.value = ''
    notSet.value = false
    seed(permitStore.cachedPermit(normalizedDeviceId.value))
    loadPermit()
  }
)

// ---------------- 校验与提交 ----------------

/** 提交体：总是带齐三个数组（三类都空 = 清除），顺便做「大写 + 去重」 */
const payload = computed(() =>
  buildPermitPayload(normalizedDeviceId.value, {
    permitGroup: permitGroup.value,
    permitPlayer: permitPlayer.value,
    permitCapturer: permitCapturer.value
  })
)

/** 校验错误文案（空数组 = 可以保存）；判据与后端 DTO 一致 */
const errors = computed(() => validatePermitPayload(payload.value, normalizedDeviceId.value))

/** 三类都为空——保存即清除（要二次确认） */
const willClear = computed(() => isPermitEmpty(payload.value))

const canSubmit = computed(
  () => Boolean(normalizedDeviceId.value) && !errors.value.length && !readFailed.value && !reading.value
)

/** 已选但不在候选项里（设备 / 分组列表没加载出来，或对象已被删除）：保存时原样保留，这里明确提示 */
function unknownOf(ids, options) {
  const known = new Set(options.map((item) => item.value))
  return ids.filter((id) => !known.has(id))
}

const unknownGroups = computed(() => unknownOf(permitGroup.value, props.groupOptions))
const unknownPlayers = computed(() => unknownOf(permitPlayer.value, props.playerOptions))
const unknownCapturers = computed(() => unknownOf(permitCapturer.value, props.capturerOptions))
/** 终端 + 采播器里「不在设备列表里」的 ID（提示文案合并成一条，免得弹窗太长） */
const unknownDevices = computed(() => [...unknownPlayers.value, ...unknownCapturers.value])

/** 终端 / 采播器清单里填了分组写法（FFFFFFxx）——语法上是「设备 ID」的近亲，语义上完全不同 */
const groupFormIds = computed(() =>
  [...permitPlayer.value, ...permitCapturer.value].filter((id) => isPermitGroupFormId(id))
)

const summaryText = computed(() => permitSummary(payload.value))

async function handleConfirm() {
  if (!canSubmit.value) return

  const body = payload.value
  if (isPermitEmpty(body)) {
    try {
      await ElMessageBox.confirm(
        `三类清单都是空的：保存后会清除 ${body.deviceId} 的权限数据（手册定义的语义，不是错误）。确定继续吗？`,
        '将清除该设备的权限数据',
        { confirmButtonText: '清除', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return // 用户取消
    }
  }

  emit('confirm', body)
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="设置设备权限数据"
    width="820px"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting"
    :show-close="!submitting"
    destroy-on-close
  >
    <el-alert
      class="permit-form__alert"
      type="info"
      :closable="false"
      show-icon
      title="HTTP API 用户本身无需设置权限数据"
    >
      <template #default>
        <p class="permit-form__tip">{{ HINT_NO_NEED }}</p>
      </template>
    </el-alert>

    <div class="permit-form__target">
      <span class="permit-form__label">目标设备</span>
      <span class="permit-form__mono">{{ normalizedDeviceId || '（未选择）' }}</span>
      <el-tag v-if="deviceName" size="small" effect="plain" disable-transitions>{{ deviceName }}</el-tag>
      <el-tag size="small" effect="plain" disable-transitions>{{ typeText }}</el-tag>
      <el-button
        v-if="normalizedDeviceId"
        size="small"
        text
        type="primary"
        :disabled="reading"
        @click="loadPermit"
      >
        重新读取
      </el-button>
    </div>

    <el-alert
      v-if="deviceType && !needsPermit"
      class="permit-form__alert"
      type="warning"
      :closable="false"
      show-icon
      title="这台设备的类型不在手册列出的「需要权限数据」类型里"
      :description="`手册只对 ${Object.keys(DEVICE_TYPES_NEED_PERMIT).join(' / ')} 这些类型建议设置权限数据；给其它类型设置通常没有意义（服务器不会拒绝）。`"
    />

    <el-alert
      v-if="notSet"
      class="permit-form__alert"
      type="success"
      :closable="false"
      show-icon
      :title="HINT_NOT_SET_YET"
      description="三类清单当前都是空的，保存后会为这台设备创建一份权限数据。"
    />

    <el-alert
      v-if="readFailed"
      class="permit-form__alert"
      type="error"
      :closable="false"
      show-icon
      title="读取权限数据失败，已禁止保存"
      :description="readFailed"
    />

    <el-form label-position="top" @submit.prevent="handleConfirm">
      <el-form-item :label="`分组清单（已选 ${permitGroup.length} 项）`">
        <el-select
          v-model="permitGroup"
          class="permit-form__select"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :reserve-keyword="false"
          :loading="reading"
          :disabled="reading"
          placeholder="从分组里选择；也可直接输入 FFFFFFxx"
          @change="markTouched"
        >
          <el-option v-for="item in groupOptions" :key="item.value" :label="item.label" :value="item.value">
            <span class="permit-form__option">{{ item.label }}</span>
            <el-tag v-if="item.private" type="warning" size="small" effect="plain">私有分组</el-tag>
          </el-option>
        </el-select>
        <div class="permit-form__sub">{{ HINT_GROUP_FORMAT }}</div>
      </el-form-item>

      <el-form-item :label="`终端清单（已选 ${permitPlayer.length} 项）`">
        <el-select
          v-model="permitPlayer"
          class="permit-form__select"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :reserve-keyword="false"
          :loading="reading"
          :disabled="reading"
          placeholder="从播放终端里选择；也可直接输入 8 位十六进制设备 ID"
          @change="markTouched"
        >
          <el-option v-for="item in playerOptions" :key="item.value" :label="item.label" :value="item.value">
            <span class="permit-form__option">{{ item.label }}</span>
            <el-tag :type="item.stateTag" size="small" effect="plain">{{ item.stateText }}</el-tag>
            <span v-if="item.typeText" class="permit-form__type">{{ item.typeText }}</span>
          </el-option>
        </el-select>
        <div class="permit-form__sub">{{ HINT_DEVICE_FORMAT }}</div>
      </el-form-item>

      <el-form-item :label="`采播器清单（已选 ${permitCapturer.length} 项）`">
        <el-select
          v-model="permitCapturer"
          class="permit-form__select"
          multiple
          filterable
          allow-create
          default-first-option
          collapse-tags
          collapse-tags-tooltip
          :reserve-keyword="false"
          :loading="reading"
          :disabled="reading"
          placeholder="从采播器 / 对讲设备里选择；也可直接输入设备 ID"
          @change="markTouched"
        >
          <el-option v-for="item in capturerOptions" :key="item.value" :label="item.label" :value="item.value">
            <span class="permit-form__option">{{ item.label }}</span>
            <el-tag :type="item.stateTag" size="small" effect="plain">{{ item.stateText }}</el-tag>
            <span class="permit-form__type">{{ item.typeText || item.source }}</span>
          </el-option>
        </el-select>
        <div class="permit-form__sub">{{ HINT_CAPTURER_SCOPE }}</div>
      </el-form-item>
    </el-form>

    <div class="permit-form__summary">当前：{{ summaryText }}</div>

    <p class="permit-form__tip">{{ HINT_SELF_EXCLUDE }}；{{ HINT_EMPTY_ALL }}。</p>
    <p class="permit-form__tip">{{ HINT_LIST_MAX }}；{{ HINT_SERVER_NO_CHECK }}。</p>
    <p class="permit-form__tip">{{ HINT_PRIVATE_GROUP }}。</p>

    <p v-if="willClear" class="permit-form__warn">
      三类清单都是空的：保存后会<b>清除</b>该设备的权限数据（手册定义的语义，不是错误）。
    </p>
    <p v-if="unknownGroups.length" class="permit-form__warn">
      分组清单里有 {{ unknownGroups.length }} 个 ID 不在当前分组列表里（{{ unknownGroups.join('、') }}）：
      可能是分组已删除，也可能只是分组列表没拉全；保存时会原样保留。
    </p>
    <p v-if="unknownDevices.length" class="permit-form__warn">
      设备清单里有 {{ unknownDevices.length }} 个 ID 不在当前设备列表里（{{ unknownDevices.join('、') }}）：
      可能是设备已删除，也可能只是列表没拉全；保存时会原样保留。
    </p>
    <p v-if="groupFormIds.length" class="permit-form__warn">
      终端 / 采播器清单里有分组写法（{{ groupFormIds.join('、') }}）：FFFFFFxx 属于「分组」，只能填在分组清单里。
    </p>

    <el-alert
      v-if="errors.length"
      class="permit-form__alert"
      type="error"
      :closable="false"
      show-icon
      :title="`有 ${errors.length} 处问题，修正后才能保存`"
    >
      <template #default>
        <p v-for="(item, index) in errors" :key="index" class="permit-form__error-line">{{ item }}</p>
      </template>
    </el-alert>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button v-if="willClear" type="danger" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        清除并保存
      </el-button>
      <el-button v-else type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        {{ notSet ? '创建权限数据' : '保存' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.permit-form__alert {
  margin-bottom: 12px;
}

.permit-form__target {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.permit-form__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.permit-form__mono {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
  font-weight: 600;
}

.permit-form__select {
  width: 100%;
}

.permit-form__option {
  margin-right: 8px;
}

.permit-form__type {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permit-form__sub {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.permit-form__summary {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.permit-form__tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.permit-form__warn {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.permit-form__error-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}
</style>
