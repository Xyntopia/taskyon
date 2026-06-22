<template>
  <q-page class="column">
    <!-- ================= Metrics Header (col-auto) ================= -->
    <div class="col-auto">
      <div class="metrics-bar">
        <div class="row items-center justify-between full-width text-caption text-grey-7">
          <div class="row items-center q-gutter-sm">
            <div class="metric-chip">
              <span class="metric-label">Duels</span>
              <span class="metric-value">{{ duelsFought }}</span>
            </div>

            <div class="metric-chip">
              <span class="metric-label">Win ratio</span>
              <span class="metric-value">
                {{ topWinRatioPct }}
                <q-tooltip
                  v-if="topCandidateStats.total > 0"
                  anchor="bottom middle"
                  self="top middle"
                >
                  Top: {{ topCandidateName || '—' }}<br />
                  Wins: {{ topCandidateStats.wins }} / {{ topCandidateStats.total }}
                </q-tooltip>
              </span>
            </div>

            <div class="metric-chip">
              <span class="metric-label">Coverage</span>
              <span class="metric-value">
                {{ coveragePct }}
                <q-tooltip v-if="totalCandidates > 0" anchor="bottom middle" self="top middle">
                  Seen: {{ coveredCount }} / {{ totalCandidates }}
                </q-tooltip>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ================= Top Ranking (col-5) ================= -->
    <div class="col-4">
      <div>
        <q-list dense bordered>
          <q-item v-for="(id, idx) in state.ranking.slice(0, 10)" :key="id">
            <q-item-section side>{{ idx + 1 }}.</q-item-section>
            <q-item-section>{{ state.candidates[id]?.name || '—' }}</q-item-section>
          </q-item>
          <div v-if="state.ranking.length === 0" class="text-caption text-grey-6 q-pa-sm">
            No names ranked yet
          </div>
        </q-list>
      </div>
    </div>

    <!-- ================= Duel Hero (col) ================= -->
    <div class="col">
      <div
        v-touch-swipe.left.mouse="() => choose('left')"
        v-touch-swipe.right.mouse="() => choose('right')"
        class="column flex-center duel-card"
      >
        <div
          v-if="currentDuel.length !== 2"
          class="column flex-center text-center q-gutter-md ranking-empty-state"
        >
          <template v-if="!state.params.namingGoal">
            <h1 class="text-h5 q-my-none">Start with a naming goal</h1>
            <p class="text-body2 text-grey-7 q-my-none">
              Describe what the name should communicate, who it is for, and any constraints.
            </p>
            <q-btn unelevated color="primary" label="Set naming goal" @click="openGoalDialog" />
          </template>

          <template v-else>
            <div class="text-overline text-grey-7">Naming goal</div>
            <div class="text-subtitle1">{{ state.params.namingGoal }}</div>
            <p class="text-body2 text-grey-7 q-my-none">
              Generate name ideas to begin comparing them.
            </p>
            <div class="row justify-center q-gutter-sm">
              <q-btn
                unelevated
                color="primary"
                label="Generate name ideas"
                @click="generateNames(state.params.initialGenerateCount)"
              />
              <q-btn flat color="primary" label="Change goal" @click="openGoalDialog" />
            </div>
          </template>
        </div>

        <div v-else class="duel-area row items-center justify-around full-width">
          <div class="col-5 text-center">
            <div class="text-h5 q-mb-sm">{{ currentDuel[0]?.name }}</div>
            <q-btn
              class="desktop-only"
              flat
              color="primary"
              label="← Prefer"
              @click="choose('left')"
            />
          </div>

          <div class="col-2 text-center text-grey-7">vs</div>

          <div class="col-5 text-center">
            <div class="text-h5 q-mb-sm">{{ currentDuel[1]?.name }}</div>
            <q-btn
              class="desktop-only"
              flat
              color="primary"
              label="Prefer →"
              @click="choose('right')"
            />
          </div>
        </div>

        <!-- Draw/skip -->
        <div v-if="currentDuel.length === 2" class="q-mt-sm row justify-center">
          <q-btn outline color="grey" label="Skip / Draw" @click="choose('none')" />
        </div>
      </div>
    </div>

    <!-- ================= Bottom Button Bar (col-auto) ================= -->
    <div class="col-auto">
      <div class="row justify-around items-center bottom-bar">
        <q-btn round flat :icon="matLeaderboard" @click="openFullRanking = true">
          <q-tooltip anchor="top middle" self="bottom middle">Full Ranking</q-tooltip>
        </q-btn>

        <q-btn round flat :icon="matHistory" @click="openDuelHistory = true">
          <q-tooltip anchor="top middle" self="bottom middle">Duel History</q-tooltip>
        </q-btn>

        <q-btn round flat :icon="matSmartToy" aria-label="Agent" @click="openAgent = true">
          <q-tooltip anchor="top middle" self="bottom middle">Agent</q-tooltip>
        </q-btn>

        <q-btn round flat :icon="matSettings" @click="openSettings = true">
          <q-tooltip anchor="top middle" self="bottom middle">Settings</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- ================= Bottom Sheets ================= -->

    <!-- Full Ranking Sheet -->
    <q-dialog
      v-model="openFullRanking"
      transition-show="slide-up"
      transition-hide="slide-down"
      position="bottom"
    >
      <q-card v-touch-swipe.mouse.down="() => (openFullRanking = false)" class="sheet-card">
        <q-bar class="q-pa-sm">
          <div class="text-subtitle1">Full Ranking</div>
          <q-space />
          <q-btn dense flat round :icon="matClose" @click="openFullRanking = false" />
        </q-bar>
        <q-separator />
        <div class="q-pa-md" style="max-height: 70vh; overflow-y: auto">
          <q-list bordered separator>
            <q-item v-for="(id, idx) in state.ranking" :key="id">
              <q-item-section side>{{ idx + 1 }}.</q-item-section>
              <q-item-section>{{ state.candidates[id]?.name || '—' }}</q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-card>
    </q-dialog>

    <!-- Duel History Sheet -->
    <q-dialog
      v-model="openDuelHistory"
      transition-show="slide-up"
      transition-hide="slide-down"
      position="bottom"
    >
      <q-card v-touch-swipe.mouse.down="() => (openDuelHistory = false)" class="sheet-card">
        <q-bar>
          <div class="text-subtitle1">Duel History</div>
          <q-space />
          <q-btn dense flat round :icon="matClose" @click="openDuelHistory = false" />
        </q-bar>
        <q-separator />
        <div class="q-pa-md" style="max-height: 70vh; overflow-y: auto">
          <q-markup-table flat dense separator="none">
            <tbody>
              <tr
                v-for="d in state.duels.slice(0, 200)"
                :key="d.leftId + ':' + d.rightId + ':' + d.winner"
              >
                <td>{{ state.candidates[d.leftId]?.name || '—' }}</td>
                <td class="text-center">
                  {{
                    {
                      '-1': '==',
                      1: '->',
                      0: '<-',
                    }[d.winner]
                  }}
                </td>
                <td>{{ state.candidates[d.rightId]?.name || '—' }}</td>
              </tr>
            </tbody>
          </q-markup-table>
        </div>
      </q-card>
    </q-dialog>

    <!-- Settings Sheet (Controls + Parameters) -->
    <q-dialog
      v-model="openSettings"
      transition-show="slide-up"
      transition-hide="slide-down"
      position="bottom"
    >
      <q-card v-touch-swipe.mouse.down="() => (openSettings = false)" class="sheet-card">
        <q-bar>
          <div class="text-subtitle1">Settings</div>
          <q-space />
          <q-btn dense flat round :icon="matClose" @click="openSettings = false" />
        </q-bar>
        <q-separator />

        <div class="q-pa-md" style="max-height: 70vh; overflow-y: auto">
          <div class="row q-gutter-sm q-mb-md">
            <q-btn unelevated dense color="secondary" @click="importCsv">Import CSV</q-btn>
            <q-btn
              unelevated
              dense
              color="secondary"
              :disable="!state.params.namingGoal"
              @click="generateNames(state.params.generationBatchSize)"
            >
              Generate Names
            </q-btn>
            <q-btn unelevated dense color="secondary" label="Modify Goal" @click="openGoalDialog" />
            <q-btn unelevated dense color="secondary" label="Reset" @click="resetProject" />
            <q-btn unelevated dense color="secondary" label="Start" @click="start" />
            <q-btn unelevated dense color="secondary" label="Train" @click="train" />
            <q-btn unelevated dense color="secondary" label="Save" @click="saveProject" />
          </div>

          <q-expansion-item label="Parameters" dense>
            <ObjectView v-model="state.params" />
          </q-expansion-item>
        </div>
      </q-card>
    </q-dialog>

    <!-- Goal Dialog -->
    <q-dialog v-model="goalDialog">
      <q-card style="min-width: 300px">
        <q-card-section>
          <h2 class="text-h6 q-my-none">Set the naming goal</h2>
          <p class="text-body2 text-grey-7 q-mb-none">
            Describe what the strongest name should communicate, who it is for, and any constraints.
          </p>
        </q-card-section>
        <q-card-section>
          <q-input
            v-model="goalModifierInput"
            label="Naming goal"
            type="textarea"
            autogrow
            outlined
          />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Cancel" />
          <q-btn
            unelevated
            color="secondary"
            label="Save goal"
            :disable="!goalModifierInput.trim()"
            @click="setGoalFromDialog"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Agent Sheet (always mounted, just shown/hidden) -->
    <q-slide-transition>
      <div
        v-show="openAgent"
        class="sheet-card agent-sheet"
        role="region"
        aria-label="Ranking agent"
      >
        <q-bar class="q-pa-sm">
          <div class="text-subtitle1">Agent</div>
          <q-space />
          <q-btn dense flat round :icon="matClose" @click="openAgent = false" />
        </q-bar>
        <q-separator />

        <TaskyonClientPane
          :client="agentRuntime?.client"
          :status="agentStatus"
          :error-message="agentError"
          :entry-node="agentRuntime?.entryNode"
          :chat-completion-stream="agentRuntime?.chatCompletionStream"
          :worker-stream="agentRuntime?.workerStream"
          v-model:selected-task-id="selectedAgentTaskId"
          v-model:recent-task-ids="recentAgentTaskIds"
          welcome-message="Ask Taskyon to help with your naming goal."
          min-mode
        />
      </div>
    </q-slide-transition>
  </q-page>
