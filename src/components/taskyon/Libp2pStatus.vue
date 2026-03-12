<template>
  <q-card-section>
    <div class="text-h4 text-primary q-mb-md">WebRTC Connectivity with js-libp2p</div>
    <!---btn flat label="connect" @click="p2p.start({})" />-->
    <!-- Statistics Section -->
    <!--TODO: <q-list dense class="q-mb-md">
          <q-item>
            <q-item-section>
              <q-item-label>
                Opened sessions in the last {{ openedPerUnit }}s: {{ openedPerMinute }}
              </q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label>
                Max opened connections per minute: {{ maxOpenedPerMinute }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-list>-->

    <!-- Node Section -->
    <div class="q-mb-lg">
      <div class="text-h5 text-primary q-mb-sm">Node Info</div>
      Address: {{ info.id }}
      <div>
        peer types:
        <pre>{{ safeYamlDump(info?.peerTypes) }}</pre>
      </div>
      <q-expansion-item label="addresses of this node" expand-separator>
        <div class="overflow-auto" style="max-height: 300px">
          <q-list>
            <q-item v-for="addr in info?.nodeAddresses" :key="addr">
              {{ addr }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="peers" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="peer in info?.nodePeerDetails" :key="peer.peerConnections[0]!">
              <q-item-section side>{{ peer.nodeType[0] }}</q-item-section>
              <q-item-section>{{ peer.peerConnections }}</q-item-section>
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="connections" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="c in info.connections" :key="c.id">
              {{ c.id }}
              {{ c.remotePeer.toString() }}
              {{ c.remoteAddr.toString() }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
      <q-expansion-item label="subscribers" expand-separator>
        <div class="overflow-auto">
          <q-list>
            <q-item v-for="s in info.subscribers" :key="s.toString()">
              {{ s.toString() }}
            </q-item>
          </q-list>
        </div>
      </q-expansion-item>
    </div>

    <!-- Peers Section -->
    <div class="q-mb-lg">
      <div class="text-h5 text-primary q-mb-sm">Peers</div>
      <div class="row q-gutter-md items-center q-mb-md">
        <div class="col">
          <q-input
            v-model="multiaddrInput"
            label="Multiaddr"
            placeholder="/ip4/..."
            outlined
            dense
            :disable="isBusy"
          />
        </div>
        <div class="col-auto">
          <template v-if="!runningExperimentalTest">
            <q-btn
              color="positive"
              label="Connect"
              :disable="isBusy"
              @click="connectToPeer(multiaddrInput)"
            />
            <q-btn
              color="positive"
              label="Connect localhost + run test"
              :disable="isBusy"
              @click="connectLocalhostAndRunTest"
            />
            <q-btn
              color="warning"
              label="Run Experimental Browser Test"
              :disable="isBusy"
              @click="runExperimentalBrowserTestFromUi"
            />
          </template>
          <q-btn
            v-if="runningExperimentalTest"
            color="negative"
            label="Stop Experimental Test"
            @click="stopExperimentalBrowserTest"
          />
        </div>
      </div>
    </div>

    <!-- Output Section -->
    <div class="row items-center q-gutter-sm q-mb-sm">
      <div class="text-h5 text-primary">Output</div>
      <ToggleButton
        v-model="verboseLogsEnabled"
        flat
        dense
        color="primary"
        label="Verbose libp2p Logs"
      />
      <q-btn
        flat
        dense
        color="primary"
        label="Copy Logs"
        :disable="output.length === 0"
        @click="copyLogs"
      />
    </div>
    <div class="q-mb-sm text-caption">
      test stats: sent hello={{ testStats.helloSent }}, sent ack={{ testStats.ackSent }}, received
      hello={{ testStats.helloReceived }}, received ack={{ testStats.ackReceived }}
    </div>
    <q-scroll-area style="height: 300px">
      <pre class="q-pa-md rounded-borders text-caption">{{ output }}</pre>
    </q-scroll-area>
  </q-card-section>
</template>

<script setup lang="ts">
import { type getActiveP2pNode, type P2pNodeInfo } from '@taskyon/taskyon'
import { enableVerboseBrowserLibp2pLogs, setBrowserLibp2pLogNamespaces } from '@taskyon/taskyon'
import { PRIMARY_RELAY_WS_MULTIADDR } from '@taskyon/p2p-core/constants'
import ToggleButton from '@taskyon/shared/components/ToggleButton.vue'
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import {
  startLibp2pBrowserMessageExchangeTest,
  runLibp2pBrowserMessageExchangeTest,
  type Libp2pBrowserTestStats,
  type Libp2pBrowserTestSession,
} from 'src/modules/taskyon/libp2pBrowserDiagnostics'
import { copyToClipboard } from 'quasar'
import { computed, ref, watch } from 'vue'

const { p2p } = defineProps<{ p2p: ReturnType<typeof getActiveP2pNode> }>()

const info = ref<Partial<P2pNodeInfo>>(p2p.getInfo())
p2p.stream((infoUpdate) => {
  console.log('infoUpdate', infoUpdate)
  info.value = { ...info.value, ...infoUpdate }
})

// Methods
const connecting = ref(false)
const multiaddrInput = ref(PRIMARY_RELAY_WS_MULTIADDR)
const isBusy = computed(() => connecting.value || runningExperimentalTest.value)

const formatError = (error: unknown) =>
  error instanceof Error ? error.message : safeYamlDump(error)

const createEmptyTestStats = (): Libp2pBrowserTestStats => ({
  helloSent: 0,
  ackSent: 0,
  helloReceived: 0,
  ackReceived: 0,
})

const appendOutput = (message: string) => {
  const timestamp = new Date().toISOString()
  output.value += `[${timestamp}] ${message}\n`
}

const withBusyFlag = async (target: typeof connecting, task: () => Promise<void>) => {
  if (target.value) return
  target.value = true
  try {
    await task()
  } finally {
    target.value = false
  }
}

const connectToPeer = async (addr: string) => {
  await withBusyFlag(connecting, async () => {
    appendOutput(`[connect] dialing ${addr}`)
    try {
      await p2p.connectToPeer(addr)
    } catch (error) {
      appendOutput(`[connect] error: ${formatError(error)}`)
    }
  })
}

const runningExperimentalTest = ref(false)
const experimentalTestSession = ref<Libp2pBrowserTestSession | null>(null)
const testStats = ref<Libp2pBrowserTestStats>(createEmptyTestStats())
const updateTestStats = (stats: Libp2pBrowserTestStats) => {
  testStats.value = stats
}
const resetTestStats = () => {
  testStats.value = createEmptyTestStats()
}
const attachPersistentResultLogging = (session: Libp2pBrowserTestSession) => {
  void session.resultPromise
    .then((result) => {
      appendOutput(`Experimental test OK (continuing to run):\n${safeYamlDump(result)}`)
    })
    .catch((error) => {
      appendOutput(`Experimental test ERROR: ${formatError(error)}`)
      runningExperimentalTest.value = false
      experimentalTestSession.value = null
    })
}

const runExperimentalBrowserTest = async (relayAddrs?: string[]) => {
  if (runningExperimentalTest.value) return
  runningExperimentalTest.value = true
  resetTestStats()
  appendOutput('Starting experimental libp2p browser message exchange test...')
  try {
    const result = await runLibp2pBrowserMessageExchangeTest({
      onLog: appendOutput,
      onStats: updateTestStats,
      ...(relayAddrs ? { relayAddrs } : {}),
    })
    appendOutput(`Experimental test OK:\n${safeYamlDump(result)}`)
  } catch (error) {
    appendOutput(`Experimental test ERROR: ${formatError(error)}`)
  } finally {
    runningExperimentalTest.value = false
  }
}

const startPersistentExperimentalBrowserTest = async (relayAddrs?: string[]) => {
  if (runningExperimentalTest.value) return
  runningExperimentalTest.value = true
  resetTestStats()
  appendOutput('Starting persistent experimental libp2p browser message exchange test...')
  try {
    const session = await startLibp2pBrowserMessageExchangeTest({
      onLog: appendOutput,
      onStats: updateTestStats,
      ...(relayAddrs ? { relayAddrs } : {}),
      keepRunningAfterSuccess: true,
    })
    experimentalTestSession.value = session
    attachPersistentResultLogging(session)
  } catch (error) {
    appendOutput(`Experimental test ERROR: ${formatError(error)}`)
    runningExperimentalTest.value = false
    experimentalTestSession.value = null
  }
}

const stopExperimentalBrowserTest = async () => {
  const session = experimentalTestSession.value
  if (session == null) return
  appendOutput('Stopping experimental libp2p browser message exchange test...')
  experimentalTestSession.value = null
  runningExperimentalTest.value = false
  await session.stop()
}
const runExperimentalBrowserTestFromUi = async () => {
  await runExperimentalBrowserTest()
}

const connectLocalhostAndRunTest = async () => {
  appendOutput('[local-test] connect localhost relay and auto-run experimental test')
  await connectToPeer('/ip4/127.0.0.1/tcp/9111/ws')
  await startPersistentExperimentalBrowserTest(['/ip4/127.0.0.1/tcp/9111/ws'])
}
const output = ref('')

const DEFAULT_BROWSER_LOG_NAMESPACES = 'p2p-core:*,libp2p:*,-libp2p:connection-manager:*,-*:trace'
const verboseLogsEnabled = ref(true)
const applyLibp2pLoggingMode = (verbose: boolean) => {
  const namespaces = verbose
    ? enableVerboseBrowserLibp2pLogs()
    : setBrowserLibp2pLogNamespaces(DEFAULT_BROWSER_LOG_NAMESPACES)
  appendOutput(`[libp2p] logger namespaces set: ${namespaces}`)
}
watch(
  verboseLogsEnabled,
  (enabled, prev) => {
    applyLibp2pLoggingMode(enabled)
    if (prev !== undefined) {
      appendOutput(`[libp2p] verbose logging ${enabled ? 'enabled' : 'disabled'}`)
    }
  },
  { immediate: true },
)

const copyLogs = async () => {
  try {
    await copyToClipboard(output.value)
    appendOutput('Copied output logs to clipboard.')
  } catch (error) {
    appendOutput(`Failed to copy output logs: ${formatError(error)}`)
  }
}

p2p.activityStream((msg) => {
  console.log('activityStream msg', msg)
  appendOutput(safeYamlDump(msg))
})

// Lifecycle
/*onMounted(async () => {
  const n = await libp2pPromise
  await n.start()

  n.port.receive((m) => {
    console.log(m)
    addToOutput(safeYamlDump(m))
  })

  useIntervalFn(() => {
    nodeInfo.value = nw.state.value?.info()
    //addToOutput('.$')
  }, 5000)
})*/
</script>
