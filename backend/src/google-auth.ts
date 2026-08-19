import { createSign } from 'node:crypto';
import { config } from './config';

/**
 * Google service-account auth without a client library, matching the
 * dependency-light style of the rest of this service: build a JWT asserting the
 * service account, sign it RS256 with its private key, and exchange it for a
 * bearer token. Tokens last an hour; one is cached per scope and refreshed a
 * minute early.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const cache = new Map<string, { token: string; expiresAt: number }>();

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

export async function googleAccessToken(scope: string): Promise<string> {
  const creds = config.google.creds;
  if (!creds) {
    throw new Error('Google service-account credentials are not configured');
  }

  const hit = cache.get(scope);
  if (hit && Date.now() < hit.expiresAt) return hit.token;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: creds.clientEmail,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(creds.privateKey);
  const assertion = `${unsigned}.${base64url(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;
  if (!res.ok || !data?.access_token) {
    throw new Error(
      `Google token exchange failed (${res.status}): ${data?.error_description ?? 'no access_token'}`
    );
  }

  cache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  });
  return data.access_token;
}