</template>

<script setup lang="ts">
import {
  matClose,
  matHistory,
  matLeaderboard,
  matSettings,
  matSmartToy,
} from '@quasar/extras/material-icons'
import { createTaskyonIntegrationRuntime, type TaskyonIntegrationRuntime } from '@taskyon/sdk'
import { createChatCompletionTask, createClientTool, createSubtasksResult } from '@taskyon/tyclient'
import { until } from '@vueuse/core'
import { resolveToolchainProvider } from '@taskyon/taskyon/api'
import { executePythonScript } from '@taskyon/taskyon/tools/executePython'
import TaskyonClientPane from '@taskyon/ui/components/TaskyonClientPane.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
import { syncStateWithStorageClient } from '@taskyon/ui/modules/storageState'
import type { JSONSchema7 } from 'json-schema'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, toRaw } from 'vue'
import { z } from 'zod'
import type { Candidate, RankingState } from './ranking'
import {
  addCandidates,
  createInitialState,
  getNextDuel,
  getRanking,
  parseRankingPythonResult,
  parseRankingState,
  recordDuel,
  trainPythonModel,
} from './ranking'

const RANKING_STATE_LOCATION = { namespace: 'ranking/state', id: 'ranking-app' } as const
const taskyonStore = useTaskyonStore()
const appState = useAppStateStore()

