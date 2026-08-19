import type { TaskCostBucket, TaskCostSummary } from '@taskyon/taskyon'

const formatAmount = (bucket: TaskCostBucket) => {
  const absoluteAmount = Math.abs(bucket.amount)
  const decimals = absoluteAmount >= 1 ? 2 : absoluteAmount >= 0.01 ? 4 : 6
  const value = bucket.amount.toFixed(decimals)
  return bucket.unit.toUpperCase() === 'USD' ? `$${value}` : `${value} ${bucket.unit}`
}

const formatBuckets = (buckets: readonly TaskCostBucket[]) =>
  buckets.length > 0
    ? buckets.map((bucket) => `${bucket.source}: ${formatAmount(bucket)}`).join(', ')
    : 'none'

const formatInteger = (value: number) => Math.round(value).toLocaleString('en-US')

const missingCount = (summary: TaskCostSummary) =>
  new Set([
    ...summary.missing.costTaskIds,
    ...summary.missing.metadataTaskIds,
    ...summary.missing.taskIds,
    ...summary.missing.usageTaskIds,
  ]).size

export const formatTaskCostSummaryLines = (summary: TaskCostSummary) => [
  `total:       ${formatBuckets(summary.total)}`,
  `accumulated: ${formatBuckets(summary.accumulated)}`,
  `current:     ${formatBuckets(summary.current)}`,
  `tokens:      ${formatInteger(summary.tokens.total)} total / ${formatInteger(summary.tokens.cachedInput)} cached`,
  summary.complete
    ? 'completeness: complete'
    : `completeness: partial (${missingCount(summary)} node(s) need more data)`,
]

export const formatTaskCostFooter = (summary: TaskCostSummary) => {
  const cost = summary.total.map(formatAmount).join(' + ')
  return {
    ...(cost ? { cost } : {}),
    incomplete: !summary.complete,
    cachePercent: summary.tokens.cachePercent,
  }
}
