<script setup>
// src/components/groups/GroupFormDialog.vue —— 新建 / 编辑分组（两者共用）
//
// ⚠️ 三条 NAS 语义必须在这里体现（后端 docs/impl-notes.md §十四 1）：
//   1) 编辑时**缺省 PlayerList 等于把成员清空**，所以本弹窗总是提交完整成员数组（要清空就发 []）；
//   2) 分组名上限是 31 个**字符**（中文记 1 个字符），不是设备名那种 31 个 GBK 字节；
//   3) 分组成员必须是终端设备 ID：这里只允许从「播放终端」列表里勾选，不提供自由文本框
//      （FFFFFFxx 这种分组 ID 语法上合法、语义上错误，接口层拦不住，只能靠 UI 约束）。

import { computed, ref, watch } from 'vue'
import { getDeviceState } from '@/constants/device'
import { GROUP_NAME_MAX_CHARS, isGroupNameTooLong, looksLikeGroupId } from '@/constants/group'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 待编辑的分组；null 表示新建 */
  group: { type: Object, default: null },
  /** 可选的成员终端（设备管理里的「播放终端」列表，NAS 原始字段） */
  devices: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isEdit = computed(() => Boolean(props.group))
const groupName = ref('')
const memberIds = ref([])

// 每次打开时按当前分组重置表单（避免上次编辑的内容残留）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    groupName.value = props.group ? String(props.group.GroupName || '') : ''
    memberIds.value =
      props.group && Array.isArray(props.group.PlayerList)
        ? props.group.PlayerList.map((id) => String(id == null ? '' : id).trim().toUpperCase())
        : []
  }
)

/** 成员候选项：设备 ID → 名称 + 在线状态 */
const options = computed(() =>
  props.devices.map((item) => {
    const id = String(item.DeviceID == null ? '' : item.DeviceID).trim().toUpperCase()
    const state = getDeviceState(item.State)
    return {
      value: id,
      label: `${item.DevName || '未命名'}（${id}）`,
      stateText: state.text,
      stateTag: state.tag,
      online: Number(item.State) === 0
    }
  })
)

const optionsById = computed(() =>
  Object.fromEntries(options.value.map((item) => [item.value, item]))
)
/** 已选但不在当前终端列表里的成员（设备已从系统删除等）：保存时会原样保留，这里明确提示 */
const unknownMembers = computed(() => memberIds.value.filter((id) => !optionsById.value[id]))
/** 已选成员里不在线的数量：可以先分组，但这些终端不会真正参与播放 */
const offlineCount = computed(
  () => memberIds.value.filter((id) => optionsById.value[id] && !optionsById.value[id].online).length
)
/** 疑似误填成分组 ID 的成员（FFFFFFxx） */
const suspiciousMembers = computed(() => memberIds.value.filter((id) => looksLikeGroupId(id)))

const trimmedName = computed(() => groupName.value.trim())
const nameTooLong = computed(() => isGroupNameTooLong(trimmedName.value))
const errorText = computed(() => {
  if (!trimmedName.value) {
    return '请填写分组名称（留空会让 NAS 用默认名 New Group，列表里会出现一堆同名分组）'
  }
  if (nameTooLong.value) return `分组名不能超过 ${GROUP_NAME_MAX_CHARS} 个字符（注意：是字符，不是字节）`
  return ''
})
const canSubmit = computed(() => !errorText.value)

function selectAllMembers() {
  memberIds.value = options.value.map((item) => item.value)
}

function clearMembers() {
  memberIds.value = []
}

function handleConfirm() {
  if (!canSubmit.value) return
  // 始终提交完整成员列表：NAS 的「缺省 = 清空」语义要求这样，store 也会再兜一层
  emit('confirm', { groupName: trimmedName.value, playerList: memberIds.value.slice() })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑分组' : '新建分组'"
    width="620px"
    :close-on-click-modal="false"
  >
    <el-alert
      class="group-form__alert"
      type="info"
      :closable="false"
      show-icon
      :title="isEdit ? '保存时会用下面的成员列表整体覆盖原成员' : '分组是终端设备 ID 的集合，与设备本身互不影响'"
      :description="
        isEdit
          ? 'NAS 的语义是「缺省成员 = 清空成员」，所以这里始终提交完整列表；清空成员后保存，等于把这个分组改成空分组。'
          : '新建成功后 NAS 会分配一个 2 位十六进制 ID；加入播放任务时该 ID 要写成 FFFFFFxx。'
      "
    />

    <el-form label-position="top" @submit.prevent="handleConfirm">
      <el-form-item label="分组名称">
        <el-input v-model="groupName" placeholder="例如 一楼西区" clearable />
      </el-form-item>

      <el-form-item :label="`组成员（已选 ${memberIds.length} 台终端）`">
        <div class="group-form__members">
          <div class="group-form__member-actions">
            <el-button link type="primary" size="small" @click="selectAllMembers">全选</el-button>
            <el-button link size="small" @click="clearMembers">清空</el-button>
          </div>
          <el-select
            v-model="memberIds"
            class="group-form__select"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            :reserve-keyword="false"
            placeholder="从播放终端里选择（可按名称或设备 ID 搜索）"
          >
            <el-option v-for="item in options" :key="item.value" :label="item.label" :value="item.value">
              <span class="group-form__option-label">{{ item.label }}</span>
              <el-tag :type="item.stateTag" size="small" effect="plain">{{ item.stateText }}</el-tag>
            </el-option>
          </el-select>
        </div>
      </el-form-item>
    </el-form>

    <p v-if="groupName" class="group-form__counter" :class="{ 'group-form__counter--error': nameTooLong }">
      字符数：{{ trimmedName.length }} / {{ GROUP_NAME_MAX_CHARS }}
    </p>

    <p class="group-form__tip">
      分组名上限是 31 个<b>字符</b>（与设备名的 31 个 GBK 字节不是一套口径）；成员必须是终端设备 ID，
      一个终端可以同时属于多个分组。
    </p>

    <p v-if="!options.length" class="group-form__warn">
      终端列表为空（可能尚未加载完成或拉取失败）：可以先建一个空分组，稍后在「设备管理」刷新终端列表，
      再回来勾选成员。
    </p>

    <p v-if="offlineCount" class="group-form__warn">
      已选成员中有 {{ offlineCount }} 台当前不在线 / 非工作状态，它们不会真正参与播放（分组本身可以先建好）。
    </p>

    <p v-if="unknownMembers.length" class="group-form__warn">
      有 {{ unknownMembers.length }} 个成员不在当前终端列表里（{{ unknownMembers.join('、') }}），保存时会原样保留。
    </p>

    <p v-if="suspiciousMembers.length" class="group-form__warn">
      成员里有疑似<b>分组 ID</b> 的 {{ suspiciousMembers.join('、') }}：FFFFFFxx 是任务的播放目标写法，
      分组成员应当填终端设备 ID（8 位十六进制、FFFFFF 之外的取值）。
    </p>

    <p v-if="errorText" class="group-form__error">{{ errorText }}</p>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.group-form__alert {
  margin-bottom: 16px;
}

.group-form__members {
  width: 100%;
}

.group-form__member-actions {
  margin-bottom: 4px;
  text-align: right;
}

.group-form__select {
  width: 100%;
}

.group-form__option-label {
  margin-right: 8px;
}

.group-form__counter {
  margin: -8px 0 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.group-form__counter--error {
  color: var(--el-color-danger);
}

.group-form__tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.group-form__warn {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.group-form__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
