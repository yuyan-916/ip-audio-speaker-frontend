<script setup>
// src/components/timing/TimingProgramConfigDialog.vue —— 配置定时程序参数（程序名 / 组合 / 当前程序 / 静默 / 自动切换）
//
// 接口：POST /api/timing/program/config（字段表见 backend/docs/API.md「配置定时程序参数」）
//
// ⚠️ **段式覆盖语义（这个模块最容易踩的坑）**：
//   · 请求里**包含哪个段，就整体重置哪个段**；没包含的段保持 NAS 上的原值；
//   · `programName` 一旦出现必须给满 16 个、`programComb` 必须给满 4 个；
//   · `autoProgram` 一旦出现，**没填的条目一律按「禁用」处理**（等于重置全部 7 条），`[]` = 清除全部；
//   · `silenceTime` 给**空对象 `{}`** 表示清除，要设置则四个时间字段必须齐全；
//   · 后端额外要求至少包含一个段（空请求 400），所以「一段都不勾」会被这里拦下。
//   正因如此，本弹窗**必须**由页面先把 `GET /api/timing/program` 的结果（`info` prop）传进来，
//   再让用户在「读回来的现状」上改 —— 这就是手册要求的「先读 → 改 → 整体写回」。
// ⚠️ 不要为了「只改程序 3 的名字」而只发一个元素：`programName` 是整段数组，发 1 个会被 NAS 判 Result=2。
//
// 分工：弹窗负责收集 + 校验 + 组装 payload（**只放勾选的段**），请求由页面调 store 发出。

import { computed, ref, watch } from 'vue'
import {
  AUTO_PROGRAM_HINT,
  AUTO_PROGRAM_MAX,
  AUTO_PROG_IDX_MAX,
  AUTO_PROG_IDX_MIN,
  PROGRAM_COMB_COUNT,
  PROGRAM_COMB_HINT,
  SILENCE_TIME_HINT,
  TIMING_PROGRAM_COUNT,
  TIMING_PROGRAM_NAME_MAX_CHARS,
  autoProgramProblem,
  currentProgramOptions,
  describeCurrentProgram,
  describeProgramComb,
  isSilenceTimeSet,
  isValidCurrentProgram,
  isValidProgramComb,
  normalizeAutoPrograms,
  normalizeProgramCombs,
  normalizeSilenceTime,
  silenceTimeProblem
} from '@/constants/timing'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** `GET /api/timing/program` 的原始响应（页面必须在打开前先读到；null = 还没读到） */
  info: { type: Object, default: null },
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'confirm'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

/** 只有勾选的段会进 payload；值一律从**读回来的现状**预填，避免「凭记忆改」把别的段冲掉 */
function createDraft(info) {
  const source = info || {}
  const names = Array.isArray(source.ProgramName) ? source.ProgramName : []
  const autoRows = Array.isArray(source.AutoProgram) ? source.AutoProgram : []
  return {
    useName: false,
    useComb: false,
    useCurrent: false,
    useSilence: false,
    useAuto: false,
    /** 固定 16 个程序名（缺的补空串） */
    programNames: Array.from({ length: TIMING_PROGRAM_COUNT }, (_, index) =>
      String(names[index] == null ? '' : names[index])
    ),
    /** 固定 4 条组合编码（16 位 0/1） */
    combs: normalizeProgramCombs(source.ProgramComb),
    currentProgram: isValidCurrentProgram(source.CurrentProgram) ? Number(source.CurrentProgram) : 1,
    /**
     * 静默时段：'set' 写入四个字段 / 'clear' 清除（发空对象 `{}`）。
     * ⚠️ 缺省要与现状一致，否则「勾了这一段但没动单选」会把 NAS 上的静默时段**清掉**：
     *    NAS 本来有静默时段 → 缺省 'set'（表单已预填原值，直接写入等于不变）；
     *    NAS 本来没有 → 缺省 'clear'（写入等于不变）。
     */
    silenceMode: isSilenceTimeSet(source.SilenceTime) ? 'set' : 'clear',
    silence: normalizeSilenceTime(source.SilenceTime),
    /** 自动切换的 7 条（NAS 只回有效条目，缺的序号由用户自己加） */
    autoRows: normalizeAutoPrograms(autoRows)
  }
}

