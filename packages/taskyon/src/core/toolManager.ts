import type { InternalTool } from '../types/toolApi'
import { ContentHash as ContentHashSchema, ToolBase } from '../types/tools'
import type { ContentHash, ToolIdentity } from '../types/tools'
import type { CrudWrapper } from '../utils/crudWrapper'
import { sha256UrlSafeHash, uint8ArrayToBase64UrlSafe } from '../utils/encoding'
import type { JSONSchema7 } from '../utils/jsonSchema'

export type { ContentHash } from '../types/tools'

export type ToolExecution =
  | { kind: 'trusted-native'; implementationRevision: ContentHash }
  | { kind: 'sandboxed-code'; runtime: 'javascript'; source: string }
  | { kind: 'external-service'; serviceId: string; implementationRevision: ContentHash }

export type ToolManifest = {
  publisherId: string
  name: string
  description: string
  longDescription?: string
  parameters: JSONSchema7
  renderOptions?: {
    hideChat?: boolean
    hideLlm?: boolean
    hideVector?: boolean
  }
  execution: ToolExecution
}

export type ToolStorageRecord =
  | { type: 'manifest'; manifest: ToolManifest }
  | { type: 'active-revision'; revision: ContentHash }

const DEFINITION_PREFIX = 'd/'
const ACTIVE_PREFIX = 'a/'

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

