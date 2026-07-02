<template>
  <q-page class="q-pa-md column q-gutter-md">
    <div class="row items-center q-gutter-sm">
      <div class="text-h5">DAG Nodes</div>
      <q-space />
      <q-btn outline icon="account_tree" label="Graph" to="/project/graph" />
      <q-btn color="primary" icon="add" label="Add" @click="addNode" />
    </div>

    <div class="row q-col-gutter-md node-editor-body">
      <div class="col-12 col-md-3">
        <q-list bordered separator>
          <q-item-label header>Default dynamic nodes</q-item-label>
          <q-item
            v-for="node in builtInNodes"
            :key="node.id"
            clickable
            :active="node.id === selectedId && selectedKind === 'builtin'"
            @click="selectNode('builtin', node.id)"
          >
            <q-item-section>
              <q-item-label>{{ node.label }}</q-item-label>
              <q-item-label caption>{{ node.id }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-icon name="lock" size="18px" />
            </q-item-section>
          </q-item>

          <q-separator />

          <q-item-label header>Project dynamic nodes</q-item-label>
          <q-item
            v-for="node in projectNodes"
            :key="node.id"
            clickable
            :active="node.id === selectedId && selectedKind === 'project'"
            @click="selectNode('project', node.id)"
          >
            <q-item-section>
              <q-item-label>{{ node.label }}</q-item-label>
              <q-item-label caption>{{ node.id }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </div>

      <div class="col-12 col-md-9">
        <q-card v-if="selectedNode" flat bordered>
          <q-card-section class="row items-center q-gutter-sm">
            <div>
              <div class="text-subtitle1">{{ selectedNode.label }}</div>
              <div class="text-caption text-grey-7">{{ selectedNode.id }}</div>
            </div>
            <q-space />
            <q-chip dense square :color="isReadonly ? 'grey-7' : 'primary'" text-color="white">
              {{ isReadonly ? 'Default' : 'Project' }}
            </q-chip>
          </q-card-section>

          <q-separator />

          <q-card-section class="column q-gutter-md">
            <q-input v-model="form.label" dense outlined label="Label" :readonly="isReadonly" />
            <q-input
              v-model.number="form.timeoutMs"
              dense
              outlined
              type="number"
              min="100"
              max="60000"
              step="100"
              label="Timeout ms"
              :readonly="isReadonly"
            />
            <q-input
              v-model="form.inputJson"
              outlined
              type="textarea"
              autogrow
              label="Input JSON"
              :readonly="isReadonly"
            />
            <CodeEditor v-model="form.code" language="javascript" class="code-editor" />
          </q-card-section>

          <q-separator />

          <q-card-actions align="right">
            <q-btn
              v-if="!isReadonly"
              flat
              color="negative"
              icon="delete"
              label="Delete"
              @click="deleteSelected"
            />
            <q-btn outline icon="play_arrow" label="Test" @click="testSelected" />
            <q-btn
              v-if="!isReadonly"
              outline
              icon="check_circle"
              label="Use Node"
              @click="useSelected"
            />
            <q-btn v-if="!isReadonly" color="primary" icon="save" label="Save" @click="saveSelected" />
          </q-card-actions>
        </q-card>

        <q-card v-if="testResult !== null" flat bordered class="q-mt-md">
          <q-card-section>
            <pre class="node-test-result">{{ testResult }}</pre>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import CodeEditor from '@shared/components/CodeEditor.vue'
import { computed, reactive, ref, watch } from 'vue'
import { useJouliosModel } from 'src/stores/model/model'

type NodeKind = 'builtin' | 'project'

const model = useJouliosModel()
const selectedId = ref<string | null>(null)
const selectedKind = ref<NodeKind>('builtin')
const testResult = ref<string | null>(null)

const form = reactive({
  label: '',
  timeoutMs: 5_000,
  inputJson: '{}',
  code: '',
})

const builtInNodes = computed(() =>
  Object.values(model.builtInDynamicNodeDefinitions).sort((a, b) => a.id.localeCompare(b.id)),
)
const projectNodes = computed(() =>
  Object.values(model.dynamicNodeDefinitions).sort((a, b) => a.id.localeCompare(b.id)),
)
const selectedNode = computed(() => {
  if (!selectedId.value) return null
  return selectedKind.value === 'builtin'
    ? model.builtInDynamicNodeDefinitions[selectedId.value]
    : model.dynamicNodeDefinitions[selectedId.value]
})
const isReadonly = computed(() => selectedKind.value === 'builtin')

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2)

const readInputJson = (): Record<string, unknown> => {
  const parsed = JSON.parse(form.inputJson) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Input JSON must be an object.')
  }
  return parsed as Record<string, unknown>
}

const inputDefault = (node: NonNullable<typeof selectedNode.value>): unknown =>
  (((typeof node.localParamsSchema === 'object' && node.localParamsSchema !== null && 'properties' in node.localParamsSchema
    ? node.localParamsSchema.properties
    : undefined) as Record<string, unknown> | undefined)
    ?.input as Record<string, unknown> | undefined)?.default ?? {}

const loadForm = () => {
  const node = selectedNode.value
  if (!node) return
  form.label = node.label
  form.timeoutMs = node.timeoutMs ?? 5_000
  form.inputJson = formatJson(inputDefault(node))
  const runCode = typeof node.runCode === 'string' ? node.runCode : String(node.run ?? '(ctx) => ctx.params')
  const legacyMatch = runCode.match(/^\(ctx\)\s*=>\s*\(\{\s*value:\s*\(([\s\S]+)\)\(ctx\.params\.input\)\s*\}\)\s*$/)
  form.code = legacyMatch?.[1]?.trim() ?? runCode
  testResult.value = null
}

const selectNode = (kind: NodeKind, id: string) => {
  selectedKind.value = kind
  selectedId.value = id
}

const addNode = () => {
  const node = model.createDynamicNode()
  selectNode('project', node.id)
}

const saveSelected = () => {
  if (isReadonly.value) return
  const id = selectedId.value
  if (!id) return
  model.updateDynamicNode(id, {
    label: form.label,
    timeoutMs: form.timeoutMs,
    input: readInputJson(),
    code: form.code,
  })
  loadForm()
}

const useSelected = () => {
  if (isReadonly.value) return
  const id = selectedId.value
  if (!id) return
  saveSelected()
  model.selectedOutputNode = id
}

const testSelected = async () => {
  const id = selectedId.value
  if (!id) return
  try {
    if (!isReadonly.value) saveSelected()
    const node = model.getOutputNode(id)
    const { value } = await node.call({ input: readInputJson() } as never).run()
    testResult.value = formatJson(value)
  } catch (error) {
    testResult.value = error instanceof Error ? error.message : String(error)
  }
}

const deleteSelected = () => {
  if (isReadonly.value) return
  const id = selectedId.value
  if (!id) return
  model.deleteDynamicNode(id)
  const next = projectNodes.value[0] ?? builtInNodes.value[0]
  if (next) selectNode(projectNodes.value[0] ? 'project' : 'builtin', next.id)
}

watch([selectedId, selectedKind], loadForm)
watch(
  [builtInNodes, projectNodes],
  () => {
    if (selectedNode.value) return
    const first = builtInNodes.value[0] ?? projectNodes.value[0]
    if (!first) return
    selectNode(builtInNodes.value[0] ? 'builtin' : 'project', first.id)
  },
  { immediate: true },
)
</script>

<style scoped>
.node-editor-body {
  min-height: 0;
}

.code-editor {
  min-height: 280px;
  border: 1px solid rgba(127, 127, 127, 0.35);
}

.node-test-result {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
