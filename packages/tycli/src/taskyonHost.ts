import { fileURLToPath } from 'node:url'
import { taskyonDocumentationManifest } from '@taskyon/taskyon/documentationManifest'
import { taskyonDocumentationTool } from '@taskyon/taskyon/tools/documentationTool'
import {
  buildDeveloperCliStableContext,
  DEFAULT_CLI_UNAVAILABLE_TOOL_NAMES,
  type InteractiveCliHost,
} from './cli'
import { resolveTaskyonCliStoragePaths } from './cli/storagePaths'
import { CLI_FLOW_TOOL_NAME, cliToolchainProfiles } from './cli/toolchainSettings'

export function createTaskyonInteractiveCliHost(): InteractiveCliHost {
  return {
    commandName: 'tycli',
    productName: 'Taskyon',
    environmentPrefix: 'TYCLI',
    entryNodeName: CLI_FLOW_TOOL_NAME,
    oauthSecretId: 'taskyon-cli:oauth',
    toolchainProfiles: cliToolchainProfiles,
    storagePaths: resolveTaskyonCliStoragePaths(),
    versionFileUrl: new URL('../package.json', import.meta.url),
    buildStableContext: buildDeveloperCliStableContext,
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
