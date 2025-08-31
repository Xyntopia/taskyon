interface PeerNetwork {
  // bootstrap into the underlying network
  start(): Promise<void>
  stop(): Promise<void>

  // join a subnetwork (secret = password/psk/etc.)
  joinSubnet(secret: Uint8Array): Promise<Subnet>

  // optionally expose self info
  getPeerId(): string
}

interface Subnet {
  // send a message to all peers in the subnet
  publish(msg: Uint8Array): Promise<void>

  // subscribe to incoming messages
  onMessage(cb: (from: string, msg: Uint8Array) => void): void

  // optional peer discovery
  getPeers(): string[]
}
