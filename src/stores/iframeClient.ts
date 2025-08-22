//iFrameClient.ts

import { createDuplexChannel, MessageChannelBridge } from 'src/modules/frpBus'
import type { TaskyonMessage } from 'src/modules/taskyon/apiTypes'

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

export function areWeInIframe() {
  const searchParams = new URLSearchParams(window.location.search)
  const isIframeParam = searchParams.get('iframe') === 'true'
  console.log('we are in an iframe via param:', isIframeParam)
  const isInIframe = window.self !== window.top || isIframeParam
  console.log('we are in an iframe:', window.self !== window.top, isInIframe)
  return isInIframe
}

export async function waitForIframeDuplexChannel() {
  const mport = await waitForMessagePort((ev) => {
    // Check if the message is from the parent window
    return ev.source === window.parent && ev.data?.type === 'initPort'
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
  const iframeChannel = createDuplexChannel<TaskyonMessage, unknown>()
  // connect the MessageChannel to our UI API
  MessageChannelBridge(iframeChannel.x, mport)
  return iframeChannel
}