/* ---------------- Persistence ---------------- */
async function saveProject() {
  await taskyonStore.storageClient.set({
    ...RANKING_STATE_LOCATION,
    value: parseRankingState(toRaw(state)),
  })
}

async function loadProject() {
  const stored = await taskyonStore.storageClient.get(RANKING_STATE_LOCATION)
  if (stored.value === null) return
  Object.assign(state, parseRankingState(stored.value))
}

/* ---------------- State ---------------- */
// state wrapped in Vue reactivity
const state = reactive<RankingState>(createInitialState({}))

//syncRefsWithLocalStorage('rankingAppParams', toRefs(state))

const currentDuel = ref<Candidate[]>([])
const agentRuntime = shallowRef<TaskyonIntegrationRuntime>()
const agentStatus = ref<'starting' | 'ready' | 'error'>('starting')
const agentError = ref('Taskyon could not be started.')
const selectedAgentTaskId = ref<string>()
const recentAgentTaskIds = ref<string[]>([])
const model = 'openai/gpt-5-nano'

/* ---------------- Bottom sheets ---------------- */
const openSettings = ref(false)
const openFullRanking = ref(false)
const openDuelHistory = ref(false)
const openAgent = ref(false)

/* ---------------- Goal dialog ---------------- */
const goalDialog = ref(false)
const goalModifierInput = ref('')

