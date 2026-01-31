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

export async function openTlsConnection(
  tunnelUrl: string,
  targetHost: string,
  targetPort: number = 443
): Promise<TlsConnection> {
  const ws = new WebSocket(tunnelUrl);
  ws.binaryType = 'arraybuffer';

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (err) => reject(err);
  });

  ws.send(`CONNECT ${targetHost}:${targetPort}`);

  await new Promise<void>((resolve, reject) => {
    const handleMsg = (event: MessageEvent) => {
      const msg = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      if (msg === 'CONNECTED') {
        ws.removeEventListener('message', handleMsg);
        resolve();
      } else if (msg.startsWith('ERROR')) {
        reject(new Error(`Tunnel Error: ${msg}`));
      }
    };
    ws.addEventListener('message', handleMsg);
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
