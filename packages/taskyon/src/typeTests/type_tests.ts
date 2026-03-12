// type_tests.ts
import type OpenAI from 'openai'
import type { TaskyonMessage } from '../types/apiTypes'
import type { ChatResponseType } from '../types/chatCompletion'
import { assertType } from '../utils/tsHelpers'
import { createDuplexChannel } from '@taskyon/shared/modules/frpBus'

const A = createDuplexChannel<TaskyonMessage, unknown>()
const B = createDuplexChannel<TaskyonMessage, unknown>()

A.y.connect(B.x)

// Use the function to trigger type checking.
assertType<ChatResponseType>({} as OpenAI.ChatCompletion)
