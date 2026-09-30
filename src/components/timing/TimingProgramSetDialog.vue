<script setup>
// src/components/timing/TimingProgramSetDialog.vue —— 定时程序操作：清除 / 复制 / 剪切
//
// 接口：POST /api/timing/program/set（字段表见 backend/docs/API.md「定时程序操作（清除 / 复制 / 剪切）」）
//
// ⚠️ 这三个操作**直接改程序里的定时任务**，而且：
//   · CLEAR —— 删除该程序内的**全部**任务（1~248 条），不可撤销；
//   · COPY  —— 把源程序的任务整体**复制**到目标程序，**目标程序原有的任务被覆盖**；
//   · CUT   —— 同上，但源程序的任务会被**清空**（相当于搬过去）。
//   所以本项目对三者**一律二次确认**（`programSetWarning` 的文案在手点之前会原样展示），
//   而不是只确认「危险」的那两个 —— 复制同样会毁掉目标程序里已有的排期。
// ⚠️ 它们**只动任务**：程序名 / 程序组合 / 静默时段 / 自动切换都不受影响（那要用「配置程序」）。
// ⚠️ 目标程序不能与源程序相同（后端 @AssertTrue 会拒，Result=3），这里在下拉里直接禁用同一项。
//
// 分工：弹窗负责收集 + 校验 + 组装 payload，请求由页面调 store 发出。

import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
  TIMING_PROGRAM_ACTIONS,
  TIMING_PROGRAM_SET_NOTE,
  findTimingProgramAction,
  programSetProblem,
  programSetWarning
} from '@/constants/timing'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 16 个程序的下拉选项（由 constants/timing.js 的 programOptions 生成） */
  programs: { type: Array, default: () => [] },
  /** 打开时默认选中的源程序（一般是列表页当前正在看的程序） */
  defaultProgramIndex: { type: Number, default: 1 },
  /** 源程序已加载的任务条数（页面能从 store 里给就给，用于提示规模）；null = 不清楚 */
  sourceTaskCount: { type: Number, default: null },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 目标程序缺省取「第一个与源不同的程序」，免得一打开就撞上「源 = 目标」的校验 */
function firstOtherProgram(source) {
  const list = (props.programs || []).map((item) => Number(item.value))
  return list.find((value) => value !== Number(source)) || Number(source) + 1
}

function createForm() {
  const source = Number(props.defaultProgramIndex) || 1
  return {
    action: 'COPY',
    programIndex: source,
    programIndex1: firstOtherProgram(source)
  }
}

const form = ref(createForm())

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.value = createForm()
  }
)

// 换源程序时，如果目标被撞成了同一个，自动挪开（否则校验会红着，用户还得猜为什么）
watch(
  () => form.value.programIndex,
  (source) => {
    if (Number(form.value.programIndex1) === Number(source)) {
      form.value.programIndex1 = firstOtherProgram(source)
    }
  }
)

const currentAction = computed(() => findTimingProgramAction(form.value.action))
const needTarget = computed(() => Boolean(currentAction.value && currentAction.value.needTarget))

/** 程序号 → 标签（含程序名） */
function programText(value) {
  const hit = (props.programs || []).find((item) => Number(item.value) === Number(value))
  return hit ? hit.label : `程序 ${value}`
}

const sourceLabel = computed(() => programText(form.value.programIndex))
const targetLabel = computed(() => programText(form.value.programIndex1))

/** 源程序任务条数的补充说明（只在页面确实加载过这个程序时才有值） */
const sourceCountText = computed(() =>
  typeof props.sourceTaskCount === 'number' ? `当前已加载到 ${props.sourceTaskCount} 条任务` : '任务条数未加载'
)

const errorText = computed(() => programSetProblem(form.value))
const canSubmit = computed(() => !errorText.value)

const warningText = computed(() => programSetWarning(form.value.action, sourceLabel.value, targetLabel.value))

/** 二次确认的按钮文案 */
const confirmButtonText = computed(() => {
  const meta = currentAction.value
  if (!meta) return '确定'
  return meta.value === 'CLEAR' ? '确认清除' : meta.value === 'COPY' ? '确认复制' : '确认剪切'
})

