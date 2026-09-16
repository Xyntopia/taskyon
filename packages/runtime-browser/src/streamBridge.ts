import type { StreamSubscription } from '@taskyon/common/modules/frpBus'

export const forwardStreamToMessagePort = <T>(
  stream: StreamSubscription<T>,
  messagePort: MessagePort,
) => stream((event) => messagePort.postMessage(event))
