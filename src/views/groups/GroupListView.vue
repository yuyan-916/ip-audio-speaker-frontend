<script setup>
// src/views/groups/GroupListView.vue —— 终端分组
//
// 数据来源（后端 docs/API.md「终端分组模块」）：
//   GET  /api/groups         分组列表（GroupID / GroupName / Creater / PlayerList）
//   POST /api/groups/new      新建（返回 NAS 分配的 GroupID，可直接提示用户）
//   POST /api/groups/edit     编辑（⚠️ 缺省成员 = 清空成员，所以始终提交完整成员列表）
//   POST /api/groups/delete   删除（必须带名称，NAS 用它确认目标）
//
// 成员候选项来自设备管理里的「播放终端」（GET /api/devices/player），因此这里复用 device store：
// 既不重复拉接口，也保证成员能显示成设备名。
//
// 两层错误的分工与设备管理一致：
//   · HTTP 4xx/5xx —— request.js 的拦截器已弹全局提示，这里只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，由 runWrite 捕获 NasResultError 后提示。

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import GroupFormDialog from '@/components/groups/GroupFormDialog.vue'
import GroupMembersDialog from '@/components/groups/GroupMembersDialog.vue'
import {
  describeGroupCreater,
  describeMemberName,
  groupMemberCount,
  toTaskPlayerId
} from '@/constants/group'
import { useDeviceStore } from '@/stores/device'
import { useGroupStore } from '@/stores/group'
import { NasResultError } from '@/utils/nas-result'

const deviceStore = useDeviceStore()
const groupStore = useGroupStore()

const keyword = ref('')
const groups = computed(() => groupStore.groups)
const loading = computed(() => Boolean(groupStore.loading))
/** 播放终端列表：成员候选项与成员名称都取自它 */
const players = computed(() => deviceStore.lists.player || [])

/** 关键字过滤：分组 ID / 名称 / 创建者 / 任务用 ID（FFFFFFxx）任一命中即可 */
const filteredGroups = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  if (!text) return groups.value
  return groups.value.filter((item) =>
    [item.GroupID, item.GroupName, item.Creater, toTaskPlayerId(item.GroupID)].some((field) =>
      String(field == null ? '' : field).toLowerCase().includes(text)
    )
  )
})

/** 拉取分组列表；HTTP 层错误已在拦截器里提示过，这里不再重复打扰用户 */
async function load(options = {}) {
  try {
    await groupStore.fetchGroups(options)
  } catch {
    // 401 会被拦截器转成「清登录态 + 跳登录页」，本地不需要额外处理
  }
}

onMounted(() => {
  load()
  // 成员选择与成员名称都要用播放终端列表：没拉过就补一次（失败不打断分组页）
  if (!deviceStore.loadedAt.player) {
    deviceStore.fetchList('player').catch(() => {})
  }
})

// 自动刷新（0 = 关闭）：静默加载，避免表格 loading 反复闪动
const autoRefreshSeconds = ref(0)
let autoRefreshTimer = null

watch(autoRefreshSeconds, (seconds) => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
  if (seconds > 0) {
    autoRefreshTimer = setInterval(() => load({ silent: true }), seconds * 1000)
  }
})

onUnmounted(() => {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer)
})

function handleRefresh() {
  load()
}

// ---------------- 写操作 ----------------
const submitting = ref(false)

/**
 * 统一收口写操作的 loading 与错误提示。
 * @param {() => Promise<any>} submit 真正发请求的动作
 * @param {string|((result: any) => string)} successText 成功提示；传函数时可用 submit 的返回值拼文案
 * @returns {Promise<boolean>} 是否成功（父页面据此决定关不关弹窗）
 */
async function runWrite(submit, successText) {
  submitting.value = true
  try {
    const result = await submit()
    ElMessage.success(typeof successText === 'function' ? successText(result) : successText)
    return true
  } catch (error) {
    // HTTP 层的错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
    return false
  } finally {
    submitting.value = false
  }
}

// —— 新建 / 编辑（共用一个弹窗）
const formVisible = ref(false)
const editingGroup = ref(null)

function openCreateDialog() {
  editingGroup.value = null
  formVisible.value = true
}

function openEditDialog(row) {
  editingGroup.value = row
  formVisible.value = true
}

async function handleFormConfirm({ groupName, playerList }) {
  const target = editingGroup.value
  const ok = target
    ? await runWrite(
        () => groupStore.updateGroup({ groupId: target.GroupID, groupName, playerList }),
        `分组「${groupName}」已更新（成员 ${playerList.length} 台）`
      )
    : await runWrite(
        () => groupStore.createGroup({ groupName, playerList }),
        (groupId) =>
          groupId
            ? `分组已创建，NAS 分配的 ID 是 ${groupId}`
            : '分组已创建（NAS 未回传 ID，请刷新列表查看）'
      )
  if (ok) formVisible.value = false
}

// —— 查看成员
const membersVisible = ref(false)
const membersTarget = ref(null)

function openMembersDialog(row) {
  membersTarget.value = row
  membersVisible.value = true
}

