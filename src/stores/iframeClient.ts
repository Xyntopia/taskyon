//iFrameClient.ts

import { createDuplexChannel, MessageChannelBridge } from '@taskyon/taskyon'
import type { TaskyonGuiMessage } from 'src/modules/taskyon/apiTypes'

export async function waitForMessagePort(
  filter: (ev: MessageEvent) => boolean,
): Promise<MessagePort> {
  return new Promise<MessagePort>((resolve) => {
    const handler = (ev: MessageEvent) => {
      console.log('got message from', ev)
      if (!ev.ports?.[0] || !filter(ev)) return
      console.log('Got MessagePort from', ev.origin)
      const nativePort = ev.ports[0]
      nativePort.start()
      window.removeEventListener('message', handler)
      resolve(nativePort)
    }

    window.addEventListener('message', handler)
  })
}

export async function waitForIframeDuplexChannel() {
  const searchParams = new URLSearchParams(window.location.search)
  const isVscodeParam = searchParams.get('vscode') === 'true' || searchParams.get('vscode') === '1'
  const mport = await waitForMessagePort((ev) => {
    // Check if the message is from the parent window
    return (
      ev.data?.type === 'initPort' && (ev.source === window.parent || (!ev.source && isVscodeParam))
    )
    // Optionally, check the origin if you know what it should be
    // For example, if you expect messages only from 'https://example.com'
    /*if (event.origin === 'https://example.com') {
              console.log('Request from parent:', event.data);
            } else {
              console.error('Message from unknown origin:', event.origin);
            }*/
    //console.log('Message from unknown origin:', event.origin, event)
  })
  // create a channel from the mport:
  const { x, y } = createDuplexChannel<TaskyonGuiMessage, unknown>()
  // connect the MessageChannel to our UI API
  MessageChannelBridge(x, mport)
  return y
}
