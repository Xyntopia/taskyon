import { canonicalHash, type DagStorageBackend, type Hash } from './caching.ts'
import {
  createInvocationDefinition,
  createInvocationRun,
  type InvocationRun,
} from './designGraphModel.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { DesignGraphRepository } from './designGraphRepository.ts'
import { renderedDocumentSchema, type renderDocumentTemplate } from './documentTemplate.ts'

export const documentBuildExportFormats = ['markdown', 'template', 'coverage', 'blockers'] as const
export type DocumentBuildExportFormat = (typeof documentBuildExportFormats)[number]

/** Export retained bytes/values, never re-render a historical build. */
export const readDocumentBuildExport = async (
  backend: DagStorageBackend,
  run: InvocationRun,
  format: DocumentBuildExportFormat,
) => {
  if (!documentBuildExportFormats.includes(format))
    throw new Error('Unsupported document export format.')
  const artifact = run.artifacts[format]
  if (!artifact) throw new Error(`The saved build has no ${format} artifact.`)
  const value = await backend.readArtifact<unknown>(artifact.id)
  if (value === undefined || canonicalHash(value) !== artifact.id)
    throw new Error(`Document ${format} artifact integrity check failed.`)
  const isText = format === 'markdown' || format === 'template'
  if (isText && typeof value !== 'string')
    throw new Error('Document text artifact is not a string.')
  return {
    artifactHash: artifact.id,
    content: isText && typeof value === 'string' ? value : canonicalJson(value) + '\n',
    mediaType: isText ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8',
    extension:
      format === 'markdown' ? 'md' : format === 'template' ? 'template.md' : `${format}.json`,
  }
}

export const createDocumentInvocation = (
  templateInvocationId: Hash,
  bindings: Record<string, Hash>,
  rendererId: Hash,
) =>
  createInvocationDefinition({
    rootNodeId: rendererId,
    variables: {
      template: { kind: 'constant', value: templateInvocationId },
      bindings: { kind: 'constant', value: bindings },
    },
    inputs: {},
    objectives: [],
    constraints: [],
    capture: [],
    policy: { accuracy: 'exact' },
    reducerOverrides: {},
  })

/** An explicit build uses ordinary invocation runs; previews do not create history records. */
export const saveDocumentBuild = async (args: {
  repository: DesignGraphRepository
  backend: DagStorageBackend
  templateInvocationId: Hash
  bindings: Record<string, Hash>
  document: Awaited<ReturnType<typeof renderDocumentTemplate>>
  association: { projectRevisionId: Hash; documentId: string }
  startedAtMs: number
  completedAtMs: number
}) => {
  const invocation = createDocumentInvocation(
    args.templateInvocationId,
    args.bindings,
    args.document.rendererId,
  )
  await args.repository.putInvocation(invocation)
  const coverage = args.document.views.map(({ id, invocation, status, reason }) => ({
    id,
    invocation,
    status,
    ...(reason ? { reason } : {}),
  }))
  const run = createInvocationRun({
    invocationId: invocation.id,
    resolvedPolicy: {
      engine: { id: 'document-template', version: 1 },
      accuracy: 'exact',
      strategies: {},
    },
    status: 'completed',
    startedAtMs: args.startedAtMs,
    completedAtMs: args.completedAtMs,
    provenance: {
      ...args.association,
      templateInvocationId: args.templateInvocationId,
      bindings: args.bindings,
    },
    artifacts: {
      document: args.document.artifactHash,
      template: await args.backend.writeArtifact(args.document.template),
      markdown: await args.backend.writeArtifact(args.document.markdown),
      coverage: await args.backend.writeArtifact(coverage),
      blockers: await args.backend.writeArtifact(
        coverage.filter(({ status }) => status !== 'available'),
      ),
      ...Object.fromEntries(
        args.document.views.flatMap(({ id, artifactHash }) =>
          artifactHash ? [[`view.${id}`, artifactHash]] : [],
        ),
      ),
    },
  })
  await args.repository.putRun(run)
  return run
}

export const readDocumentBuildArtifact = async (backend: DagStorageBackend, id: Hash) => {
  const value = await backend.readArtifact<unknown>(id)
  if (canonicalHash(value) !== id)
    throw new Error('Document build artifact integrity check failed.')
  return renderedDocumentSchema.parse(value)
}

/** A bounded linear comparison: retain shared prefix/suffix, show the complete changed region. */
export const compareDocumentText = (before: string, after: string) => {
  const left = before.split('\n')
  const right = after.split('\n')
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let end = 0
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end += 1
  return {
    changed: before !== after,
    firstChangedLine: start + 1,
    removed: left.slice(start, left.length - end).join('\n'),
    added: right.slice(start, right.length - end).join('\n'),
  }
}
