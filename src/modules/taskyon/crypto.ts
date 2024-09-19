import { z } from 'zod';
import { tyPublicApiKeyObject } from './types';

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

// This doesn't verify the key, only looks if its contents are valid!
type tyPublicApiKeyObject = z.infer<typeof tyPublicApiKeyObject>;
export function isTaskyonKey(key: string | undefined, boolean: true): boolean;
export function isTaskyonKey(
  key: string | undefined,
  boolean: false,
): tyPublicApiKeyObject | undefined;
export function isTaskyonKey(
  key: string | undefined,
  boolean = true,
): boolean | tyPublicApiKeyObject | undefined {
  if (key) {
    let keyObj;
    try {
      keyObj = parseJwt(key);
    } catch {
      console.log('could not parse key', key);
      return boolean ? false : undefined;
    }
    const result = tyPublicApiKeyObject.safeParse(keyObj);
    if (result.success) {
      return boolean ? true : result.data;
    }
  }
  return boolean ? false : undefined;
}
