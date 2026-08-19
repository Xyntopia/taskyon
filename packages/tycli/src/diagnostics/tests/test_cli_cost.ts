import type { TaskCostSummary } from '@taskyon/taskyon'
import { formatTaskCostFooter, formatTaskCostSummaryLines } from '../../cli/cost'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const summary: TaskCostSummary = {
  accumulated: [{ amount: 0.9, source: 'openrouter.ai', unit: 'USD' }],
  complete: false,
  current: [{ amount: 0.2, source: 'taskyon', unit: 'credits' }],
  missing: {
    costTaskIds: ['missing'],
    metadataTaskIds: [],
    taskIds: [],
    usageTaskIds: ['missing'],
  },
  scope: 'tree',
  tokens: {
    cachedInput: 25,
    cachePercent: 25,
    input: 100,
    output: 20,
    total: 120,
  },
  total: [
    { amount: 1.1, source: 'openrouter.ai', unit: 'USD' },
    { amount: 0.2, source: 'taskyon', unit: 'credits' },
  ],
}

export const testCliCostFormattingSeparatesUnitsAndMarksPartialData = () => {
  const lines = formatTaskCostSummaryLines(summary)
  assert(
    lines[0] === 'total:       openrouter.ai: $1.10, taskyon: 0.2000 credits',
    'Expected separated totals',
  )
  assert(
    lines.at(-1) === 'completeness: partial (1 node(s) need more data)',
    'Expected incomplete indicator',
  )
  const footer = formatTaskCostFooter(summary)
  assert(footer.cost === '$1.10 + 0.2000 credits', 'Expected currencies to stay separate')
  assert(footer.incomplete, 'Expected the footer to mark incomplete data')
  assert(footer.cachePercent === 25, 'Expected the footer cache percentage')
  return { success: true }
}

testCliCostFormattingSeparatesUnitsAndMarksPartialData.description =
  'Formats tree cost output without combining USD and Taskyon credit amounts.'