/* ---------------- Tools ---------------- */
const addNamesTool = createClientTool({
  name: 'addNames',
  description: 'Add generated names to the current ranking project.',
  parameters: {
    type: 'object',
    properties: { names: { type: 'array', items: { type: 'string' } } },
    required: ['names'],
  } as const satisfies JSONSchema7,
  function: async ({ names }: { names: string[] }) => {
    Object.assign(state, await addCandidates(state, names))
    await saveProject()
    return createSubtasksResult({
      role: 'assistant',
      content: { type: 'return', data: `Added ${names.length} names.` },
    })
  },
})

const setGoalTool = createClientTool({
  name: 'setGoal',
  description: 'Set the naming goal for the current ranking project.',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'the task should be a simple, precise and concise statement',
      },
    },
    required: ['task'],
  } as const satisfies JSONSchema7,
  function: async ({ task }) => {
    state.params.namingGoal = task
    await saveProject()
    return createSubtasksResult({
      role: 'assistant',
      content: { type: 'return', data: `Goal set: ${task}` },
    })
  },
})

/* ---------------- Init ---------------- */
let disposed = false
let agentUiSync: Awaited<ReturnType<typeof syncStateWithStorageClient>> | undefined
onMounted(async () => {
  window.addEventListener('keydown', onRankingKeydown)
  try {
    await loadProject()
    if (disposed) return
    agentUiSync = await syncStateWithStorageClient(
      taskyonStore.storageClient,
      { namespace: 'ranking/state', id: 'ranking-agent-ui' },
      { selectedAgentTaskId, recentAgentTaskIds },
    )
    if (disposed) {
      agentUiSync.stop()
      return
    }

    await until(() => appState.taskyonSessionStatus === 'ready').toBe(true)
    if (disposed) return

    const sessionId = await (await taskyonStore.taskyon).getCryptoSession().getSessionId()
    if (disposed) return
    const agentSessionId = `ranking-${sessionId}`
    const apiKey = taskyonStore.getTaskyonKeyString()
    const promptTemplates = z
      .object({
        basePrompt: z.string(),
        message: z.string(),
        toolResult: z.string(),
        error: z.string(),
        retryExhausted: z.string(),
      })
      .parse(
        appState.effectiveToolchainConfig[appState.llmSettings.entryFunction]?.prompt_templates,
      )
    const { defaultHeaders, ...provider } = resolveToolchainProvider(
      appState.toolchainProfiles,
      'taskyon',
    )
    const runtime = await createTaskyonIntegrationRuntime({
      entry: {
        name: 'rankingAgent',
        allowedTools: ['addNames', 'setGoal'],
        context: 'You are helping the user name a project in the ranking app.',
        promptTemplates,
      },
      tools: [addNamesTool, setGoalTool, executePythonScript],
      provider: { ...provider, ...(defaultHeaders ? { defaultHeaders } : {}) },
      ...(apiKey ? { apiKey } : {}),
      storageSessionId: agentSessionId,
      cryptoNamespace: agentSessionId,
    })
    if (disposed) {
      await runtime.stop('Ranking page closed during initialization')
      return
    }
    agentRuntime.value = runtime
    agentStatus.value = 'ready'
    start()
  } catch (error) {
    agentError.value = error instanceof Error ? error.message : 'Taskyon could not be started.'
    agentStatus.value = 'error'
  }
})

