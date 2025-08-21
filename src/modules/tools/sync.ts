import { useGdrive } from '../gdrive'
import z from 'zod'
import { createDuplexChannel, createPortApi } from '../frpBus'

export const BaseMessage = z.object({ origin: z.string().optional() })

export const EncryptedTasks = z.object({
  type: z.literal('addTasks'),
  data: z.instanceof(Uint8Array),
  info: z.string(),
  ids: z.array(z.string()),
})
//type TaskMessage = z.infer<typeof EncryptedTasks>

export const RequestTask = z.object({
  type: z.literal('requestTask'),
  id: z.string(),
})
//type RequestTask = z.infer<typeof RequestTask>

const SyncApi = z.discriminatedUnion('type', [EncryptedTasks, RequestTask])
type SyncApi = z.infer<typeof SyncApi>

// TODO: generalize this to all kinds of cloud storages / peers
// TODO: add some kind of way how to identify gdrive and other things as "clients" in the system
export const GdriveSyncPort = () => {
  const {
    x: insideGdrive, // used to receive messages and send messages away from drive
    // this port is needed for monitoring gdrive and if we find new tasks, we'll send it back to taskyon.
    y: outsideGdrive, // used to send & receive messages from gdrive itself...
  } = createDuplexChannel<SyncApi, SyncApi>()
  const { uploadFileArchiveWMeta, downloadArchiveFile } = useGdrive()
  const directory = 'taskyon/tsync'
  createPortApi(
    insideGdrive,
    SyncApi,
    {
      addTasks: async ({ data, info, ids }) => {
        const msgpackFile = new File([data], info, {
          type: 'application/octet-stream',
        })
        const created = await uploadFileArchiveWMeta(directory, msgpackFile, ids, /*share*/ false)
        console.log('created file on gdrive:', created.webViewLink)
      },
      requestTask: async ({ id }) => {
        const file = await downloadArchiveFile(directory, id)
        if (file) {
          const buffer = await file.arrayBuffer()
          const data = new Uint8Array(buffer)
          outsideGdrive.send({ type: 'addTasks', data, ids: [id], info: file.name })
        }
      },
    },
    console.warn,
    console.error,
  )
  // return the "outside" Port to Gdrive to connect to taskyon!
  return outsideGdrive
}
