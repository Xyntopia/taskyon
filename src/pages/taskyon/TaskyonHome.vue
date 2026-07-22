<template>
  <FadeAwayScrollPage class="taskyon-home q-pa-sm welcome frontpage-welcome">
    <div class="taskyon-home__content welcome-message column items-center no-wrap">
      <GetStarted>
        <template v-if="$q.platform.within.iframe" #welcome>
          {{ state.appConfiguration.welcomeMsg }}
        </template>
        <template #hero-input>
          <CreateNewTask
            v-model:file-attachments="fileAttachments"
            :entry-node="tystate.entryNode"
            class="frontpage-create-task"
            :min-mode="state.minimalGui === 'iframe'"
            :expert-mode="state.appConfiguration.expertMode"
            hero-mode
          />
        </template>
      </GetStarted>
    </div>
  </FadeAwayScrollPage>
</template>

<script setup lang="ts">
import FadeAwayScrollPage from '@taskyon/ui/components/FadeAwayScrollPage.vue'
import CreateNewTask from 'components/taskyon/CreateNewTask.vue'
import GetStarted from 'components/taskyon/GetStarted.vue'
import { warmupTaskChatPage } from 'src/router/taskChatLoader'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'stores/taskyonState'
import { useQuasar } from 'quasar'
import { onMounted, ref } from 'vue'

const $q = useQuasar()
const state = useAppStateStore()
const tystate = useTaskyonStore()
const fileAttachments = ref<File[]>([])

onMounted(() => {
  void tystate.taskyon
  warmupTaskChatPage()
})
</script>

<style scoped lang="sass">
.taskyon-home
  display: flex
  justify-content: center
  align-items: center
  width: 100%
  min-height: 100%
  overflow: hidden

.taskyon-home__content
  width: 100%
  max-width: 100%
  overflow: visible
</style>
