<template>
  <q-layout>
    <TaskyonHeader btn-size="md" min-mode no-chat-button-border>
      <template #left>
        <div class="text-h6 text-primary q-ma-sm">
          <q-icon :name="matRocketLaunch" /> Taskyon/Rumoca Modelica Editor
        </div>
      </template>
    </TaskyonHeader>
    <q-page-container>
      <FixedHeightPage class="column">
        <ModelicaEditor
          class="col"
          :taskyon-signature-or-key="taskyonSignatureOrKey"
          :binding-key="appState.bindingKey"
          :taskyon-configuration="taskyonConfiguration"
        />
      </FixedHeightPage>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { matRocketLaunch } from '@quasar/extras/material-icons'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import ModelicaEditor from '@taskyon/shared/modelica/ModelicaEditor.vue'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import FixedHeightPage from 'src/pages/FixedHeightPage.vue'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed } from 'vue'

const tystate = useTaskyonStore()
const appState = useAppStateStore()

const taskyonSignatureOrKey = computed(() => tystate.getTaskyonKeyString() ?? null)
const taskyonConfiguration = computed<partialTyConfiguration>(() => ({
  appConfiguration: {
    darkTheme: appState.appConfiguration.darkTheme,
    primaryColor: appState.appConfiguration.primaryColor,
    secondaryColor: appState.appConfiguration.secondaryColor,
  },
}))
</script>