const draft = ref(createDraft(props.info))

// 每次打开都从「读回来的现状」重新铺一遍（弹窗不缓存上次的编辑）
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    draft.value = createDraft(props.info)
  }
)

const programNames = computed(() => draft.value.programNames)
/** 「当前执行程序」与自动切换的目标程序都用同一套 1~24 选项 */
const targetOptions = computed(() => currentProgramOptions(programNames.value))

// ---------------- 各段的小工具 ----------------

/** 勾选了几段（至少要 1 段，后端不允许空请求） */
const pickedSegments = computed(
  () =>
    [
      draft.value.useName,
      draft.value.useComb,
      draft.value.useCurrent,
      draft.value.useSilence,
      draft.value.useAuto
    ].filter(Boolean).length
)

/** 组合编码里第 bitIndex 位（0 = 程序 1）取反：一个 16 位串配 16 个勾选框 */
function toggleComb(combIndex, bitIndex) {
  const chars = String(draft.value.combs[combIndex] || '').padEnd(TIMING_PROGRAM_COUNT, '0').split('')
  chars[bitIndex] = chars[bitIndex] === '1' ? '0' : '1'
  draft.value.combs[combIndex] = chars.join('')
}

/** 组合编码的可读说明（含每个程序的名称） */
function combText(comb) {
  return describeProgramComb(comb, programNames.value)
}

/** 自动切换：追加一条（序号取还没用过的第一个 1~7） */
function addAutoRow() {
  if (draft.value.autoRows.length >= AUTO_PROGRAM_MAX) return
  const used = new Set(draft.value.autoRows.map((row) => Number(row.autoProgIdx)))
  const next = Array.from({ length: AUTO_PROG_IDX_MAX }, (_, index) => index + AUTO_PROG_IDX_MIN).find(
    (value) => !used.has(value)
  )
  draft.value.autoRows.push({
    autoProgIdx: next == null ? AUTO_PROG_IDX_MIN : next,
    programIndex: 1,
    startDate: '',
    startTime: '08:00:00',
    endDate: '',
    endTime: '20:00:00'
  })
}

function removeAutoRow(index) {
  draft.value.autoRows.splice(index, 1)
}

/** 清空全部自动切换设置（`autoProgram: []`），要配合「写入自动切换」的勾选 */
function clearAutoRows() {
  draft.value.autoRows = []
}

/** 静默时段的可读说明（填了哪几个字段） */
const silenceFilled = computed(() =>
  ['startDate', 'startTime', 'endDate', 'endTime'].filter((key) => draft.value.silence[key]).length
)

// ---------------- 校验与提交 ----------------

const errorText = computed(() => {
  if (!pickedSegments.value) return '至少要勾选一段要写入的内容（后端不允许发空请求）'

  if (draft.value.useName) {
    const bad = draft.value.programNames.findIndex(
      (name) => String(name == null ? '' : name).length > TIMING_PROGRAM_NAME_MAX_CHARS
    )
    if (bad >= 0) return `程序 ${bad + 1} 的名称超过 ${TIMING_PROGRAM_NAME_MAX_CHARS} 个字符（程序名按字符算，不是字节）`
  }

  if (draft.value.useComb) {
    const bad = draft.value.combs.findIndex((comb) => !isValidProgramComb(comb))
    if (bad >= 0) return `程序组合 ${bad + 1} 必须是 16 位 0/1 字符串（只含 0 与 1、长度正好 16）`
  }

  if (draft.value.useCurrent && !isValidCurrentProgram(draft.value.currentProgram)) {
    return '当前执行程序必须是 1~24 的整数'
  }

  if (draft.value.useSilence && draft.value.silenceMode === 'set') {
    const problem = silenceTimeProblem(draft.value.silence)
    if (problem) return problem
  }

  if (draft.value.useAuto) {
    const problem = autoProgramProblem(draft.value.autoRows)
    if (problem) return problem
  }

  return ''
})

const canSubmit = computed(() => !errorText.value)