// —— 删除（必须带原名：NAS 用它确认目标分组）
async function handleDelete(row) {
  const name = row.GroupName || '未命名分组'
  try {
    await ElMessageBox.confirm(
      `确定要删除分组「${name}」（${row.GroupID}）吗？该分组下的 ${groupMemberCount(row)} 台终端会失去这层组织关系（不影响终端本身），此操作不可撤销。`,
      '删除分组',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }

  await runWrite(
    () => groupStore.removeGroup({ groupId: row.GroupID, groupName: row.GroupName }),
    `已删除分组 ${row.GroupID}`
  )
}

/** 成员预览：最多显示 3 台设备的名称（查不到就退回设备 ID），其余在表格里折成 +N */
function memberPreview(row) {
  const list = Array.isArray(row.PlayerList) ? row.PlayerList : []
  return list
    .slice(0, 3)
    .map((id) => describeMemberName(id, players.value) || String(id == null ? '' : id).toUpperCase())
}

/** 创建者展示：Creater 缺失即「管理软件创建」（手册：这类分组不带该字段） */
function createrOf(row) {
  return describeGroupCreater(row.Creater)
}

/** 复制文本（分组 ID 与任务用 ID 都常用） */
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
  <div class="groups">
    <el-card class="groups__card" shadow="never">
      <template #header>
        <div class="groups__header">
          <div class="groups__header-left">
            <span class="groups__title">终端分组</span>
            <span class="groups__count">
              共 {{ filteredGroups.length }} 个分组<span v-if="keyword">（全部 {{ groups.length }} 个）</span>
            </span>
          </div>

          <div class="groups__header-right">
            <el-input
              v-model="keyword"
              class="groups__search"
              placeholder="搜索分组 ID / 名称 / 创建者"
              clearable
            />
            <el-select v-model="autoRefreshSeconds" class="groups__interval">
              <el-option :value="0" label="不自动刷新" />
              <el-option :value="5" label="每 5 秒刷新" />
              <el-option :value="10" label="每 10 秒刷新" />
              <el-option :value="30" label="每 30 秒刷新" />
            </el-select>
            <el-button :loading="loading" @click="handleRefresh">刷新</el-button>
            <el-button type="primary" @click="openCreateDialog">新建分组</el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="groups__hint"
        type="info"
        :closable="false"
        show-icon
        title="分组是终端设备 ID 的集合：加入任务时用 FFFFFFxx，组内终端才会真正播放"
        description="同一个终端可以属于多个分组；编辑分组会整体覆盖成员列表（清空即变成空分组）。分组只影响「按组下发任务」时的播放目标，不会改动终端本身的配置。"
      />

      <el-table
        v-loading="loading"
        class="groups__table"
        :data="filteredGroups"
        row-key="GroupID"
        stripe
      >
        <el-table-column label="分组 ID" width="200">
          <template #default="{ row }">
            <div>
              <span class="groups__mono">{{ row.GroupID }}</span>
              <el-button link type="primary" size="small" @click="copyText(row.GroupID)">复制</el-button>
            </div>
            <div v-if="toTaskPlayerId(row.GroupID)" class="groups__sub">
              任务用：{{ toTaskPlayerId(row.GroupID) }}
            </div>
          </template>
        </el-table-column>

        <el-table-column label="分组名称" min-width="160">
          <template #default="{ row }">
            <span v-if="row.GroupName">{{ row.GroupName }}</span>
            <span v-else class="groups__muted">（名称为空）</span>
          </template>
        </el-table-column>

        <el-table-column label="成员" min-width="260">
          <template #default="{ row }">
            <template v-if="groupMemberCount(row)">
              <el-tag
                v-for="(name, index) in memberPreview(row)"
                :key="`${row.GroupID}-${index}`"
                class="groups__member"
                size="small"
                effect="plain"
                disable-transitions
              >
                {{ name }}
              </el-tag>
              <span v-if="groupMemberCount(row) > 3" class="groups__muted">
                等 {{ groupMemberCount(row) }} 台
              </span>
            </template>
            <span v-else class="groups__muted">空分组</span>
          </template>
        </el-table-column>

        <el-table-column label="创建者" width="160">
          <template #default="{ row }">
            <el-tag :type="createrOf(row).tag" size="small" effect="plain" disable-transitions>
              {{ createrOf(row).text }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEditDialog(row)">编辑</el-button>
            <el-button link size="small" @click="openMembersDialog(row)">查看成员</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty :description="keyword ? '没有匹配的分组' : '暂无分组'">
            <p v-if="!keyword" class="groups__empty-hint">
              分组用来把多个终端打包成播放目标：可以先建一个空分组，之后在弹窗里勾选成员，或再加进任务里使用。
            </p>
          </el-empty>
        </template>
      </el-table>
    </el-card>

    <GroupFormDialog
      v-model="formVisible"
      :group="editingGroup"
      :devices="players"
      :submitting="submitting"
      @confirm="handleFormConfirm"
    />

    <GroupMembersDialog v-model="membersVisible" :group="membersTarget" :devices="players" />
  </div>
</template>

<style scoped>
.groups__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.groups__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.groups__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.groups__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.groups__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.groups__search {
  width: 220px;
}

.groups__interval {
  width: 130px;
}

.groups__hint {
  margin-bottom: 12px;
}

.groups__mono {
  margin-right: 4px;
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 13px;
}

.groups__sub {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.groups__member {
  margin-right: 6px;
}

.groups__muted {
  color: var(--el-text-color-placeholder);
}

.groups__empty-hint {
  margin: 0;
  max-width: 460px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}
</style>
