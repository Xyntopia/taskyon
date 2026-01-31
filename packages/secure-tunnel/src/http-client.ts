export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export function buildHttpRequest(
  method: string,
  urlStr: string,
  headers: Record<string, string>,
  body?: Uint8Array | string
): Uint8Array {
  const url = new URL(urlStr);
  const path = url.pathname + url.search;
  const host = url.hostname;
  const port = url.port || '443';

  const finalHeaders: Record<string, string> = {};
  Object.keys(headers).forEach(k => {
    finalHeaders[k.toLowerCase()] = headers[k];
  });

  if (!finalHeaders['host']) {
    finalHeaders['host'] = `${host}:${port}`;
  }
  
  if (!finalHeaders['user-agent']) {
    finalHeaders['user-agent'] = 'secure-tunnel/1.0';
  }

  let bodyBytes: Uint8Array | undefined;
  if (body) {
    if (typeof body === 'string') {
      bodyBytes = new TextEncoder().encode(body);
    } else {
      bodyBytes = body;
    }
    finalHeaders['content-length'] = bodyBytes.length.toString();
  } else if (method === 'POST' || method === 'PUT') {
    if (!finalHeaders['content-length']) {
      finalHeaders['content-length'] = '0';
    }
  }

  let req = `${method.toUpperCase()} ${path} HTTP/1.1\r\n`;
  for (const [k, v] of Object.entries(finalHeaders)) {
    req += `${k}: ${v}\r\n`;
  }
  req += '\r\n';

  const headBytes = new TextEncoder().encode(req);
  
  if (bodyBytes) {
    const combined = new Uint8Array(headBytes.length + bodyBytes.length);
    combined.set(headBytes);
    combined.set(bodyBytes, headBytes.length);
    return combined;
  }
  
  return headBytes;
}

export async function parseHttpResponse(reader: () => Promise<Uint8Array | null>): Promise<HttpResponse> {
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);
  
  async function readUntilHeaders(): Promise<string> {
    let str = '';
    while (true) {
      str = decoder.decode(buffer, { stream: true });
      const headerEnd = str.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        return str;
      }
      
      const chunk = await reader();
      if (!chunk) break;
      
      const newBuf = new Uint8Array(buffer.length + chunk.length);
      newBuf.set(buffer);
      newBuf.set(chunk, buffer.length);
      buffer = newBuf;
    }
    return str;
  }

  const fullDataStr = await readUntilHeaders();
  const headerEndIdx = fullDataStr.indexOf('\r\n\r\n');
  
  if (headerEndIdx === -1) {
    throw new Error('Incomplete response headers');
  }

  const headerPart = fullDataStr.substring(0, headerEndIdx);
  
  let headerByteSize = 0;
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 13 && buffer[i+1] === 10 && buffer[i+2] === 13 && buffer[i+3] === 10) {
      headerByteSize = i + 4;
      break;
    }
  }

  const lines = headerPart.split('\r\n');
  const statusLine = lines[0];
  const [_, statusCode, ...statusTextParts] = statusLine.split(' ');
  const status = parseInt(statusCode, 10);
  const statusText = statusTextParts.join(' ');
  
  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colon = line.indexOf(':');
    if (colon !== -1) {
      const k = line.substring(0, colon).trim().toLowerCase();
      const v = line.substring(colon + 1).trim();
      headers[k] = v;
    }
  }

  let bodyBytes = buffer.slice(headerByteSize);
  
  if (headers['content-length']) {
    const len = parseInt(headers['content-length'], 10);
    while (bodyBytes.length < len) {
      const chunk = await reader();
      if (!chunk) break;
      const newBuf = new Uint8Array(bodyBytes.length + chunk.length);
      newBuf.set(bodyBytes);
      newBuf.set(chunk, bodyBytes.length);
      bodyBytes = newBuf;
    }
    bodyBytes = bodyBytes.slice(0, len);
  } else if (headers['transfer-encoding'] === 'chunked') {
    let decodedChunks: Uint8Array[] = [];
    let currentBuffer = bodyBytes;
    
    while (true) {
      let newlineIdx = -1;
      for (let i = 0; i < currentBuffer.length - 1; i++) {
        if (currentBuffer[i] === 13 && currentBuffer[i+1] === 10) {
          newlineIdx = i;
          break;
        }
      }
      
      if (newlineIdx === -1) {
        const chunk = await reader();
        if (!chunk) break;
        const newBuf = new Uint8Array(currentBuffer.length + chunk.length);
        newBuf.set(currentBuffer);
        newBuf.set(chunk, currentBuffer.length);
        currentBuffer = newBuf;
        continue;
      }
      
      const hexLine = new TextDecoder().decode(currentBuffer.slice(0, newlineIdx));
      const chunkSize = parseInt(hexLine, 16);
      
      if (chunkSize === 0) {
        break;
      }
      
      const dataStart = newlineIdx + 2;
      const dataEnd = dataStart + chunkSize;
      const totalNeeded = dataEnd + 2;
      
      while (currentBuffer.length < totalNeeded) {
        const chunk = await reader();
        if (!chunk) throw new Error("Unexpected EOF in chunked body");
        const newBuf = new Uint8Array(currentBuffer.length + chunk.length);
        newBuf.set(currentBuffer);
        newBuf.set(chunk, currentBuffer.length);
        currentBuffer = newBuf;
      }
      
      decodedChunks.push(currentBuffer.slice(dataStart, dataEnd));
      currentBuffer = currentBuffer.slice(totalNeeded);
    }
    
    let totalLen = decodedChunks.reduce((acc, c) => acc + c.length, 0);
    let result = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of decodedChunks) {
      result.set(c, offset);
      offset += c.length;
    }
    bodyBytes = result;
    
  } else {
    while (true) {
      const chunk = await reader();
      if (!chunk) break;
      const newBuf = new Uint8Array(bodyBytes.length + chunk.length);
      newBuf.set(bodyBytes);
      newBuf.set(chunk, bodyBytes.length);
      bodyBytes = newBuf;
    }
  }

  return {
    status,
    statusText,
    headers,
    body: bodyBytes
  };
}
