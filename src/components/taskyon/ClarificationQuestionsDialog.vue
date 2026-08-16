<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="clarification-dialog">
      <q-card-section>
        <div class="text-subtitle1">Clarify Request</div>
        <div v-if="request.intro" class="text-body2 q-mt-sm">
          {{ request.intro }}
        </div>
      </q-card-section>

      <q-separator />

      <q-card-section class="q-gutter-md">
        <div v-for="question in request.questions" :key="question.id" class="clarification-field">
          <div class="text-body2 text-weight-medium q-mb-sm">
            {{ question.question }}
          </div>
          <q-option-group
            v-model="selectedAnswers[question.id]"
            :options="optionsFor(question)"
            type="radio"
            dense
          />
            <q-input
              v-model="customAnswers[question.id]"
              dense
              outlined
              class="q-mt-sm"
              placeholder="Custom answer"
              @update:model-value="() => { selectedAnswers[question.id] = '' }"
            />
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="onDialogCancel" />
        <q-btn color="secondary" label="Continue" @click="submitAnswers" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup lang="ts">
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  ClarificationRequest,
} from '@taskyon/taskyon/tools/clarificationTool'
import { CLARIFICATION_RESULT_INSTRUCTION } from '@taskyon/taskyon/tools/clarificationTool'
import { useDialogPluginComponent } from 'quasar'
import { reactive } from 'vue'

const props = defineProps<{
  request: ClarificationRequest
}>()

defineEmits([...useDialogPluginComponent.emits])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
const selectedAnswers = reactive<Record<string, string>>(
  Object.fromEntries(props.request.questions.map((question) => [question.id, ''])),
)

const customAnswers = reactive<Record<string, string>>({})

const optionsFor = (question: ClarificationQuestion) =>
  question.options.map((option) => ({
    label: option.description ? `${option.label} - ${option.description}` : option.label,
    value: option.label,
  }))

function submitAnswers() {
  const answers: ClarificationAnswer[] = props.request.questions.map((question) => ({
    id: question.id,
    question: question.question,
    answer: customAnswers[question.id]?.trim() || selectedAnswers[question.id] || '',
  }))
  onDialogOK({
    ...(props.request.intro ? { intro: props.request.intro } : {}),
    instruction: CLARIFICATION_RESULT_INSTRUCTION,
    answers,
  })
}
</script>

<style scoped lang="sass">
.clarification-dialog
  width: min(720px, calc(100vw - 32px))

.clarification-field
  border-top: 1px solid rgba(0, 0, 0, .08)
  padding-top: 12px

.clarification-field:first-child
  border-top: 0
  padding-top: 0
</style>
