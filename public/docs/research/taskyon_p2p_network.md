### Abstract Requirements for the P2P Network

1. **Subnetwork Membership**
   - Subnetworks are defined by a shared secret/password.
   - Only peers with the secret can join/communicate.
   - Peers can join **multiple subnetworks** simultaneously.
   - Joining requires a **proof of legitimacy** to prevent spam or fake requests.

2. **Peer Discovery**
   - Peers must be able to discover others in the same subnetwork.
   - Discovery should work without centralized servers (but allow optional bootstrap helpers).
   - Metadata leakage (e.g., observable who is in which subnet) should be minimized.

3. **Messaging**
   - Within a subnetwork, peers need broadcast (pub/sub) and optionally direct messaging.
   - All messages must be authenticated/encrypted with keys derived from the shared secret.

4. **Connectivity & Resilience**
   - The network should handle peers joining/leaving frequently.
   - Messages and peer lists should propagate efficiently without overwhelming the network.

5. **Scalability**
   - Support small subnetworks (a few peers) and larger groups (hundreds+).
   - Messaging should avoid naïve full-mesh flooding.

6. **Privacy & Security**
   - Subnetwork secrets should not be exposed via discovery mechanisms.
   - Replay protection and forward secrecy are desirable.

7. **Extensibility**
   - Higher-level protocols (file sharing, state sync, etc.) can be built on top.
   - The network layer should remain **transport-agnostic**, able to swap underlying implementations.