async function handleConfirm() {
  if (!canSubmit.value) return
  try {
    await ElMessageBox.confirm(warningText.value, `二次确认：${currentAction.value.label}`, {
      type: 'warning',
      confirmButtonText: confirmButtonText.value,
      cancelButtonText: '再想想',
      // ⚠️ 不用 HTML 文案：程序名是用户可控文本，走纯文本通道更安全
      dangerouslyUseHTMLString: false
    })
  } catch {
    // 用户点了「再想想」：什么都不做（ElMessageBox 取消时是 reject）
    return
  }
  emit('confirm', {
    action: form.value.action,
    programIndex: Number(form.value.programIndex),
    // CLEAR 不需要目标程序；显式不带，避免后端把它当成「复制到同一个程序」
    ...(needTarget.value ? { programIndex1: Number(form.value.programIndex1) } : {})
  })
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="定时程序操作（清除 / 复制 / 剪切）"
    width="720px"
    :close-on-click-modal="false"
  >
    <el-alert type="warning" :closable="false" show-icon class="timing-set__alert">
      <template #title>这三个操作会直接改动程序里的定时任务</template>
      清除会删掉该程序的全部任务；复制 / 剪切<strong>会覆盖目标程序原有的全部任务</strong>，且无法找回。
      {{ TIMING_PROGRAM_SET_NOTE }}
    </el-alert>

    <el-radio-group v-model="form.action" class="timing-set__actions" :disabled="submitting">
      <el-radio-button v-for="item in TIMING_PROGRAM_ACTIONS" :key="item.value" :value="item.value">
        {{ item.label }}
      </el-radio-button>
    </el-radio-group>

    <div class="timing-set__segment">
      <div class="timing-set__row">
        <span class="timing-set__label">{{ needTarget ? '源程序' : '目标程序（要清除的那个）' }}</span>
        <el-select v-model="form.programIndex" class="timing-set__select" :disabled="submitting">
          <el-option v-for="item in programs" :key="item.value" :value="item.value" :label="item.label" />
        </el-select>
        <span class="timing-set__hint">{{ needTarget ? sourceCountText : '它的所有定时任务都会被删除' }}</span>
      </div>
      <div v-if="needTarget" class="timing-set__row">
        <span class="timing-set__label">目标程序</span>
        <el-select v-model="form.programIndex1" class="timing-set__select" :disabled="submitting">
          <el-option
            v-for="item in programs"
            :key="item.value"
            :value="item.value"
            :label="item.label"
            :disabled="Number(item.value) === Number(form.programIndex)"
          />
        </el-select>
        <span class="timing-set__hint">它的原有任务会被整体覆盖</span>
      </div>
    </div>

    <p class="timing-set__summary-hint">{{ currentAction ? currentAction.summary : '' }}</p>

    <p class="timing-set__preview">
      <template v-if="currentAction && currentAction.value === 'CLEAR'">
        将删除「{{ sourceLabel }}」内的全部定时任务{{
          typeof sourceTaskCount === 'number' ? `（当前已加载 ${sourceTaskCount} 条）` : ''
        }}。
      </template>
      <template v-else-if="currentAction && currentAction.value === 'COPY'">
        将把「{{ sourceLabel }}」的任务复制到「{{ targetLabel }}」（源程序保持原样，目标程序被覆盖）。
      </template>
      <template v-else-if="currentAction">
        将把「{{ sourceLabel }}」的任务搬到「{{ targetLabel }}」（源程序被清空，目标程序被覆盖）。
      </template>
    </p>

    <template #footer>
      <div class="timing-set__footer">
        <span v-if="errorText" class="timing-set__footer-error">⚠ {{ errorText }}</span>
        <span v-else class="timing-set__footer-hint">点确认后还会再弹一次「二次确认」，确认文案就是上面的内容。</span>
        <span class="timing-set__footer-actions">
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button
            :type="currentAction && currentAction.danger ? 'danger' : 'primary'"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="handleConfirm"
          >
            {{ confirmButtonText }}
          </el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.timing-set__alert {
  margin-bottom: 12px;
}

.timing-set__actions {
  margin-bottom: 12px;
}

.timing-set__segment {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}

.timing-set__row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.timing-set__row:last-child {
  margin-bottom: 0;
}

.timing-set__label {
  flex: 0 0 150px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing-set__select {
  width: 260px;
}

.timing-set__hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing-set__summary-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.timing-set__preview {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-danger);
}

.timing-set__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.timing-set__footer-error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
  text-align: left;
}

.timing-set__footer-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  text-align: left;
}

.timing-set__footer-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
