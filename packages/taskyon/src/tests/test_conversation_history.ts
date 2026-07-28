import { forgeTaskChain } from '../core/createTasks'
import { recordConversationHistory, resolveConversationTitle } from '../core/conversationHistory'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testConversationHistoryTracksCurrentLeaves = async () => {
  const [firstUser, firstReply, followUp] = await forgeTaskChain([
    [
      { role: 'user', content: { type: 'message', data: 'Compare solar storage options' } },
      { role: 'assistant', content: { type: 'message', data: 'I can help with that.' } },
      { role: 'user', content: { type: 'message', data: 'Use the lower-cost option.' } },
    ],
  ])
  assert(firstUser && firstReply && followUp, 'Expected a complete diagnostic task chain')

  const tasks = new Map([firstUser, firstReply, followUp].map((task) => [task.id, task]))
  const chains = new Map([
    [firstUser.id, [firstUser]],
    [firstReply.id, [firstUser, firstReply]],
    [followUp.id, [firstUser, firstReply, followUp]],
  ])
  const client = {
    get: ({ id }: { id: string }) => Promise.resolve(tasks.get(id) ?? null),
    getChain: ({ id }: { id: string }) => Promise.resolve(chains.get(id) ?? []),
    getIdChain: ({ id }: { id: string }) =>
      Promise.resolve((chains.get(id) ?? []).map((task) => task.id)),
  }

  const unrelatedId = 'unrelated-conversation'
  const firstHistory = await recordConversationHistory(client, [unrelatedId], firstReply)
  assert(
    firstHistory[0] === firstReply.id && firstHistory[1] === unrelatedId,
    'Expected a new conversation leaf to be prepended without removing unrelated chats',
  )

  const advancedHistory = await recordConversationHistory(client, firstHistory, followUp)
  assert(
    advancedHistory[0] === followUp.id && !advancedHistory.includes(firstReply.id),
    'Expected an advanced conversation to replace its previous leaf',
  )
  assert(
    new Set(advancedHistory).size === advancedHistory.length,
    'Expected conversation history IDs to remain unique',
  )

  const longHistory = Array.from({ length: 50 }, (_, index) => `conversation-${index}`)
  const limitedHistory = await recordConversationHistory(client, longHistory, firstUser)
  assert(limitedHistory.length === 50, 'Expected conversation history to retain at most 50 chats')

  const title = await resolveConversationTitle(client, followUp.id)
  assert(
    title === 'Compare solar storage options',
    `Expected the first user message to provide the fallback title, got ${String(title)}`,
  )

  return { success: true }
}

testConversationHistoryTracksCurrentLeaves.description =
  'Tracks current conversation leaves and resolves a local title from the task chain.'
