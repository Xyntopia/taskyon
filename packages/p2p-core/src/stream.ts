import type { Stream } from '@libp2p/interface'
import type { Duplex, Source } from 'it-stream-types'
import type { Uint8ArrayList } from 'uint8arraylist'

type StreamChunk = Uint8Array | Uint8ArrayList

export type Libp2pStreamDuplex = Duplex<
  AsyncIterable<StreamChunk>,
  Source<StreamChunk>,
  Promise<void>
>

export function streamToDuplex(stream: Stream): Libp2pStreamDuplex {
  return {
    source: stream,
    sink: async (source) => {
      for await (const chunk of source) {
        while (!stream.send(chunk)) {
          await stream.onDrain()
        }
      }
      await stream.close()
    },
  }
}
