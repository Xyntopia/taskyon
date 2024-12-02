import { z } from 'zod';
import { signData, verifySignature } from './crypto';

const addOperation = z.object({
  name: z.literal('add'),
  data: z.string(),
});

const deleteOperation = z.object({
  name: z.literal('delete'),
  id: z.string(),
});

const SignedRequest = z.object({
  operation: z.union([addOperation, deleteOperation]),
  publicKey: z.string(),
  signature: z.string(),
});

export type SignedRequest = z.infer<typeof SignedRequest>;

// Sign a full operation object
export async function signOperation(
  operation: SignedRequest['operation'],
  privateKey: string,
): Promise<string> {
  const serializedOperation = new TextEncoder().encode(
    JSON.stringify(operation),
  );
  return await signData(serializedOperation, privateKey);
}

// Verify the signature of an operation
export async function verifyRequest(req: SignedRequest): Promise<boolean> {
  const serializedOperation = new TextEncoder().encode(
    JSON.stringify(req.operation),
  );
  return await verifySignature(
    req.signature,
    serializedOperation,
    req.publicKey,
  );
}

// Create a signed request
export async function createSignedRequest(
  operation: SignedRequest['operation'],
  publicKey: string,
  privateKey: string,
): Promise<SignedRequest> {
  // Sign the operation
  const signature = await signOperation(operation, privateKey);

  // Return the signed request
  return {
    operation,
    publicKey,
    signature,
  };
}

// Validate a signed request
export async function validateSignedRequest(
  signedRequest: SignedRequest,
  encryptionKey: CryptoKey,
): Promise<{
  isValid: boolean;
  operation?: {
    name: 'add' | 'delete';
    data?: Record<string, unknown>;
    id?: string;
  };
}> {
  const { operation } = signedRequest;

  // Verify the signature
  const isSignatureValid = await verifyRequest(signedRequest);

  if (!isSignatureValid) {
    return { isValid: false };
  }

  // Decrypt the data if it's an 'add' operation
  let decryptedData: Record<string, unknown> | undefined = undefined;
  if (operation.name === 'add' && operation.data) {
    decryptedData = await decryptObject(operation.data, encryptionKey);
  }

  // Return the validated operation
  const validatedOperation =
    operation.name === 'add'
      ? { name: 'add', data: decryptedData }
      : { name: 'delete', id: operation.id };

  return {
    isValid: true,
    operation: validatedOperation,
  };
}
