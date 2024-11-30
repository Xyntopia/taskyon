import * as bip39 from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { sign, getPublicKey } from '@noble/ed25519';

// Generate a new seed phrase (mnemonic)
export function generateSeedPhrase(): string {
  return bip39.generateMnemonic(englishWordlist);
}

// Validate an existing seed phrase
export function validateSeedPhrase(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, englishWordlist);
}

// Convert a mnemonic to a cryptographic seed
export function mnemonicToSeed(
  mnemonic: string,
  password: string = '',
): Uint8Array {
  if (!validateSeedPhrase(mnemonic)) {
    throw new Error('Invalid seed phrase');
  }
  return bip39.mnemonicToSeedSync(mnemonic, password);
}

// Generate Ed25519 key pair from seed
export async function generateEd25519Keys(seed: Uint8Array) {
  // Use the first 32 bytes of the seed for Ed25519
  const privateKey = seed.slice(0, 32);

  // Derive the public key
  const publicKey = getPublicKey(privateKey);

  return { publicKey, privateKey };
}

// Example: Sign data with the private key
export async function signData(
  privateKey: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return sign(data, privateKey);
}

/*async function main() {
  // Step 1: Generate a new seed phrase
  const mnemonic = generateSeedPhrase();
  console.log('Generated Mnemonic:', mnemonic);

  // Step 2: Validate the mnemonic
  const isValid = validateSeedPhrase(mnemonic);
  console.log('Is Mnemonic Valid:', isValid);

  if (!isValid) {
    throw new Error('Mnemonic validation failed.');
  }

  // Step 3: Derive the cryptographic seed from the mnemonic
  const seed = mnemonicToSeed(mnemonic, 'optional-password');
  console.log('Derived Seed:', seed);

  // Step 4: Generate Ed25519 key pair
  const { publicKey, privateKey } = await generateEd25519Keys(seed);
  console.log('Public Key:', publicKey);
  console.log('Private Key:', privateKey);

  // Step 5: Sign some data
  const data = new TextEncoder().encode('Hello, Ed25519!');
  const signature = await signData(privateKey, data);
  console.log('Signature:', signature);
}*/

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
