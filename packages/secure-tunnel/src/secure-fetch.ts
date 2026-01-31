import { openTlsConnection } from './tls-websocket';
import { buildHttpRequest, parseHttpResponse } from './http-client';

export interface SecureFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  tunnelUrl?: string;
}

export interface SecureFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

export async function secureFetch(
  urlStr: string,
  options: SecureFetchOptions = {}
): Promise<SecureFetchResponse> {
  const method = options.method || 'GET';
  const headers = options.headers || {};
  const tunnelUrl = options.tunnelUrl || 
    (typeof window !== 'undefined' 
      ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host + '/tunnel'
      : 'ws://localhost:5000/tunnel');

  const url = new URL(urlStr);
  const host = url.hostname;
  const port = parseInt(url.port || '443', 10);

  if (url.protocol !== 'https:') {
    throw new Error('secureFetch only supports https:// URLs');
  }

  const tls = await openTlsConnection(tunnelUrl, host, port);

  try {
    const reqBytes = buildHttpRequest(method, urlStr, headers, options.body);
    await tls.write(reqBytes);
    const res = await parseHttpResponse(tls.read);
    await tls.close();

    const textBody = new TextDecoder().decode(res.body);

    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      body: textBody,
      arrayBuffer: async () => res.body.buffer as ArrayBuffer,
      text: async () => textBody,
      json: async <T>() => JSON.parse(textBody) as T
    };
  } catch (err) {
    await tls.close();
    throw err;
  }
}
