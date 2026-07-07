// sync.ts
import {
  createDuplexChannel,
  createPortClient,
  createPortServer,
  taskyonProtocol,
} from '@taskyon/taskyon'
import type { TyP2P } from '@taskyon/taskyon'
import { useGdrive } from '../gdrive'

// TODO: generalize this to all kinds of cloud storages / peers
// TODO: add some kind of way how to identify gdrive and other things as "clients" in the system
export const gDriveSyncPort = (
  directory: string,
  tokenGetter: () => Promise<string>,
  errorCatcher: (error: unknown) => void,
) => {
  const {
    x: insideGdrive, // used to receive messages and send messages away from drive
    // this port is needed for monitoring gdrive and if we find new tasks, we'll send it back to taskyon.
    y: outsideGdrive, // used to send & receive messages from gdrive itself...
  } = createDuplexChannel<TyP2P, TyP2P>()
  const { uploadFileArchiveWMeta, downloadArchiveFile } = useGdrive(tokenGetter)
  const gdriveApi = createPortClient(insideGdrive, taskyonProtocol)
  createPortServer(
    insideGdrive,
    taskyonProtocol,
    {
      archive: {
        importTask: async ({ data, info, ids }) => {
          const msgpackFile = new File([data], info, {
            type: 'application/octet-stream',
          })
          const created = await uploadFileArchiveWMeta(directory, msgpackFile, ids, /*share*/ false)
          insideGdrive.send({ type: 'taskCreated', ids, info: created.name })
          console.log('created file on gdrive:', created.webViewLink)
        },
        requestTask: async ({ id }) => {
          console.log('task requested with id:', id)
          const file = await downloadArchiveFile(directory, id)
          if (file) {
            const buffer = await file.arrayBuffer()
            const data = new Uint8Array(buffer)
            void gdriveApi.archive
              .importTask({
                data,
                ids: [id],
                info: file.name,
              })
              .catch(errorCatcher)
          }
        },
      },
    },
    { onError: errorCatcher },
  )
  // return the "outside" Port to Gdrive to connect to taskyon!
  return outsideGdrive
}
