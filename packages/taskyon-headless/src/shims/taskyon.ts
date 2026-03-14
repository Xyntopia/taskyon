export const WsProxyCloseCode = {
  MissingSecWebSocketProtocol: 4000,
  MissingBearerToken: 4001,
  InvalidSubprotocol: 4002,
  AuthFailed: 4003,
  MissingHost: 4100,
  InvalidPort: 4101,
  ServiceNotAllowed: 4200,
  PortNotAllowed: 4201,
  InvalidHostFormat: 4300,
  PrivateIpForbidden: 4301,
  DnsResolutionFailed: 4302,
  TcpConnectionFailed: 4500,
  InternalError: 4800,
} as const

export class WsProxyCloseError extends Error {
  readonly code: number
  readonly reason: string

  constructor(code: number, reason: string) {
    super(`WebSocket tunnel closed: code=${code} reason=${reason || 'no reason provided'}`)
    this.name = 'WsProxyCloseError'
    this.code = code
    this.reason = reason
  }

  isKnownProxyCode(): boolean {
    return Object.values(WsProxyCloseCode).includes(this.code as (typeof WsProxyCloseCode)[keyof typeof WsProxyCloseCode])
  }
}
