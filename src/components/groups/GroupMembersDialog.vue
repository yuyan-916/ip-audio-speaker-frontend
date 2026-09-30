<script setup>
// src/components/groups/GroupMembersDialog.vue —— 查看某个分组的成员（只读）
//
// 成员是「终端设备 ID」，因此拿设备管理里的播放终端列表来补全名称与状态；
// 列表里查不到的成员不隐藏，而是标注出来——那通常意味着设备已从系统删除，
// 但它仍留在分组里（NAS 不会自动清理），排障时正需要看到这一点。

import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { getDeviceState } from '@/constants/device'
import { findMemberDevice, looksLikeGroupId, toTaskPlayerId } from '@/constants/group'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 要查看的分组（NAS 原始字段） */
  group: { type: Object, default: null },
  /** 播放终端列表，用于补全成员名称 / 状态 */
  devices: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const rows = computed(() => {
  const list = props.group && Array.isArray(props.group.PlayerList) ? props.group.PlayerList : []
  return list.map((id) => {
    const deviceId = String(id == null ? '' : id).trim().toUpperCase()
    const device = findMemberDevice(deviceId, props.devices)
    return {
      deviceId,
      devName: device ? device.DevName || '' : '',
      state: device ? getDeviceState(device.State) : null,
      ip: device ? device.IP || '' : '',
      known: Boolean(device),
      suspicious: looksLikeGroupId(deviceId)
    }
  })
})

const groupId = computed(() => String((props.group && props.group.GroupID) || ''))
/** 该分组放进任务播放目标时要用的 8 位 ID */
const taskPlayerId = computed(() => toTaskPlayerId(groupId.value))

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${text}`)
  } catch {
    ElMessage.warning('复制失败，请手动选中复制')
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="分组成员" width="760px">
    <el-alert
      class="group-members__alert"
      type="info"
      :closable="false"
      show-icon
      :title="`「${(group && group.GroupName) || '未命名分组'}」 · 共 ${rows.length} 台终端`"
      :description="
        taskPlayerId
          ? `分组 ID ${groupId}；加入播放任务时要写成 ${taskPlayerId}（任务的目标字段不接受 2 位分组 ID）。`
          : '该分组没有可用的分组 ID。'
      "
    />

    <el-table class="group-members__table" :data="rows" stripe row-key="deviceId">
      <el-table-column label="设备 ID" width="180">
        <template #default="{ row }">
          <span class="group-members__mono">{{ row.deviceId }}</span>
          <el-button link type="primary" size="small" @click="copyText(row.deviceId)">复制</el-button>
        </template>
      </el-table-column>

      <el-table-column label="设备名称" min-width="140">
        <template #default="{ row }">
          <span v-if="row.devName">{{ row.devName }}</span>
          <span v-else class="group-members__muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag v-if="row.state" :type="row.state.tag" size="small" effect="plain">
            {{ row.state.text }}
          </el-tag>
          <span v-else class="group-members__muted">未知</span>
        </template>
      </el-table-column>

      <el-table-column label="IP" width="130">
        <template #default="{ row }">
          <span v-if="row.ip">{{ row.ip }}</span>
          <span v-else class="group-members__muted">-</span>
        </template>
      </el-table-column>

      <el-table-column label="备注" min-width="180">
        <template #default="{ row }">
          <span v-if="row.suspicious" class="group-members__warn">
            疑似填成了分组 ID（FFFFFFxx 只用于任务目标）
          </span>
          <span v-else-if="!row.known" class="group-members__warn">
            不在当前终端列表里（设备可能已删除 / 离线过久）
          </span>
          <span v-else class="group-members__muted">-</span>
        </template>
      </el-table-column>

      <template #empty>
        <div class="group-members__empty">
          <p>该分组是<b>空分组</b>：成员为空时 NAS 仍会保留这个分组，但加入任务后不会有任何终端播放。</p>
        </div>
      </template>
    </el-table>

    <p class="group-members__tip">
      分组成员必须是终端设备 ID；一个终端可以同时属于多个分组。要增删成员请用列表页的「编辑」。
    </p>

    <template #footer>
      <el-button v-if="taskPlayerId" @click="copyText(taskPlayerId)">复制任务用 ID（{{ taskPlayerId }}）</el-button>
      <el-button type="primary" @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.group-members__alert {
  margin-bottom: 16px;
}

.group-members__mono {
  margin-right: 8px;
  font-family: Consolas, Monaco, monospace;
}

.group-members__muted {
  color: var(--el-text-color-secondary);
}

.group-members__warn {
  font-size: 12px;
  color: var(--el-color-warning);
}

.group-members__empty p {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.group-members__tip {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
