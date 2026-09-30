<script setup>
// src/views/priority/PriorityListView.vue —— 任务优先级（任务请求源优先策略）
//
// 数据来源（后端 docs/API.md「任务优先级模块」，NAS 手册 P81-84）：
//   GET  /api/priority   13 个任务类的主优先级 + 处理规则
//   POST /api/priority   设置（⚠️ **部分更新**：只影响请求里出现的任务类）
//
// 三条必须写在页面上的口径（字典与文案都收在 constants/priority.js）：
//   1) 主优先级的**接口值是 1~16**，NAS **实际执行时用 0~15**（比接口值小 1）；
//   2) 设置是**部分更新**：只提交真正改过的行，未出现的任务类保持不变；
//   3) 优先等级**只在同一任务类内比较**，不是全局优先级。
//
// 页面数据流（这也是「只提交改过的行」能成立的原因）：
//   NAS 现状（store.rules）→ 读一次铺成 **基线 baselineRows** 与 **草稿 draftRows** →
//   用户的编辑只落在草稿上 → 保存时 `changedPriorityRules(草稿, 基线)` 只挑出差异行 →
//   写入成功后 store 重新拉一次，watch 到 lastLoadedAt 变化就用新现状重铺基线 + 草稿。
//   「刷新」会重铺（有未保存改动时先确认）、「重置」只重铺草稿、行内「恢复」只回滚这一行。
//
// 两层错误的分工与其它模块一致：
//   · HTTP 4xx/5xx —— api/request.js 的拦截器已弹全局提示，页面只需吞掉异常；
//   · HTTP 200 + Result !== 0 —— NAS 业务拒绝，捕获 NasResultError 后提示。

import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  HINT_1_TO_16,
  HINT_FINAL_PRIORITY,
  HINT_PARTIAL_UPDATE,
  HINT_RESERVED_CLASS,
  HINT_SAME_CLASS_ONLY,
  HINT_TEMP_TASK_CLASS,
  HINT_TWO_FIELDS_REQUIRED,
  TASK_CLASS_COUNT,
  TCPRIORITY_MAX,
  TCPRIORITY_MIN,
  TC_RULE_OPTIONS,
  TEMP_TASK_CLASS,
  changedPriorityRules,
  describeExecutedPriority,
  describePriorityChange,
  describeTaskClass,
  isCompletePriorityRule,
  isPriorityRuleChanged,
  isValidTCPriority,
  isValidTCRule,
  pendingPriorityRows
} from '@/constants/priority'
import { usePriorityStore } from '@/stores/priority'
import { NasResultError } from '@/utils/nas-result'

const priorityStore = usePriorityStore()

/** 用户正在编辑的草稿（13 行；顺序恒为 1~13） */
const draftRows = ref([])
/** 基线：本次从 NAS 读到的值（「改没改过」「保存发哪几行」都跟它比） */
const baselineRows = ref([])

const loading = computed(() => Boolean(priorityStore.loading))
const saving = computed(() => Boolean(priorityStore.saving))
const returnedCount = computed(() => priorityStore.returnedCount)
const lastLoadedText = computed(() =>
  priorityStore.lastLoadedAt ? new Date(priorityStore.lastLoadedAt).toLocaleString() : '还没读过'
)

/** 用 NAS 现状重铺基线 + 草稿（每次成功读取后都会走到这里） */
function seedDraft() {
  const rows = priorityStore.ruleRows.map((row) => ({ ...row }))
  baselineRows.value = rows.map((row) => ({ ...row }))
  draftRows.value = rows.map((row) => ({ ...row }))
}

// 首次进入先用 store 里已有的数据铺一次（Pinia 的 store 跨路由保留），避免刷新过程中表格空着
seedDraft()

// 每次读成功（进页面 / 手动刷新 / 保存后重拉）都重铺草稿：显示的永远是 NAS 上的真实值
watch(
  () => priorityStore.lastLoadedAt,
  () => seedDraft()
)

onMounted(() => {
  load()
})

// ---------------- 读取 ----------------