/** 本次写入会「整体重置」的段名清单（二次确认与警告条共用） */
const rewrittenSegments = computed(() => {
  const list = []
  if (draft.value.useName) list.push(`程序名（16 条全部重写：没填的会变成空名）`)
  if (draft.value.useComb) list.push('程序组合（4 条编码全部重写）')
  if (draft.value.useCurrent) list.push('当前执行程序')
  if (draft.value.useSilence) {
    list.push(draft.value.silenceMode === 'clear' ? '静默时段（清除）' : '静默时段（整段重写）')
  }
  if (draft.value.useAuto) {
    list.push(
      draft.value.autoRows.length
        ? `自动切换（整段重写：只保留这 ${draft.value.autoRows.length} 条）`
        : '自动切换（清除全部设置）'
    )
  }
  return list
})

/** 组装 payload：**只放勾选的段**（这是段式覆盖语义的关键） */
function buildPayload() {
  const payload = {}
  if (draft.value.useName) {
    payload.programName = draft.value.programNames.map((name) => String(name == null ? '' : name).trim())
  }
  if (draft.value.useComb) {
    payload.programComb = draft.value.combs.map((comb) => String(comb == null ? '' : comb).trim())
  }
  if (draft.value.useCurrent) payload.currentProgram = Number(draft.value.currentProgram)
  if (draft.value.useSilence) {
    // 空对象 = 清除静默时段（不是「保持原值」，那是「不勾这一段」）
    payload.silenceTime = draft.value.silenceMode === 'clear' ? {} : normalizeSilenceTime(draft.value.silence)
  }
  if (draft.value.useAuto) payload.autoProgram = normalizeAutoPrograms(draft.value.autoRows)
  return payload
}