onUnmounted(() => {
  disposed = true
  window.removeEventListener('keydown', onRankingKeydown)
  agentUiSync?.stop()
  void agentUiSync?.flush()
  void agentRuntime.value?.stop('Ranking page closed')
})

// methods
function openGoalDialog() {
  goalModifierInput.value = state.params.namingGoal
  goalDialog.value = true
}

const allCategories = [
  'compounds',
  'acronyms',
  'sound based',
  'language inspired',
  'free creative',
  'metaphorical',
  'nature inspired',
  'tech futuristic',
  'minimalist',
  'wordplay',
  'persona',
  'mythological',
  'symbolic',
  'portmanteau',
  'emotional',
]

function pickRandomCategories(n = 2) {
  const shuffled = [...allCategories].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

/* ---------------- Goal set from dialog ---------------- */
async function setGoalFromDialog() {
  const goal = goalModifierInput.value.trim()
  if (!goal) return
  state.params.namingGoal = goal
  goalDialog.value = false
  await saveProject()
}

/* ---------------- Name generation ---------------- */
const creativityGuideline = `
Create diverse, innovative, and imaginative names inspired by:
- sounds, mythology, stories, and languages
- cultural inspirations and playful mixes
- entirely new fictional words
- remixing existing names (partial reuse, meaning shifts, etc.)

Keep in mind, that we use an ML algorithm to find out the users preferences.
It is not your task to find out preferences
but we will give you the top rated names.
`

async function generateNames(batch: number) {
  // we don't need the result from processTasks here, because
  // we are using the tool anyways!
  const top = state.ranking
    .slice(0, 50)
    .map((id) => state.candidates[id]?.name)
    .filter((n): n is string => n !== undefined)

  const categories = pickRandomCategories(2)

  const client = agentRuntime.value?.client
  if (!client) throw new Error('Ranking agent is not ready')
  await client.runTasks(
    [
      [
        {
          role: 'user',
          content: {
            type: 'message',
            data: `These are our current top names:

> ${JSON.stringify(top)} our of a total of ${Object.keys(state.candidates).length}

This is the current naming goal:
> "${state.params.namingGoal}"

Creativity guideline:
${creativityGuideline}

This round, **focus on these categories**:
- ${categories.join('\n- ')}

Generate ${batch} new names, make sure, that each name somehow refers to the naming goal!
Of those, ${Math.floor(batch * 0.5)} should be remixes of the top names!
`,
          },
        },
        createChatCompletionTask({
          model,
          allowedTools: ['addNames'],
        }),
      ],
    ],
    ['toolresult', 'message', 'return'],
    { timeoutMs: 100000 },
  )

  await saveProject()
}

/* ---------------- Ranking / Duel flow ---------------- */
async function updateRanking() {
  const res = await getRanking(state, runRankingPython)
  if (res.ok) state.ranking = res.data
}

function loadNextDuel() {
  const res = getNextDuel(state)
  if (res.ok) currentDuel.value = res.data
}

function start() {
  console.log('start ranking!')
  void updateRanking()
  loadNextDuel()
}

async function train() {
  const model = await trainPythonModel(state, runRankingPython)
  if (model.ok) state.model.modelBlob = model.data
}

async function runRankingPython(code: string) {
  const client = agentRuntime.value?.client
  if (!client) throw new Error('Ranking Python is unavailable before Taskyon initializes')
  return parseRankingPythonResult(await client.callTool('executePythonScript', { code }))
}

let steps = 0
function choose(choice: 'left' | 'right' | 'none') {
  steps += 1
  const [left, right] = currentDuel.value
  if (!(left && right)) return
  let winner: -1 | 0 | 1 = -1
  if (choice === 'left') winner = 0
  else if (choice === 'right') winner = 1
  Object.assign(state, recordDuel(state, left.id, right.id, winner))
  loadNextDuel()
  if (steps % 10 === 0 || state.duels.length < 10) {
    void updateRanking().then(async () => {
      void train()
      await generateNames(state.params.generationBatchSize)
      await saveProject()
    })
  }
}

function resetProject() {
  Object.assign(state, createInitialState())
  state.ranking = []
  currentDuel.value = []
  openGoalDialog()
  void saveProject()
}

function importCsv() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.csv,text/csv'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    Object.assign(state, await addCandidates(state, lines))
    await updateRanking()
    loadNextDuel()
  }
  input.click()
  void saveProject()
}

