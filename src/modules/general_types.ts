import { signData, uint8ArrayToBase64UrlSafe, verifySignature } from '@taskyon/taskyon'
import type { Request } from 'express'

// Utility to serialize data for signing
function serializeForSigning(url: string, body?: unknown): Uint8Array<ArrayBuffer> {
  const serialized = body ? JSON.stringify({ url, body }) : JSON.stringify({ url })
  return new TextEncoder().encode(serialized)
}

// Sign a request (URL + optional body)
export async function signRequest(
  privateKey: CryptoKeyPair['privateKey'],
  url: string,
  body?: unknown,
) {
  const serializedData = serializeForSigning(url, body)
  return await signData(serializedData, privateKey)
}

// Verify a request signature (URL + optional body)
export async function verifyRequest(
  signature: Uint8Array<ArrayBuffer>,
  publicKey: CryptoKeyPair['publicKey'],
  url: string,
  body?: unknown,
): Promise<boolean> {
  const serializedData = serializeForSigning(url, body)
  return await verifySignature(signature, serializedData, publicKey)
}

// Create a signed fetch request
export async function createSignedFetchRequest(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  jwtToken: string,
  publicKey: CryptoKeyPair['publicKey'],
  privateKey: CryptoKeyPair['privateKey'],
): Promise<Response> {
  // Sign the URL and body
  const signature = await signRequest(privateKey, url, body)

  // Prepare the headers
  const headers = {
    Authorization: `Bearer ${jwtToken}`,
    'content-type': 'application/json',
    'x-public-key': publicKey,
    'x-signature': uint8ArrayToBase64UrlSafe(signature),
  }

  const init: Record<string, unknown> = {
    method,
    headers,
  }
  if (body) init.body = body

  // Make the fetch request
  return await fetch(url, init)
}

// Verify an Express.js Request
export async function verifyExpressRequest(req: Request): Promise<boolean> {
  const { method, body, headers } = req
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`

  const signature = headers['x-signature'] as string
  const publicKey = headers['x-public-key'] as string

  if (!signature || !publicKey) {
    console.error('Missing signature or public key in headers')
    return false
  }

  const serialized = serializeForSigning(url)

  // Verify the URL and body using the provided signature and public key
  const serializedBody = method === 'GET' ? undefined : body
  return await verifyRequest(serialized, serializedBody, signature, publicKey)
}