export async function toolRevisionHash(manifest: ToolManifest): Promise<ContentHash> {
  const data = new TextEncoder().encode(`taskyon.tool-manifest.v1\0${canonicalJson(manifest)}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return `sha256:${uint8ArrayToBase64UrlSafe(digest)}`
}

function definitionKey(revision: ContentHash) {
  return `${DEFINITION_PREFIX}${revision.slice('sha256:'.length)}`
}

function activeKey(name: string) {
  return `${ACTIVE_PREFIX}${name}`
}

async function createManifest(tool: InternalTool): Promise<ToolManifest> {
  const toolBase = ToolBase.parse(tool)
  const renderOptions = toolBase.renderOptions
    ? {
        ...(toolBase.renderOptions.hideChat === undefined
          ? {}
          : { hideChat: toolBase.renderOptions.hideChat }),
        ...(toolBase.renderOptions.hideLlm === undefined
          ? {}
          : { hideLlm: toolBase.renderOptions.hideLlm }),
        ...(toolBase.renderOptions.hideVector === undefined
          ? {}
          : { hideVector: toolBase.renderOptions.hideVector }),
      }
    : undefined
  const execution = tool.code
    ? ({ kind: 'sandboxed-code', runtime: 'javascript', source: tool.code } as const)
    : tool.function
      ? ({
          kind: 'trusted-native',
          implementationRevision: `sha256:${await sha256UrlSafeHash(tool.function.toString())}`,
        } as const)
      : ({
          kind: 'external-service',
          serviceId: 'unbound',
          implementationRevision: `sha256:${await sha256UrlSafeHash(toolBase)}`,
        } as const)
  return {
    publisherId: 'local',
    name: toolBase.name,
    description: toolBase.description,
    ...(toolBase.longDescription ? { longDescription: toolBase.longDescription } : {}),
    parameters: toolBase.parameters,
    ...(renderOptions ? { renderOptions } : {}),
    execution,
  }
}

function manifestIdentity(manifest: ToolManifest, revision: ContentHash): ToolIdentity {
  return { publisherId: manifest.publisherId, name: manifest.name, revision }
}

export function createToolManager(
  storage: Pick<CrudWrapper<ToolStorageRecord>, 'get' | 'set' | 'list'>,
) {
  const runtimeTools = new Map<ContentHash, InternalTool>()
  let catalogRevision = 0
  let catalogRead: Promise<Record<string, InternalTool>> | null = null

  const getManifest = async (revision: ContentHash): Promise<ToolManifest | null> => {
    const record = await storage.get(definitionKey(revision))
    if (record?.type !== 'manifest') return null
    return (await toolRevisionHash(record.manifest)) === revision ? record.manifest : null
  }

  const resolveActiveRevision = async (name: string): Promise<ContentHash | null> => {
    const record = await storage.get(activeKey(name))
    if (record?.type !== 'active-revision') return null
    const parsed = ContentHashSchema.safeParse(record.revision)
    return parsed.success ? parsed.data : null
  }

  const listStoredRecords = async () => await storage.list()

  const listActiveRevisions = async (): Promise<{ name: string; revision: ContentHash }[]> =>
    (await listStoredRecords())
      .filter(
        (row): row is typeof row & { data: { type: 'active-revision'; revision: ContentHash } } =>
          String(row.id).startsWith(ACTIVE_PREFIX) && row.data.type === 'active-revision',
      )
      .map((row) => ({
        name: String(row.id).slice(ACTIVE_PREFIX.length),
        revision: row.data.revision,
      }))

  const installManifest = async (
    manifest: ToolManifest,
    options: { approveReplacement?: boolean } = {},
  ): Promise<ToolIdentity> => {
    const revision = await toolRevisionHash(manifest)
    const currentRevision = await resolveActiveRevision(manifest.name)
    if (currentRevision === revision) return manifestIdentity(manifest, revision)
    if (currentRevision && currentRevision !== revision && !options.approveReplacement) {
      throw new Error(
        `Tool "${manifest.name}" already has an active revision; replacement approval is required`,
      )
    }
    await storage.set(definitionKey(revision), { type: 'manifest', manifest })
    await storage.set(activeKey(manifest.name), { type: 'active-revision', revision })
    catalogRevision += 1
    return manifestIdentity(manifest, revision)
  }

  const installTool = async (
    tool: InternalTool,
    options: { approveReplacement?: boolean } = {},
  ): Promise<ToolIdentity> => {
    const identity = await installManifest(await createManifest(tool), options)
    if (tool.function) runtimeTools.set(identity.revision, tool)
    return identity
  }

  const addDefaultTools = async (defaultTools: InternalTool[]) => {
    const activeRevisions = new Map(
      (await listActiveRevisions()).map(({ name, revision }) => [name, revision]),
    )
    await Promise.all(
      defaultTools.map(async (tool) => {
        const toolDef = ToolBase.safeParse(tool)
        if (!toolDef.success) {
          console.warn(`Tool ${tool.name} is not a valid ToolBase!`, toolDef.error)
          return
        }
        const manifest = await createManifest(tool)
        const revision = await toolRevisionHash(manifest)
        if (activeRevisions.get(tool.name) === revision) {
          if (tool.function) runtimeTools.set(revision, tool)
          return
        }
        await installTool(tool, { approveReplacement: true })
      }),
    )
  }

  async function getToolByRevision(
    revision: ContentHash,
  ): Promise<{ tool?: InternalTool; identity?: ToolIdentity }> {
    const manifest = await getManifest(revision)
    if (!manifest) return {}
    return materializeTool(manifest, revision)
  }

  function materializeTool(
    manifest: ToolManifest,
    revision: ContentHash,
  ): { tool?: InternalTool; identity?: ToolIdentity } {
    const identity = manifestIdentity(manifest, revision)
    const runtimeTool = runtimeTools.get(revision)
    if (runtimeTool) return { tool: runtimeTool, identity }
    const tool = {
      name: manifest.name,
      description: manifest.description,
      ...(manifest.longDescription ? { longDescription: manifest.longDescription } : {}),
      parameters: manifest.parameters,
      ...(manifest.renderOptions ? { renderOptions: manifest.renderOptions } : {}),
      ...(manifest.execution.kind === 'sandboxed-code' &&
      manifest.execution.runtime === 'javascript'
        ? { code: manifest.execution.source }
        : {}),
    }
    const parsed = ToolBase.safeParse(tool)
    return parsed.success ? { tool: parsed.data, identity } : {}
  }

  const resolveTool = async (name: string, revision?: ContentHash) => {
    const resolvedRevision = revision ?? (await resolveActiveRevision(name))
    if (!resolvedRevision) return {}
    const resolved = await getToolByRevision(resolvedRevision)
    return resolved.identity?.name === name ? resolved : {}
  }

  const loadStableToolCatalog = async (): Promise<Record<string, InternalTool>> => {
    const revisionAtStart = catalogRevision
    const records = await listStoredRecords()
    const manifests = new Map<string, ToolManifest>()
    const activeRevisions: { name: string; revision: ContentHash }[] = []

    for (const row of records) {
      const id = String(row.id)
      if (id.startsWith(DEFINITION_PREFIX) && row.data.type === 'manifest') {
        manifests.set(id, row.data.manifest)
      } else if (id.startsWith(ACTIVE_PREFIX) && row.data.type === 'active-revision') {
        const revision = ContentHashSchema.safeParse(row.data.revision)
        if (revision.success) {
          activeRevisions.push({ name: id.slice(ACTIVE_PREFIX.length), revision: revision.data })
        }
      }
    }

    const entries = await Promise.all(
      activeRevisions.map(async ({ name, revision }) => {
        const manifest = manifests.get(definitionKey(revision))
        if (!manifest || (await toolRevisionHash(manifest)) !== revision) return null
        const { tool } = materializeTool(manifest, revision)
        return tool?.name === name ? ([name, tool] as const) : null
      }),
    )
    const tools = Object.fromEntries(
      entries.filter((entry): entry is readonly [string, InternalTool] => entry !== null),
    )
    return revisionAtStart === catalogRevision ? tools : await loadStableToolCatalog()
  }

  const listTools = () => {
    if (catalogRead) return catalogRead
    catalogRead = loadStableToolCatalog()
    void catalogRead.then(
      () => {
        catalogRead = null
      },
      () => {
        catalogRead = null
      },
    )
    return catalogRead
  }

  async function listToolDefinitions<T extends boolean>(
    removeFunctionProperty: T = false as T,
  ): Promise<T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>> {
    return Object.values(await listTools()).reduce(
      (definitions, tool) => {
        if (removeFunctionProperty && 'function' in tool) {
          const toolBase = ToolBase.parse(tool)
          definitions[toolBase.name] = toolBase
        } else {
          definitions[tool.name] = tool
        }
        return definitions
      },
      {} as T extends true ? Record<string, ToolBase> : Record<string, ToolBase | InternalTool>,
    )
  }

  return {
    activateTool: async (name: string, revision: ContentHash): Promise<void> => {
      const manifest = await getManifest(revision)
      if (!manifest || manifest.name !== name) {
        throw new Error(`Unknown revision for tool ${name}: ${revision}`)
      }
      await storage.set(activeKey(name), { type: 'active-revision', revision })
      catalogRevision += 1
    },
    addDefaultTools,
    getManifest,
    installManifest,
    installTool,
    listTools,
    resolveTool,
    resolveActiveRevision,
    listToolDefinitions,
  }
}

export type ToolManager = ReturnType<typeof createToolManager>
