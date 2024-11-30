import {
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeedSync,
} from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { sign, getPublicKeyAsync } from '@noble/ed25519';
import { uint8ArrayToBase64Url } from './encoding';

// Generate a new seed phrase (mnemonic)
export function generateSeedPhrase(): string {
  return generateMnemonic(englishWordlist);
}

// Validate an existing seed phrase
export function validateSeedPhrase(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, englishWordlist);
}

// Convert a mnemonic to a cryptographic seed
export function mnemonicToSeed(
  mnemonic: string,
  password: string = '',
): Uint8Array {
  if (!validateSeedPhrase(mnemonic)) {
    throw new Error('Invalid seed phrase');
  }
  return mnemonicToSeedSync(mnemonic, password);
}

// Generate Ed25519 key pair from seed
export async function generateEd25519Keys(seed: Uint8Array) {
  // Use the first 32 bytes of the seed for Ed25519
  const privateKey = seed.slice(0, 32);

  // Derive the public key
  const publicKey = await getPublicKeyAsync(privateKey);

  return { publicKey, privateKey };
}

// Example: Sign data with the private key
export async function signData(
  privateKey: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return sign(data, privateKey);
}

export async function generateRandomNewKey() {
  const mnemonic = generateSeedPhrase();

  return { mnemonic, ...(await base64UrlEd25519Keys(mnemonic)) };
}

export async function base64UrlEd25519Keys(mnemonic: string) {
  const seed = mnemonicToSeed(mnemonic);
  const { publicKey, privateKey } = await generateEd25519Keys(seed);
  console.log('Public Key:', publicKey);
  console.log('Private Key:', privateKey);
  return {
    publicKey: uint8ArrayToBase64Url(publicKey),
    privateKey: uint8ArrayToBase64Url(privateKey),
  };
}

export function parseJwt(
  token: string | undefined,
): Record<string, unknown> | undefined {
  if (token) {
    const base64Url = token.split('.')[1]!;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload: string = decodeURIComponent(
      window
        .atob(base64)
        .split('')
        .map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(''),
    );

    const jwtObject = JSON.parse(jsonPayload) as Record<string, unknown>;
    return jwtObject;
  }
}
