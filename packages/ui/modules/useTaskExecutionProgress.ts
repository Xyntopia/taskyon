import type { StreamSubscription } from '@taskyon/common/modules/frpBus'
import type { ChatCompletionStreamEvent, TyTaskStreamData } from '@taskyon/taskyon'
import { computed, onScopeDispose, shallowRef } from 'vue'
import {
  createTaskExecutionProgressState,
  reduceChatCompletionProgress,
  reduceWorkerProgress,
} from './taskExecutionProgress'

export const useTaskExecutionProgress = (
  initialChatCompletionStream?: StreamSubscription<ChatCompletionStreamEvent>,
  initialWorkerStream?: StreamSubscription<TyTaskStreamData>,
) => {
  const state = shallowRef(createTaskExecutionProgressState())
  let disconnect = () => {}

  const reset = () => {
    state.value = createTaskExecutionProgressState()
  }

  const connect = (
    chatCompletionStream?: StreamSubscription<ChatCompletionStreamEvent>,
    workerStream?: StreamSubscription<TyTaskStreamData>,
  ) => {
    disconnect()
    reset()
    const unsubscribeChat = chatCompletionStream?.((event) => {
      state.value = reduceChatCompletionProgress(state.value, event)
    })
    const unsubscribeWorker = workerStream?.((event) => {
      state.value = reduceWorkerProgress(state.value, event)
    })
    const disconnectStreams = () => {
      unsubscribeChat?.()
      unsubscribeWorker?.()
    }
    disconnect = disconnectStreams
    return disconnectStreams
  }

  if (initialChatCompletionStream || initialWorkerStream) {
    connect(initialChatCompletionStream, initialWorkerStream)
  }
  onScopeDispose(() => disconnect())

  return {
    connect,
    reset,
    state: computed(() => state.value),
  }
}