function handleConfirm() {
  if (!canSubmit.value) return
  emit('confirm', buildPayload())
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="配置定时程序参数"
    width="920px"
    top="5vh"
    :close-on-click-modal="false"
  >
    <el-alert type="warning" :closable="false" show-icon class="timing-config__alert">
      <template #title>段式覆盖：勾选哪一段，就整体重置哪一段</template>
      请求里<strong>包含哪个段就整体重置哪个段</strong>（程序名必须给满 16 个、组合必须给满 4 个、
      自动切换没填的条目一律按「禁用」处理）；未勾选的段保持 NAS 上的原值。
      所以这里一律<strong>先读回现状、在现状上改、再整体写回</strong> —— 不要凭记忆填。
    </el-alert>
    <p v-if="!info" class="timing-config__warn">
      还没有读到 NAS 上的定时程序信息，请先关闭弹窗并点一次「刷新」（读不到就不该凭记忆改）。
    </p>

    <!-- 1. 程序名 -->
    <div class="timing-config__segment">
      <el-checkbox v-model="draft.useName" :disabled="submitting">
        写入程序名（16 个名称，整段重写：没填的会变成空名）
      </el-checkbox>
      <p class="timing-config__hint">
        程序名只用于显示、<strong>不作为标识</strong>（空名也正常）；每个名称最多
        {{ TIMING_PROGRAM_NAME_MAX_CHARS }} 个<strong>字符</strong>（不是 GBK 字节，别和任务名混口径）。
      </p>
      <div class="timing-config__grid">
        <div v-for="(name, index) in draft.programNames" :key="index" class="timing-config__grid-item">
          <span class="timing-config__grid-label">程序 {{ index + 1 }}</span>
          <el-input
            v-model="draft.programNames[index]"
            size="small"
            :disabled="submitting || !draft.useName"
            :maxlength="TIMING_PROGRAM_NAME_MAX_CHARS"
            placeholder="可留空"
          />
        </div>
      </div>
    </div>

    <!-- 2. 程序组合编码 -->
    <div class="timing-config__segment">
      <el-checkbox v-model="draft.useComb" :disabled="submitting">
        写入程序组合编码（4 条，整段重写）
      </el-checkbox>
      <p class="timing-config__hint">{{ PROGRAM_COMB_HINT }}</p>
      <div v-for="(comb, combIndex) in draft.combs" :key="combIndex" class="timing-config__comb">
        <div class="timing-config__comb-head">
          <span class="timing-config__grid-label">组合 {{ combIndex + 1 }}</span>
          <el-input
            v-model="draft.combs[combIndex]"
            size="small"
            class="timing-config__comb-input"
            :disabled="submitting || !draft.useComb"
            maxlength="16"
            placeholder="16 位 0/1"
          />
          <span class="timing-config__comb-text">{{ combText(comb) }}</span>
        </div>
        <!-- ⚠️ 不能包在 el-checkbox-group 里：group 会用**自己的** model-value 覆盖每个 checkbox 的状态，
             这里每个勾选框各自绑定在 16 位串的一位上（@change 手动翻转），所以用普通容器即可 -->
        <div class="timing-config__comb-boxes">
          <el-checkbox
            v-for="programIndex in TIMING_PROGRAM_COUNT"
            :key="programIndex"
            :model-value="String(comb)[programIndex - 1] === '1'"
            :disabled="submitting || !draft.useComb"
            @change="toggleComb(combIndex, programIndex - 1)"
          >
            {{ programIndex }}
          </el-checkbox>
        </div>
      </div>
    </div>

    <!-- 3. 当前执行程序（1~24，不只是程序序号） -->
    <div class="timing-config__segment">
      <el-checkbox v-model="draft.useCurrent" :disabled="submitting">
        写入「当前执行程序」
      </el-checkbox>
      <p class="timing-config__hint">
        取值 1~24：1~16 = 对应程序；17 = 程序 1~8 固定组合、18 = 程序 9~16 固定组合、19 = 全体组合、
        20 = 无程序（不执行任何定时任务）、21~24 = 自定义组合 1~4（用上面的组合编码）。
        自动切换的时段外，系统执行的就是它。
      </p>
      <div class="timing-config__inline">
        <el-select v-model="draft.currentProgram" class="timing-config__select" :disabled="submitting || !draft.useCurrent">
          <el-option v-for="item in targetOptions" :key="item.value" :value="item.value" :label="item.label" />
        </el-select>
        <el-tag type="success" effect="plain">{{ describeCurrentProgram(draft.currentProgram, programNames).text }}</el-tag>
      </div>
    </div>

    <!-- 4. 静默时段 -->
    <div class="timing-config__segment">
      <el-checkbox v-model="draft.useSilence" :disabled="submitting">
        写入静默时段（整段重写）
      </el-checkbox>
      <p class="timing-config__hint">{{ SILENCE_TIME_HINT }}</p>
      <el-radio-group v-model="draft.silenceMode" :disabled="submitting || !draft.useSilence">
        <el-radio value="set">设置静默时段（四个时间字段都要填）</el-radio>
        <el-radio value="clear">清除静默时段（发空对象 <code>{}</code>）</el-radio>
      </el-radio-group>
      <div v-if="draft.silenceMode === 'set'" class="timing-config__inline timing-config__inline--wrap">
        <el-input v-model="draft.silence.startDate" size="small" class="timing-config__datetime" placeholder="24-10-12" :disabled="submitting || !draft.useSilence" />
        <el-input v-model="draft.silence.startTime" size="small" class="timing-config__datetime" placeholder="13:00:00" :disabled="submitting || !draft.useSilence" />
        <span class="timing-config__arrow">→</span>
        <el-input v-model="draft.silence.endDate" size="small" class="timing-config__datetime" placeholder="24-10-15" :disabled="submitting || !draft.useSilence" />
        <el-input v-model="draft.silence.endTime" size="small" class="timing-config__datetime" placeholder="10:00:00" :disabled="submitting || !draft.useSilence" />
      </div>
      <p v-if="draft.useSilence" class="timing-config__hint">
        当前填了 {{ silenceFilled }} / 4 个字段；日期形如 <code>24-10-12</code>、时刻形如 <code>13:00:00</code>。
      </p>
    </div>

    <!-- 5. 自动切换设置 -->
    <div class="timing-config__segment">
      <el-checkbox v-model="draft.useAuto" :disabled="submitting">
        写入自动切换设置（整段重写：没填的条目等于禁用，空列表 = 清除全部）
      </el-checkbox>
      <p class="timing-config__hint">{{ AUTO_PROGRAM_HINT }}</p>
      <div class="timing-config__auto-head">
        <span class="timing-config__hint">
          当前 {{ draft.autoRows.length }} / {{ AUTO_PROGRAM_MAX }} 条（序号 {{ AUTO_PROG_IDX_MIN }}~{{ AUTO_PROG_IDX_MAX }}，不能重复）
        </span>
        <span>
          <el-button size="small" :disabled="submitting || !draft.useAuto || draft.autoRows.length >= AUTO_PROGRAM_MAX" @click="addAutoRow">
            添加一条
          </el-button>
          <el-button size="small" :disabled="submitting || !draft.useAuto || !draft.autoRows.length" @click="clearAutoRows">
            清空全部
          </el-button>
        </span>
      </div>
      <div v-for="(row, index) in draft.autoRows" :key="index" class="timing-config__auto-row">
        <span class="timing-config__grid-label">第 {{ index + 1 }} 条</span>
        <el-input-number
          v-model="row.autoProgIdx"
          size="small"
          :min="AUTO_PROG_IDX_MIN"
          :max="AUTO_PROG_IDX_MAX"
          :disabled="submitting || !draft.useAuto"
        />
        <el-select v-model="row.programIndex" size="small" class="timing-config__auto-select" :disabled="submitting || !draft.useAuto">
          <el-option v-for="item in targetOptions" :key="item.value" :value="item.value" :label="item.label" />
        </el-select>
        <el-input v-model="row.startDate" size="small" class="timing-config__datetime" placeholder="24-11-01" :disabled="submitting || !draft.useAuto" />
        <el-input v-model="row.startTime" size="small" class="timing-config__datetime" placeholder="08:00:00" :disabled="submitting || !draft.useAuto" />
        <span class="timing-config__arrow">→</span>
        <el-input v-model="row.endDate" size="small" class="timing-config__datetime" placeholder="24-11-02" :disabled="submitting || !draft.useAuto" />
        <el-input v-model="row.endTime" size="small" class="timing-config__datetime" placeholder="20:00:00" :disabled="submitting || !draft.useAuto" />
        <el-button size="small" text type="danger" :disabled="submitting || !draft.useAuto" @click="removeAutoRow(index)">
          删除
        </el-button>
      </div>
      <p v-if="draft.useAuto && !draft.autoRows.length" class="timing-config__hint">
        列表为空 → 本次会把 NAS 上的自动切换设置**全部清除**（`autoProgram: []`）。
      </p>
    </div>

    <template #footer>
      <div class="timing-config__footer">
        <div class="timing-config__footer-info">
          <span v-if="errorText" class="timing-config__footer-error">⚠ {{ errorText }}</span>
          <template v-else>
            <span class="timing-config__footer-hint">本次会整体重置：</span>
            <ul class="timing-config__summary">
              <li v-for="item in rewrittenSegments" :key="item">{{ item }}</li>
            </ul>
          </template>
        </div>
        <span class="timing-config__footer-actions">
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="handleConfirm">
            写入
          </el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.timing-config__alert {
  margin-bottom: 12px;
}

.timing-config__segment {
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--app-radius);
}

.timing-config__hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

.timing-config__warn {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-warning);
}

.timing-config__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  margin-top: 8px;
}

.timing-config__grid-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timing-config__grid-label {
  flex: 0 0 64px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.timing-config__comb {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
}

.timing-config__comb-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timing-config__comb-input {
  width: 220px;
}

.timing-config__comb-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timing-config__comb-boxes {
  display: flex;
  flex-wrap: wrap;
  gap: 0 10px;
  margin-top: 4px;
}

.timing-config__inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.timing-config__inline--wrap {
  flex-wrap: wrap;
}

.timing-config__select {
  width: 320px;
}

.timing-config__datetime {
  width: 130px;
}

.timing-config__arrow {
  color: var(--el-text-color-placeholder);
}

.timing-config__auto-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.timing-config__auto-head .timing-config__hint {
  margin: 0;
}

.timing-config__auto-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.timing-config__auto-select {
  width: 220px;
}

.timing-config__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.timing-config__footer-info {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
}

.timing-config__footer-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.timing-config__footer-error {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-danger);
}

.timing-config__summary {
  margin: 2px 0 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.timing-config__footer-actions {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
