import {
  getWorkflowDeviation,
  workflowSteps,
  verifySearchedComputation,
} from './conversation/ideal-workflows/workflowTestSupport'
import { runIdealWorkflowMatrixCases } from './conversation/ideal-workflows/test_ideal_workflow_matrix'
import type { TaskNode } from '../types/taskNode'

export const testCombinedWorkflowRequiresSearchBeforeFinalComputation = () => {
  const completion: TaskNode = {
    id: 'search',
    role: 'function',
    content: { type: 'functioncall', data: { name: 'chatCompletion', arguments: {} } },
  }
  const tool: TaskNode = {
    id: 'calculate',
    role: 'function',
    content: {
      type: 'functioncall',
      data: {
        name: 'executeJavaScript',
        arguments: { code: '"2026-01-02".split("").reverse().join("")' },
      },
    },
  }
  const result: TaskNode = {
    id: 'result',
    role: 'system',
    content: { type: 'toolresult', data: '20-10-6202' },
  }
  const searchMeta = [{ streamContent: 'response.web_search_call.completed' }]
  verifySearchedComputation([completion, tool, result], searchMeta, '2026-01-02')
  verifySearchedComputation(
    [tool, result, completion, { ...tool, id: 'retry' }, result],
    searchMeta,
    '2026-01-02',
  )
  for (const [tasks, date] of [
    [[tool, result, completion], '2026-01-02'],
    [[completion, tool, result], '2026-02-03'],
  ] as const) {
    let rejected = false
    try {
      verifySearchedComputation(tasks, searchMeta, date)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Accepted search after computation or an invented date')
  }
}

export const testIdealWorkflowGuardStopsUnexpectedFollowUp = () => {
  const expected = [['chatCompletion', 'assistant', 'return']]
  if (getWorkflowDeviation(['chatCompletion'], expected, 'greeting')) {
    throw new Error('Expected a valid workflow prefix to remain valid')
  }
  if (getWorkflowDeviation(expected[0]!, expected, 'greeting', true)) {
    throw new Error('Expected the greeting workflow to remain valid')
  }
  const deviation = getWorkflowDeviation(
    ['chatCompletion', 'selectTaskyonTools'],
    expected,
    'greeting',
  )
  if (!deviation) throw new Error('Expected unexpected catalog search to stop the greeting')
}

export const testIdealWorkflowGuardAllowsCombinedSearchContinuation = () => {
  const entry = 'taskyonFlow'
  const allowed = [
    'chatCompletion',
    'executeJavaScript',
    'tool result',
    entry,
    'chatCompletion',
    'assistant',
    'return',
  ]
  const fallback = [
    'chatCompletion',
    'executeJavaScript',
    'tool result',
    entry,
    'chatCompletion',
    'bash',
    'tool result',
    entry,
    'chatCompletion',
    'assistant',
    'return',
  ]
  const expected = [allowed, fallback]
  if (getWorkflowDeviation(allowed, expected, 'combined', true)) {
    throw new Error('Expected the combined workflow to allow its normal continuation')
  }
  if (getWorkflowDeviation(fallback, expected, 'combined', true)) {
    throw new Error('Expected the combined workflow to allow a two-pass search fallback')
  }
  if (
    !getWorkflowDeviation([...fallback.slice(0, -2), 'executeJavaScript'], expected, 'combined')
  ) {
    throw new Error('Expected a third execution call to stop the combined workflow')
  }
}

export const testIdealWorkflowGuardStopsUnexpectedWebsearchTool = () => {
  const deviation = getWorkflowDeviation(
    ['chatCompletion', 'executeJavaScript'],
    [['chatCompletion', 'assistant', 'return']],
    'websearch',
  )
  if (!deviation) {
    throw new Error('Expected a tool call to stop the web-search-only workflow immediately')
  }
  if (!deviation.includes('Unexpected websearch workflow')) {
    throw new Error(`Expected a web-search guard error, got: ${deviation}`)
  }
}

export const testIdealWorkflowGuardIgnoresProgressTextBeforeToolUse = () => {
  const tasks: TaskNode[] = [
    {
      id: 'completion',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'chatCompletion', arguments: {} } },
    },
    { id: 'progress', role: 'assistant', content: { type: 'message', data: 'Calculating now.' } },
    {
      id: 'tool',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'bash', arguments: {} } },
    },
    { id: 'result', role: 'function', content: { type: 'toolresult', data: 4 } },
    {
      id: 'entry',
      role: 'system',
      content: { type: 'functioncall', data: { name: 'taskyonFlow', arguments: {} } },
    },
    {
      id: 'finalCompletion',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'chatCompletion', arguments: {} } },
    },
    { id: 'answer', role: 'assistant', content: { type: 'message', data: '4' } },
    { id: 'return', role: 'system', content: { type: 'return', data: '' } },
  ]
  const flow = workflowSteps(tasks)
  const expected = [
    [
      'chatCompletion',
      'bash',
      'tool result',
      'taskyonFlow',
      'chatCompletion',
      'assistant',
      'return',
    ],
  ]
  if (getWorkflowDeviation(flow, expected, 'pinned', true)) {
    throw new Error(
      `Expected progress text to leave the minimal tool workflow intact: ${flow.join(' → ')}`,
    )
  }
}

export const testIdealWorkflowMatrixRunsEveryCaseForEveryModel = async () => {
  const calls: string[] = []
  const results = await runIdealWorkflowMatrixCases(
    {},
    ['luna', 'glm'],
    [
      {
        name: 'first',
        run: (_context, model) => {
          calls.push(`first:${model}`)
          return model === 'luna'
            ? Promise.reject(new Error('synthetic miss'))
            : Promise.resolve({ success: true })
        },
      },
      {
        name: 'second',
        run: (_context, model) => {
          calls.push(`second:${model}`)
          return Promise.resolve({ success: true })
        },
      },
      {
        name: 'hung',
        run: (_context, model) => {
          calls.push(`hung:${model}`)
          return new Promise(() => undefined)
        },
      },
    ],
    5,
  )

  if (
    calls.sort().join(',') !==
    ['first:glm', 'first:luna', 'hung:glm', 'hung:luna', 'second:glm', 'second:luna'].join(',')
  ) {
    throw new Error(`Expected every model/workflow pair to run, got ${calls.join(',')}`)
  }
  if (results.length !== 6 || results.filter((result) => !result.ok).length !== 3) {
    throw new Error('Expected the matrix to record failures and continue through every pair')
  }
}