/* ---------------- Metrics (computed) ---------------- */
const duelsFought = computed(() => state.duels.length)
const totalCandidates = computed(() => Object.keys(state.candidates).length)

const topCandidateId = computed(() => state.ranking[0])
const topCandidateName = computed(() => {
  const id = topCandidateId.value
  return id !== undefined ? state.candidates[id]?.name : undefined
})

const topCandidateStats = computed(() => {
  const id = topCandidateId.value
  if (id === undefined) return { wins: 0, total: 0 }
  let wins = 0
  let total = 0
  for (const d of state.duels) {
    if (d.leftId === id || d.rightId === id) {
      total++
      if ((d.winner === 0 && d.leftId === id) || (d.winner === 1 && d.rightId === id)) {
        wins++
      }
    }
  }
  return { wins, total }
})

const topWinRatioPct = computed(() => {
  const { wins, total } = topCandidateStats.value
  if (total === 0) return '—'
  return Math.round((wins / total) * 100) + '%'
})

const coveredCount = computed(() => {
  const seen = new Set<string>()
  for (const d of state.duels) {
    seen.add(d.leftId)
    seen.add(d.rightId)
  }
  return seen.size
})

const coveragePct = computed(() => {
  const total = totalCandidates.value
  if (total === 0) return '—'
  return Math.round((coveredCount.value / total) * 100) + '%'
})

/* ---------------- Keyboard shortcuts ---------------- */
function onRankingKeydown(event: KeyboardEvent) {
  const target = event.target
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return

  const choice =
    event.key === 'ArrowLeft'
      ? 'left'
      : event.key === 'ArrowRight'
        ? 'right'
        : event.key === ' '
          ? 'none'
          : undefined
  if (!choice) return
  event.preventDefault()
  choose(choice)
}
</script>

<style scoped>
.metrics-bar {
  background: inherit;
}

.metric-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.metric-label {
  font-variant: all-small-caps;
  opacity: 0.7;
}

.metric-value {
  font-weight: 600;
}

.duel-card {
  min-height: 40vh;
}

.ranking-empty-state {
  max-width: 34rem;
  padding: 1.5rem;
}

.duel-area .text-h5 {
  word-break: break-word;
}

.sheet-card {
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  overflow: hidden;
}

.agent-sheet {
  position: fixed;
  display: flex;
  flex-direction: column;
  left: 0;
  right: 0;
  bottom: 0;
  height: 80vh;
  background: var(--q-surface, #fff);
  z-index: 3000;
}

.agent-sheet :deep(.task-chat-window) {
  flex: 1;
  min-height: 0;
}
</style>
