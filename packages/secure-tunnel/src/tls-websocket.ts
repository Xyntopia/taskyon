import { makeTLSClient, type TLSClient, setCryptoImplementation } from '@reclaimprotocol/tls';
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto';

// Set up pure JavaScript crypto implementation for browser compatibility
try {
  setCryptoImplementation(pureJsCrypto);
} catch (e) {
  console.warn('[SecureTunnel] Failed to set crypto implementation:', e);
}

export interface TlsConnection {
  write(data: Uint8Array): Promise<void>;
  read(): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

/**
 * Opens a TLS connection through a WebSocket tunnel.
 * 
 * @param tunnelUrl - Base WebSocket URL (e.g., 'ws://localhost:8443' or 'wss://proxy.example.com')
 * @param targetHost - Target hostname to connect to
 * @param targetPort - Target port (default: 443)
 * @returns TlsConnection interface for reading/writing encrypted data
 * 
 * The tunnel URL will have host and port appended as query parameters:
 * ws://localhost:8443?host=example.com&port=443
 */
export async function openTlsConnection(
  tunnelUrl: string,
  targetHost: string,
  targetPort: number = 443
): Promise<TlsConnection> {
  // Build WebSocket URL with host/port as query parameters
  const wsUrl = new URL(tunnelUrl);
  wsUrl.searchParams.set('host', targetHost);
  wsUrl.searchParams.set('port', targetPort.toString());
  
  const ws = new WebSocket(wsUrl.toString());
  ws.binaryType = 'arraybuffer';

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(new Error('WebSocket connection failed'));
  });

  const readQueue: Uint8Array[] = [];
  let readResolve: ((value: Uint8Array | null) => void) | null = null;
  let isClosed = false;
  let handshakeResolve: (() => void) | null = null;
  let handshakeReject: ((err: Error) => void) | null = null;

  const closeConnection = async () => {
    isClosed = true;
    ws.close();
    if (readResolve) {
      readResolve(null);
      readResolve = null;
    }
    if (handshakeReject) {
      handshakeReject(new Error('Connection closed during handshake'));
      handshakeReject = null;
    }
  };

  const tls = makeTLSClient({
    host: targetHost,
    verifyServerCertificate: false,
    async write({ header, content }) {
      if (ws.readyState === WebSocket.OPEN) {
        const combined = new Uint8Array(header.length + content.length);
        combined.set(header);
        combined.set(content, header.length);
        ws.send(combined);
      }
    },
    onHandshake() {
      if (handshakeResolve) {
        handshakeResolve();
        handshakeResolve = null;
        handshakeReject = null;
      }
    },
    onApplicationData(plaintext: Uint8Array) {
      if (readResolve) {
        readResolve(plaintext);
        readResolve = null;
      } else {
        readQueue.push(plaintext);
      }
    },
    onTlsEnd(error) {
      if (error && handshakeReject) {
        handshakeReject(error);
        handshakeReject = null;
      }
      closeConnection();
    }
  });

  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') return;
    const data = new Uint8Array(event.data);
    tls.handleReceivedBytes(data);
  });

  ws.addEventListener('close', () => closeConnection());
  ws.addEventListener('error', () => closeConnection());

  await tls.startHandshake();
  
  await new Promise<void>((resolve, reject) => {
    handshakeResolve = resolve;
    handshakeReject = reject;
    setTimeout(() => {
      if (handshakeReject) {
        handshakeReject(new Error('TLS handshake timeout'));
        handshakeReject = null;
      }
    }, 10000);
  });

  return {
    write: async (data: Uint8Array) => {
      await tls.write(data);
    },
    read: () => {
      if (readQueue.length > 0) {
        return Promise.resolve(readQueue.shift()!);
      }
      if (isClosed) {
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        readResolve = resolve;
      });
    },
    close: closeConnection
  };
}
