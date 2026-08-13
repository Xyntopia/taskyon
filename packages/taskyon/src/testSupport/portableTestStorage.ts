import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createMemoryStorageRecordBackend,
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageRecordBackend,
} from '../api/storageProtocol'
import { connectTaskManagerStorageFromProtocol } from '../core/taskManager'

export const createPortableTestStorage = () => {
  const namespacePrefix = 'taskyon-test'
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const backends = new Map<string, StorageRecordBackend>()
  const destroy = createStorageProtocolServer(
    servicePort,
    {
      records: (namespace) => {
        const backend = backends.get(namespace) ?? createMemoryStorageRecordBackend()
        backends.set(namespace, backend)
        return backend
      },
    },
    { mode: 'trusted-local' },
  )
  const storage = createStorageClient(clientPort, {
    namespacePrefix,
    distribution: 'local-only',
  })

  return {
    taskManagerStorageFactory: ({ sessionId }: { sessionId: string }) =>
      connectTaskManagerStorageFromProtocol(storage, sessionId),
    destroy,
  }
}
