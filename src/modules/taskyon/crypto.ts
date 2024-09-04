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
export function isTaskyonKey(key: string) {
  const keyObj = parseJwt(key);
  const result = tyPublicApiKeyObject.safeParse(keyObj);
  if (result.success) {
    return true;
  } else {
    return false;
  }
}
