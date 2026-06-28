import { createClientTool, toolCall } from '@taskyon/tyclient'
import { invoke, isTauri } from '@tauri-apps/api/core'
import type { JSONSchema7 } from 'json-schema'
import { serializeObject } from '@taskyon/shared/modules/serializeObject'
import {
  applyFileUpdateToContent,
  normalizeFileUpdate,
  type FileUpdate,
} from '@taskyon/taskyon/tools/filePatching'

const SUPPORTED_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'])
const SEARCH_SAFE_REGEX_FLAGS = new Set(['i', 'm', 's', 'u', 'v'])

type WorkspaceReadResult = {
  path: string
  content?: string
  error?: string
}

type BashCommandResult = {
  success: boolean
  status: number
  stdout: string
  stderr: string
}

const ensureTauri = () => {
  if (!isTauri()) {
    throw new Error('This tool is only available in Tauri mode.')
  }
}

const compileSearchPattern = (query: string): RegExp => {
  let source = query
  const flags = new Set<string>()

  while (source.startsWith('(?')) {
    const inlineFlagMatch = source.match(/^\(\?([A-Za-z]+)\)/)
    if (!inlineFlagMatch) break

    for (const flag of inlineFlagMatch[1] || '') {
      if (!SUPPORTED_REGEX_FLAGS.has(flag)) {
        throw new Error(`Unsupported inline regex flag "${flag}".`)
      }
      if (SEARCH_SAFE_REGEX_FLAGS.has(flag)) {
        flags.add(flag)
      }
    }

    source = source.slice(inlineFlagMatch[0].length)
  }

  return new RegExp(source, Array.from(flags).join(''))
}

const callListFiles = async (maxEntries = 5000): Promise<string[]> =>
  await invoke('tauri_workspace_list_files', { maxEntries })

const callReadFiles = async (paths: string[]): Promise<WorkspaceReadResult[]> =>
  await invoke('tauri_workspace_read_files', { paths })

const callWriteFile = async (path: string, content: string): Promise<string> =>
  await invoke('tauri_workspace_write_file', { args: { path, content } })

const callRunBashCommand = async (command: string): Promise<BashCommandResult> =>
  await invoke('tauri_run_bash_command', { command })

const formatCommandApprovalMessage = (command: string, approvalToken: string) => `<div>
<p>Command approval required:</p>
<pre><code class="language-bash">${command.replace(/[<>&]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char] || char)}</code></pre>
<div style="display:flex;gap:8px;">
  <button id="taskyon-bash-yes">Yes</button>
  <button id="taskyon-bash-no">No</button>
</div>
<script>
  const send = (decision) => {
    window.parent.postMessage({ tool: 'tauriBashTool', token: '${approvalToken}', decision }, '*')
  }
  document.getElementById('taskyon-bash-yes')?.addEventListener('click', () => send('yes'))
  document.getElementById('taskyon-bash-no')?.addEventListener('click', () => send('no'))
</script>
</div>`

const waitForBashDecision = async (
  messagePort: MessagePort | undefined,
  approvalToken: string,
): Promise<'yes' | 'no'> => {
  if (!messagePort) {
    throw new Error('No message port is available for command approval.')
  }

  return await new Promise<'yes' | 'no'>((resolve) => {
    messagePort.onmessage = (event) => {
      const payload = event.data?.payload ?? event.data
      if (!payload || payload.tool !== 'tauriBashTool' || payload.token !== approvalToken) return
      if (payload.decision === 'yes' || payload.decision === 'no') {
        resolve(payload.decision)
      }
    }
  })
}

