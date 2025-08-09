<template>
  <main class="pageio-test q-pa-md">
    <h1>PageIO Test</h1>
    <form class="pageio-test__form" @submit.prevent>
      <label>
        Name
        <input
          v-model="form.name"
          data-testid="pageio-name"
          name="pageio-name"
          placeholder="Name"
        />
      </label>
      <label>
        Notes
        <textarea
          v-model="form.notes"
          data-testid="pageio-notes"
          name="pageio-notes"
          placeholder="Notes"
        />
      </label>
      <label>
        Priority
        <select v-model="form.priority" data-testid="pageio-priority" name="pageio-priority">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <button type="button" data-testid="pageio-button" @click="buttonClicks += 1">
        Click target
      </button>
    </form>
    <output data-testid="pageio-result">
      {{ form.name }}|{{ form.notes }}|{{ form.priority }}|{{ buttonClicks }}
    </output>
    <section id="target" data-testid="pageio-target">Hash target</section>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  createSubtasksResult,
  type ClientToolContext,
  type FunctionArguments,
} from '@taskyon/tyclient'
import { createPageIOSessionStore, makePageIOTool } from 'src/modules/taskyon/PageIOTool'

type PageIOTestBridge = {
  call: (args: FunctionArguments) => Promise<unknown>
  callWithoutScreenshot: (args: FunctionArguments) => Promise<unknown>
  consentCalls: () => number
  screenshotCalls: () => number
  setConsent: (next: boolean) => void
  storedScreenshots: () => unknown[]
  screenshotActions: () => unknown
  actionsWithoutScreenshot: () => unknown
}

declare global {
  interface Window {
    __pageIOTest?: PageIOTestBridge
  }
}

const form = reactive({
  name: '',
  notes: '',
  priority: 'low',
})
const buttonClicks = ref(0)

const store = createPageIOSessionStore()
const abortController = new AbortController()
const context: ClientToolContext = {
  getExecutionTaskChain: async () => [],
  createSubtasksResult,
  stopSignal: abortController.signal,
}

let consentAllowed = false
let consentCallCount = 0
let screenshotCallCount = 0

const screenshotTool = makePageIOTool({
  screenshot: {
    requestConsent: async () => {
      consentCallCount += 1
      return consentAllowed
    },
    capture: async () => {
      screenshotCallCount += 1
      return {
        bytes:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
        mediaType: 'image/png',
        width: 1,
        height: 1,
      }
    },
    store,
  },
})
const plainTool = makePageIOTool()

const callTool = async (tool: ReturnType<typeof makePageIOTool>, args: FunctionArguments) => {
  if (!tool.function) throw new Error('pageIO test tool has no function')
  return await tool.function(args, context)
}

const actionProperty = (tool: ReturnType<typeof makePageIOTool>): unknown => {
  const parameters = tool.parameters
  if (!parameters || typeof parameters !== 'object' || !('properties' in parameters)) {
    return undefined
  }
  const properties = parameters.properties
  if (!properties || typeof properties !== 'object' || !('action' in properties)) return undefined
  return properties.action
}

window.__pageIOTest = {
  call: (args) => callTool(screenshotTool, args),
  callWithoutScreenshot: (args) => callTool(plainTool, args),
  consentCalls: () => consentCallCount,
  screenshotCalls: () => screenshotCallCount,
  setConsent: (next) => {
    consentAllowed = next
  },
  storedScreenshots: () => store.list(),
  screenshotActions: () => actionProperty(screenshotTool),
  actionsWithoutScreenshot: () => actionProperty(plainTool),
}
</script>

<style lang="sass" scoped>
.pageio-test
  max-width: 640px

.pageio-test__form
  display: grid
  gap: 12px

.pageio-test__form label
  display: grid
  gap: 4px

.pageio-test__form input,
.pageio-test__form textarea,
.pageio-test__form select
  border: 1px solid #999
  padding: 8px

.pageio-test__form button
  border: 1px solid #555
  padding: 8px 12px
  width: fit-content
</style>