async function load({ silent = false } = {}) {
  try {
    await priorityStore.fetchPriority({ silent })
  } catch (error) {
    // HTTP 层错误拦截器已提示；这里只补 NAS 业务拒绝（HTTP 200 + Result !== 0）
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}

/** 手动刷新：有未保存的修改时先确认（刷新会把草稿覆盖成 NAS 上的值） */
async function handleRefresh() {
  if (changedCount.value) {
    try {
      await ElMessageBox.confirm(
        `有 ${changedCount.value} 个任务类的修改还没保存，刷新会用 NAS 上的当前值覆盖这些修改。要继续吗？`,
        '刷新会丢弃未保存的修改',
        { confirmButtonText: '刷新', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return // 用户取消
    }
  }
  await load()
}

// ---------------- 变更检测 ----------------

/** 相对基线改过的行（已填齐，可直接提交的） */
const changedRows = computed(() => changedPriorityRules(draftRows.value, baselineRows.value))
/** 改过但没填齐的行（页面拦住保存） */
const pendingRows = computed(() => pendingPriorityRows(draftRows.value, baselineRows.value))
const changedCount = computed(() => changedRows.value.length)
const pendingCount = computed(() => pendingRows.value.length)
const canSave = computed(() => changedCount.value > 0 && pendingCount.value === 0 && !saving.value)

/** 没填完的任务类清单（提示文案用） */
const pendingText = computed(() =>
  pendingRows.value.map((row) => describeTaskClass(row.taskClass)).join('、')
)

/** 取基线上的同类行 */
function baselineOf(taskClass) {
  const num = Number(taskClass)
  return baselineRows.value.find((row) => Number(row.taskClass) === num)
}

/** 这一行有没有被改过（表格里打「已修改」标签、启用「恢复」按钮都看它） */
function rowChanged(row) {
  return isPriorityRuleChanged(row, baselineOf(row.taskClass))
}

/** 这一行缺了什么（没填齐时提示） */
function pendingReason(row) {
  const missing = []
  if (!isValidTCPriority(row.tcPriority)) missing.push('主优先级')
  if (!isValidTCRule(row.tcRule)) missing.push('处理规则')
  return missing.length ? `缺${missing.join('与')}` : '未填写完整'
}

/** 处理规则的说明（跟在选择框下面，把「原任务优先 / 新任务优先」到底是什么意思讲清） */
function tcRuleHint(value) {
  const option = TC_RULE_OPTIONS.find((item) => item.value === Number(value))
  return option ? option.hint : '（未设置，保存前必须选一个）'
}

const footerText = computed(() => {
  if (saving.value) return '正在提交变更…'
  if (pendingCount.value) return `有 ${pendingCount.value} 个任务类还没填完，补齐后才能保存`
  if (changedCount.value) {
    return `已修改 ${changedCount.value} 个任务类：保存时只提交这 ${changedCount.value} 条，其余任务类保持不变`
  }
  return '没有未保存的修改（保存按钮已禁用）'
})

// ---------------- 写操作 ----------------

/** 行内「恢复」：只把这一行回滚成基线值 */
function handleResetRow(row) {
  const base = baselineOf(row.taskClass)
  if (!base) return
  row.tcPriority = base.tcPriority
  row.tcRule = base.tcRule
}

/** 「重置」：整表回滚成基线值（不提交） */
function handleResetAll() {
  if (!changedCount.value) return
  seedDraft()
  ElMessage.info('已恢复到本次读取到的值（尚未提交到 NAS）')
}

/** 「保存」：二次确认逐行列出变更，然后**只提交改过的行** */
async function handleSave() {
  if (!canSave.value) return

  const changes = changedRows.value
    .map((row) => describePriorityChange(row, baselineOf(row.taskClass)))
    .filter(Boolean)

  try {
    await ElMessageBox.confirm(
      `即将提交 ${changes.length} 个任务类的策略（只影响这些任务类，其余保持不变）：${changes.join('；')}。` +
        `主优先级是接口值（${TCPRIORITY_MIN}~${TCPRIORITY_MAX}），NAS 实际执行时用「值 - 1」。`,
      '保存任务源优先策略',
      { confirmButtonText: '保存', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return // 用户取消
  }

  try {
    await priorityStore.updateRules(changedRows.value)
    // store 已经重新拉过一次列表（watch 会把新值重铺成新的基线 + 草稿）
    ElMessage.success(`已保存 ${changes.length} 个任务类的策略，并按 NAS 返回的当前值刷新了列表`)
  } catch (error) {
    // HTTP 层错误拦截器已提示；NAS 业务拒绝（Result !== 0）在这里补一次
    if (error instanceof NasResultError) ElMessage.error(error.message)
  }
}
</script>

<template>
  <div class="priority app-page">
    <el-card class="priority__card" shadow="never">
      <template #header>
        <div class="priority__header">
          <div class="priority__header-left">
            <span class="priority__title">任务优先级</span>
            <span class="priority__count">
              {{ TASK_CLASS_COUNT }} 个任务类<span v-if="returnedCount">，NAS 已返回 {{ returnedCount }} 条</span
              ><span v-if="changedCount">，已修改 {{ changedCount }} 条</span>
            </span>
          </div>

          <div class="priority__header-right">
            <span class="priority__loaded">上次读取：{{ lastLoadedText }}</span>
            <el-button :loading="loading" :disabled="saving" @click="handleRefresh">刷新</el-button>
            <el-button :disabled="!changedCount || saving" @click="handleResetAll">重置</el-button>
            <el-button type="primary" :loading="saving" :disabled="!canSave" @click="handleSave">
              保存<span v-if="changedCount">（{{ changedCount }} 条）</span>
            </el-button>
          </div>
        </div>
      </template>

      <el-alert
        class="priority__hint"
        type="info"
        :closable="false"
        show-icon
        title="保存是「部分更新」：只提交改过的任务类，未出现的任务类保持不变"
      >
        <template #default>
          <p class="priority__hint-line">{{ HINT_1_TO_16 }}。</p>
          <p class="priority__hint-line">{{ HINT_PARTIAL_UPDATE }}。</p>
          <p class="priority__hint-line">{{ HINT_SAME_CLASS_ONLY }}；{{ HINT_FINAL_PRIORITY }}。</p>
          <p class="priority__hint-line">{{ HINT_RESERVED_CLASS }}；{{ HINT_TEMP_TASK_CLASS }}。</p>
        </template>
      </el-alert>

      <el-alert
        v-if="pendingCount"
        class="priority__warn"
        type="warning"
        :closable="false"
        show-icon
        :title="`有 ${pendingCount} 个任务类没填完（${pendingText}），补齐后才能保存`"
        :description="HINT_TWO_FIELDS_REQUIRED"
      />

      <el-table
        v-loading="loading"
        class="priority__table"
        :data="draftRows"
        row-key="taskClass"
        stripe
      >
        <el-table-column label="任务类" min-width="230">
          <template #default="{ row }">
            <div class="priority__class">{{ describeTaskClass(row.taskClass) }}</div>
            <div class="priority__tags">
              <el-tag
                v-if="row.taskClass === TEMP_TASK_CLASS"
                size="small"
                type="primary"
                effect="plain"
                disable-transitions
              >
                本后台提交的临时任务
              </el-tag>
              <el-tag v-if="!row.returned" size="small" type="warning" effect="plain" disable-transitions>
                NAS 未返回
              </el-tag>
              <el-tag v-if="rowChanged(row)" size="small" type="danger" effect="plain" disable-transitions>
                已修改
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="主优先级（1~16）" width="215">
          <template #default="{ row }">
            <el-input-number
              v-model="row.tcPriority"
              class="priority__number"
              :min="TCPRIORITY_MIN"
              :max="TCPRIORITY_MAX"
              :step="1"
              step-strictly
              controls-position="right"
              :disabled="saving"
            />
            <div class="priority__sub">{{ describeExecutedPriority(row.tcPriority) }}</div>
          </template>
        </el-table-column>

        <el-table-column label="处理规则" width="215">
          <template #default="{ row }">
            <el-select
              v-model="row.tcRule"
              class="priority__select"
              placeholder="请选择"
              :disabled="saving"
            >
              <el-option
                v-for="option in TC_RULE_OPTIONS"
                :key="option.value"
                :value="option.value"
                :label="option.label"
              />
            </el-select>
            <div class="priority__sub">{{ tcRuleHint(row.tcRule) }}</div>
          </template>
        </el-table-column>

        <el-table-column label="状态" min-width="280">
          <template #default="{ row }">
            <template v-if="rowChanged(row)">
              <span v-if="!isCompletePriorityRule(row)" class="priority__pending">
                未填完：{{ pendingReason(row) }}
              </span>
              <span v-else class="priority__change">
                {{ describePriorityChange(row, baselineOf(row.taskClass)) }}
              </span>
            </template>
            <span v-else-if="!row.returned" class="priority__muted">
              NAS 里没有这一类的策略，需要自己填
            </span>
            <span v-else class="priority__muted">与 NAS 上的值一致</span>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              size="small"
              :disabled="!rowChanged(row) || saving"
              @click="handleResetRow(row)"
            >
              恢复
            </el-button>
          </template>
        </el-table-column>

        <template #empty>
          <div class="priority__empty">
            <el-skeleton v-if="loading" :rows="6" animated />
            <p v-else class="priority__empty-hint">
              还没有读取到数据：点右上角「刷新」从 NAS 读一次任务源优先策略。
            </p>
          </div>
        </template>
      </el-table>

      <div class="priority__footer">{{ footerText }}</div>
    </el-card>
  </div>
</template>

<style scoped>
.priority {
  display: flex;
  flex-direction: column;
}

.priority__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.priority__header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.priority__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.priority__count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.priority__header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.priority__loaded {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.priority__hint {
  margin-bottom: 12px;
}

.priority__hint-line {
  margin: 2px 0;
  font-size: 12px;
  line-height: 1.7;
}

.priority__warn {
  margin-bottom: 12px;
}

.priority__class {
  font-size: 13px;
}

.priority__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.priority__number {
  width: 140px;
}

.priority__select {
  width: 100%;
}

.priority__sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 变更摘要（相对 NAS 上的当前值） */
.priority__change {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

/* 改过但没填齐：拦住保存的那一行 */
.priority__pending {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-danger);
}

.priority__muted {
  color: var(--el-text-color-placeholder);
}

.priority__empty {
  padding: 8px 0;
}

.priority__empty-hint {
  max-width: 460px;
  margin: 0 auto;
  font-size: 13px;
  line-height: 1.8;
  color: var(--el-text-color-secondary);
}

.priority__footer {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
</style>
