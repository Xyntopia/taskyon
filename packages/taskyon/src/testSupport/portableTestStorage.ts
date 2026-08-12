import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createStorageClient, taskyonStorageProtocol } from '../api/storageProtocol'
import {
  connectTaskManagerStorageFromProtocol,
  createPgLiteTaskManagerStorageService,
} from '../core/taskManager'
import { getDatabase } from '../utils/pglite.api'

export const createPortableTestStorage = () => {
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const destroy = createPgLiteTaskManagerStorageService(servicePort, getDatabase)
  const storage = createStorageClient(clientPort, {
    namespacePrefix: 'taskyon-test',
    distribution: 'local-only',
  })

  return {
    taskManagerStorageFactory: ({ sessionId }: { sessionId: string }) =>
      connectTaskManagerStorageFromProtocol(storage, sessionId),
    destroy,
  }
}
