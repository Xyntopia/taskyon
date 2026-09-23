import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createMemoryStorageRecordBackend,
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageBackendProvider,
  type StorageRecordBackend,
} from '../api/storageProtocol'
import { connectTaskManagerStorageFromProtocol } from '../core/taskManager'

export const createPortableTestStorage = (blobs?: StorageBackendProvider['blobs']) => {
  const namespacePrefix = 'taskyon-test'
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const backends = new Map<string, StorageRecordBackend>()
  const destroy = createStorageProtocolServer(
    servicePort,
    {
      ...(blobs ? { blobs } : {}),
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
    storageClient: storage,
    taskManagerStorageFactory: ({ sessionId }: { sessionId: string }) =>
      connectTaskManagerStorageFromProtocol(storage, sessionId),
    destroy,
  }
}
