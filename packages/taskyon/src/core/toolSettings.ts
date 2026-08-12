import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { z } from 'zod'
import type { CrudWrapper } from '../utils/crudWrapper'
import { ContentHash, FunctionArguments, ToolBase } from '../types/tools'
import type { ToolInvocationRevisions } from '../types/tools'
import type { ToolManager } from './toolManager'

export const ToolSettingsSnapshot = z.strictObject({
  toolName: ToolBase.shape.name,
  toolRevision: ContentHash,
  settings: FunctionArguments,
})
export type ToolSettingsSnapshot = z.infer<typeof ToolSettingsSnapshot>

export const ToolSettingsRecord = z.strictObject({
  id: ContentHash,
  snapshot: ToolSettingsSnapshot,
})
export type ToolSettingsRecord = z.infer<typeof ToolSettingsRecord>

export const toolSettingsRevision = (snapshot: ToolSettingsSnapshot) =>
  ContentHash.parse(canonicalHash({ kind: 'taskyon.tool-settings.v1', snapshot }))

export const createToolSettingsManager = (storage: CrudWrapper<ToolSettingsRecord>) => {
  const get = async (revision: ContentHash) => {
    const record = await storage.get(revision)
    if (!record || toolSettingsRevision(record.snapshot) !== revision) return undefined
    return record.snapshot
  }

  const store = async (
    toolName: string,
    toolRevision: ContentHash,
    settings: z.input<typeof FunctionArguments>,
  ) => {
    const snapshot = ToolSettingsSnapshot.parse({ toolName, toolRevision, settings })
    const revision = toolSettingsRevision(snapshot)
    await storage.set(revision, { id: revision, snapshot })
    return revision
  }

  const resolve = async (
    toolName: string,
    toolRevision: ContentHash,
    settingsRevision: ContentHash,
  ) => {
    const snapshot = await get(settingsRevision)
    return snapshot?.toolName === toolName && snapshot.toolRevision === toolRevision
      ? snapshot
      : undefined
  }

  return { get, resolve, store }
}

export type ToolSettingsManager = ReturnType<typeof createToolSettingsManager>

export const createInvocationRevisionResolver =
  (dependencies: {
    resolveTool: ToolManager['resolveTool']
    getToolSettings: (name: string) => z.input<typeof FunctionArguments> | undefined
    settingsManager: ToolSettingsManager
  }) =>
  async (request: {
    name: string
    toolRevision?: ContentHash
    settingsRevision?: ContentHash
  }): Promise<ToolInvocationRevisions | null> => {
    const resolved = await dependencies.resolveTool(request.name, request.toolRevision)
    if (!resolved.identity) return null
    const toolRevision = resolved.identity.revision
    if (request.settingsRevision) {
      const snapshot = await dependencies.settingsManager.resolve(
        request.name,
        toolRevision,
        request.settingsRevision,
      )
      return snapshot ? { toolRevision, settingsRevision: request.settingsRevision } : null
    }
    const settings = dependencies.getToolSettings(request.name)
    if (!settings || Object.keys(settings).length === 0) return { toolRevision }
    const settingsRevision = await dependencies.settingsManager.store(
      request.name,
      toolRevision,
      settings,
    )
    return { toolRevision, settingsRevision }
  }

export type InvocationRevisionResolver = ReturnType<typeof createInvocationRevisionResolver>
