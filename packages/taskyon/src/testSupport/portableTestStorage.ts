import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { taskyonStorageProtocol } from '../api/storageProtocol'
import {
  connectTaskManagerStorageFromProtocol,
  createPgLiteTaskManagerStorageService,
} from '../core/taskManager'
import { getDatabase } from '../utils/pglite.api'

export const createPortableTestStorage = () => {
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const destroy = createPgLiteTaskManagerStorageService(servicePort, getDatabase)

  return {
    taskManagerStorageFactory: ({ sessionId }: { sessionId: string }) =>
      connectTaskManagerStorageFromProtocol(clientPort, sessionId),
    destroy,
  }
}
