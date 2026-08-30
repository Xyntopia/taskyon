import { buildCreateNewTaskChain } from '../core/createNewTaskChain'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import { FunctionCall } from '../types/tools'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testBrowserAndCliShareMessageWorkflowContract = () => {
  for (const entryName of ['taskyonFlow', 'cliFlow']) {
    const entryNode = createStandardEntryNodeTool({ name: entryName, renderOptions: {} })
    const chain = buildCreateNewTaskChain({
      currentTask: null,
      draftTask: { role: 'user', content: { type: 'message', data: 'Hello' } },
      entryNode: {
        role: 'system',
        content: { type: 'functioncall', data: { name: entryNode.name, arguments: {} } },
      },
      mode: 'message',
      priorTaskId: 'previous-message',
    })

    assert(chain.length === 2, `${entryName} should create one message and one entry call`)
    assert(
      chain[0]?.role === 'user' &&
        chain[0].content.type === 'message' &&
        chain[0].content.data === 'Hello' &&
        chain[0].priorID === 'previous-message',
      `${entryName} should link the submitted message to the previous conversation leaf`,
    )
    const entryTask = chain[1]
    assert(
      entryTask?.content.type === 'functioncall' && entryTask.content.data.name === entryName,
      `${entryName} should route the message through its EntryNode`,
    )
    const websearch = FunctionCall.parse(entryTask.content.data).arguments.websearch
    assert(
      websearch &&
        typeof websearch === 'object' &&
        !Array.isArray(websearch) &&
        websearch.enabled === true &&
        websearch.mode === 'auto',
      `${entryName} should use the same automatic web-search policy`,
    )
  }
  return { entryNodes: ['taskyonFlow', 'cliFlow'] }
}

testBrowserAndCliShareMessageWorkflowContract.description =
  'Checks the common message, conversation-link, EntryNode, and web-search contract for browser and CLI hosts.'
