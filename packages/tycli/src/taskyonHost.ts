import { fileURLToPath } from 'node:url'
import { taskyonDocumentationManifest } from '@taskyon/taskyon/documentationManifest'
import { taskyonDocumentationTool } from '@taskyon/taskyon/tools/documentationTool'
import {
  buildDeveloperCliStableContext,
  DEFAULT_CLI_UNAVAILABLE_TOOL_NAMES,
  type InteractiveCliHost,
} from './cli'
import { resolveTaskyonCliStoragePaths } from './cli/storagePaths'

export function createTaskyonInteractiveCliHost(): InteractiveCliHost {
  return {
    commandName: 'tycli',
    productName: 'Taskyon',
    environmentPrefix: 'TYCLI',
    entryNodeName: 'entryNode',
    oauthSecretId: 'taskyon-cli:oauth',
    providerIdentity: {
      referer: 'https://tycli.local',
      title: 'tycli',
    },
    storagePaths: resolveTaskyonCliStoragePaths(),
    versionFileUrl: new URL('../package.json', import.meta.url),
    buildStableContext: (projectInstructions) =>
      buildDeveloperCliStableContext('You are the Taskyon CLI assistant.', projectInstructions),
    unavailableToolNames: DEFAULT_CLI_UNAVAILABLE_TOOL_NAMES,
    documentation: {
      baseId: 'taskyon',
      manifest: taskyonDocumentationManifest,
      docsRoot: fileURLToPath(new URL('../../../public/docs', import.meta.url)),
      apiSource: '/resources/peers/local/api',
      tool: taskyonDocumentationTool,
    },
  }
}
