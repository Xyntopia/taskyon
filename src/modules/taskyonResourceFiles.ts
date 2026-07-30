import {
  loadHttpResourceFiles,
  type ResourceFilesLoader,
} from '@taskyon/common/modules/resourceFiles'
import type { TaskyonApiDescription } from '@taskyon/taskyon/api'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import { createStorageResourceFilesLoader } from './storageResources'
import { loadTaskyonAuthoredResourceFiles } from './taskyonDocumentation'

export const createTaskyonResourceFilesLoader = (
  describeApi: () => Promise<TaskyonApiDescription>,
  storageClient: TaskyonStorageClient,
): ResourceFilesLoader => {
  const loadStorageResourceFiles = createStorageResourceFilesLoader(storageClient)
  return async function* (source) {
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
    if (source === '/resources/storage' || source.startsWith('/resources/storage?')) {
      yield* loadStorageResourceFiles(source)
      return
    }

    throw new Error(`Taskyon resource source not found: ${source}`)
  }
}