const tauriExplorationTool = createClientTool({
  name: 'tauriExploreWorkspace',
  description: 'Explore local workspace files in Tauri mode: list, read, and regex-search.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'read', 'searchPath', 'searchContent'],
      },
      paths: { type: 'array', items: { type: 'string' } },
      query: { type: 'string' },
      maxResults: { type: 'number', default: 50 },
      searchLimit: { type: 'number', default: 5000 },
    },
    required: ['action'],
  } as const satisfies JSONSchema7,
  function: async ({ action, paths = [], query = '', maxResults = 50, searchLimit = 5000 }) => {
    ensureTauri()

    if (action === 'list') {
      const files = await callListFiles(searchLimit)
      return { files: files.slice(0, maxResults), total: files.length }
    }

    if (action === 'read') {
      return { files: await callReadFiles(paths) }
    }

    const files = await callListFiles(searchLimit)
    const pattern = compileSearchPattern(query)

    if (action === 'searchPath') {
      return {
        files: files.filter((path) => pattern.test(path)).slice(0, maxResults),
      }
    }

    const reads = await callReadFiles(files)
    return {
      files: reads
        .filter((entry) => typeof entry.content === 'string' && pattern.test(entry.content))
        .map((entry) => entry.path)
        .slice(0, maxResults),
    }
  },
})

const tauriPatchTool = createClientTool({
  name: 'tauriPatchWorkspace',
  description: 'Apply context/regex/new-content file updates in local Tauri workspace files.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            filePath: { type: 'string' },
            newContent: { type: 'string' },
            patches: { type: 'array', items: { type: 'object' } },
            regexReplacements: { type: 'array', items: { type: 'object' } },
          },
          required: ['filePath'],
        },
      },
    },
    required: ['updates'],
  } as const satisfies JSONSchema7,
  function: async ({ updates }) => {
    ensureTauri()

    const normalizedUpdates = (updates as FileUpdate[]).map(normalizeFileUpdate)
    const readResults = await callReadFiles(normalizedUpdates.map((update) => update.filePath))
    const readMap = new Map(readResults.map((entry) => [entry.path, entry]))
    const changedFiles: string[] = []

    for (const update of normalizedUpdates) {
      const existing = readMap.get(update.filePath)
      const baseContent = existing?.content || ''
      const nextContent = applyFileUpdateToContent(baseContent, update)
      await callWriteFile(update.filePath, nextContent)
      changedFiles.push(update.filePath)
    }

    return { ok: true, files: changedFiles }
  },
})

const tauriBashTool = createClientTool({
  name: 'tauriBashTool',
  description: 'Run a local bash command in Tauri mode after explicit yes/no user approval.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: { type: 'string' },
      approvalToken: { type: 'string' },
    },
    required: ['command'],
  } as const satisfies JSONSchema7,
  function: async ({ command, approvalToken }, ctx) => {
    ensureTauri()

    const taskChain = await ctx.getExecutionTaskChain()
    const previousCall = taskChain.at(-3)
    const thisMessage = taskChain.at(-1)
    const hasApprovalToken = typeof approvalToken === 'string' && approvalToken.length > 0
    const isApprovalStep =
      hasApprovalToken &&
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'tauriBashTool' &&
      previousCall.content.data.arguments.command === command &&
      thisMessage?.parentID === previousCall.id

    if (!isApprovalStep) {
      const nextToken = approvalToken || `tauri-bash-${Date.now().toString(36)}`
      return ctx.createSubtasksResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: formatCommandApprovalMessage(command, nextToken),
            },
          },
          toolCall({
            name: 'tauriBashTool',
            arguments: { command, approvalToken: nextToken },
          }),
        ],
      ])
    }

    const decision = await waitForBashDecision(ctx.messagePort, approvalToken || '')
    if (decision === 'no') {
      return {
        cancelled: true,
        message: 'Command execution cancelled by user.',
      }
    }

    const commandResult = await callRunBashCommand(command)
    const summary = serializeObject(commandResult, {
      maxStringLength: 4000,
      maxArrayLength: 50,
      maxObjectKeys: 20,
    })

    return {
      result: summary,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      status: commandResult.status,
      success: commandResult.success,
    }
  },
})

export const tauriLocalTools = [tauriExplorationTool, tauriPatchTool, tauriBashTool]
