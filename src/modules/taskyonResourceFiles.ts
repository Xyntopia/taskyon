import {
  loadHttpResourceFiles,
  type ResourceFilesLoader,
} from '@taskyon/common/modules/resourceFiles'
import type { TaskyonApiDescription } from '@taskyon/taskyon/api'
import { loadOpfsResourceFiles } from './opfsResources'
import { loadTaskyonAuthoredResourceFiles } from './taskyonDocumentation'

export const createTaskyonResourceFilesLoader = (
  describeApi: () => Promise<TaskyonApiDescription>,
): ResourceFilesLoader =>
  async function* (source) {
    if (/^https?:\/\//.test(source)) {
      yield* loadHttpResourceFiles(source)
      return
    }
    if (source === '/resources/peers/local/api') {
      const description = await describeApi()
      yield {
        url: source,
        file: new File([JSON.stringify(description.document)], 'taskyon.openapi.json', {
          type: 'application/vnd.oai.openapi+json',
        }),
      }
      return
    }
    if (source.startsWith('/docs/')) {
      yield* loadTaskyonAuthoredResourceFiles(source)
      return
    }
    if (source === '/resources/opfs' || source.startsWith('/resources/opfs/')) {
      yield* loadOpfsResourceFiles(source)
      return
    }

    throw new Error(`Taskyon resource source not found: ${source}`)
  }
