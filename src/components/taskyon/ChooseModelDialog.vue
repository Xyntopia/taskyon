<template>
  <ResponsiveMenuDialogBtn
    size="sm"
    no-caps
    class="col-auto model-history"
    dense
    flat
    maximized
    data-cy-menu="model-selection"
  >
    <template #btnContent>
      <q-icon :name="matSmartToy" />
      <div data-cy="model-id" class="q-pl-xs ellipsis">
        {{ `${tystate.currentModelId}` }}
      </div>
      <div class="text-weight-thin gt-xs">/{{ state.llmSettings.selectedApi }}</div>
    </template>
    <template #default="{ close }">
      <q-list dense style="min-width: 100px">
        <div class="row">
          <q-btn square flat :icon="matSmartToy" label="Model List" to="/pricing" />
          <ApiSelect v-model="state.llmSettings.selectedApi" more-settings />
        </div>
        <q-separator />
        <q-item-label header>Previously selected AI models!</q-item-label>
        <q-item v-if="state.modelHistory.length === 0" v-close-popup>
          No other models were selected yet!
        </q-item>
        <q-item
          v-for="(m, idx) in state.modelHistory"
          :key="m"
          v-close-popup
          clickable
          @click="tystate.handleBotNameUpdate({ newName: m })"
        >
          <q-item-section>{{ state.modelHistory.length - idx }}: {{ m }}</q-item-section>
        </q-item>
        <q-separator />
        <div class="text-info column items-center">
          <div>
            <q-item class="row items-center">
              <q-icon :name="matSmartToy" size="sm" class="q-pr-md"></q-icon>
              <ModelSelection
                v-model:selected-api="selectedApi"
                class="col"
                :bot-name="tystate.currentModelId"
                :model-list="state.appConfiguration.expertMode"
                :select-api="state.appConfiguration.expertMode"
                @update-bot-name="
                  (bot) => {
                    tystate.handleBotNameUpdate(bot)
                    close()
                  }
                "
              ></ModelSelection>
            </q-item>
          </div>
          <InfoDialog
            v-if="tystate.currentModelId && tystate.currentModel?.description"
            :round="false"
            class="fit"
            square
            :dense="false"
            label="Info about current model"
            no-caps
            :info-text="tystate.currentModel?.description || ''"
          />
        </div>
      </q-list>
      <q-card-actions v-if="$q.platform.is.mobile" class="float-right">
        <q-btn v-close-popup flat label="Ok" />
      </q-card-actions>
    </template>
  </ResponsiveMenuDialogBtn>
</template>

<script setup lang="ts">
import { matSmartToy } from '@quasar/extras/material-icons'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import ModelSelection from './ModelSelection.vue'
import { toRefs } from 'vue'
import InfoDialog from '../InfoDialog.vue'
import ResponsiveMenuDialogBtn from '../ResponsiveMenuDialogBtn.vue'

const state = useAppStateStore()
const tystate = useTaskyonStore()

const { selectedApi } = toRefs(state.llmSettings)
</script>
