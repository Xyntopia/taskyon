import {
  createProtocolPort,
  defineFrpProtocol,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { MessageChannelBridge } from '@taskyon/common/modules/frpBusWeb'
import { z } from 'zod'

const DESIGN_RENDERER_CONNECT = 'taskyon.design-renderer.connect.v1'

export const designRendererProtocol = defineFrpProtocol({
  id: 'taskyon.design-renderer',
  version: '1',
  streams: {
    results: {
      designResult: z.object({ value: z.unknown() }),
    },
  },
})

type DesignRendererMessage = ProtocolMessage<typeof designRendererProtocol>

export type DesignRendererHostConnection = {
  sendResult: (value: unknown) => void
  destroy: () => void
}

export const connectDesignRendererFrame = (
  frame: HTMLIFrameElement,
): DesignRendererHostConnection => {
  const contentWindow = frame.contentWindow
  if (!contentWindow) throw new Error('Design renderer iframe has no content window.')

  const protocolPort = createProtocolPort(designRendererProtocol)
  const channel = new MessageChannel()
  const bridge = MessageChannelBridge(protocolPort.y, channel.port1)
  contentWindow.postMessage({ type: DESIGN_RENDERER_CONNECT }, '*', [channel.port2])

  return {
    sendResult: (value) => {
      const message: DesignRendererMessage = { type: 'designResult', value }
      protocolPort.x.send(message)
    },
    destroy: () => bridge.destroy(),
  }
}

export const designRendererBootstrapSource = `(() => {
  const listeners = new Set()
  let hasResult = false
  let latestResult

  globalThis.connectDesignRenderer = listener => {
    if (typeof listener !== 'function') {
      throw new TypeError('connectDesignRenderer requires a function.')
    }
    listeners.add(listener)
    if (hasResult) listener(latestResult)
    return () => listeners.delete(listener)
  }

  const connect = event => {
    if (
      event.source !== parent ||
      event.data?.type !== '${DESIGN_RENDERER_CONNECT}' ||
      event.ports.length !== 1
    ) return

    window.removeEventListener('message', connect)
    const port = event.ports[0]
    port.onmessage = ({ data }) => {
      if (data?.type !== 'designResult') return
      latestResult = data.value
      hasResult = true
      listeners.forEach(listener => listener(latestResult))
    }
    port.start()
  }

  window.addEventListener('message', connect)
})()`
