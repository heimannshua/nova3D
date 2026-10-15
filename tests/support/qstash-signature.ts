import {createHash, createHmac, randomUUID} from 'node:crypto';

// Test deliveries signed the way QStash signs them, so the application's own check (the SDK's `Receiver`, in lib/jobs.ts) verifies them
// with no stand-in: an `Upstash-Signature` that is a JWT, HS256 under the signing key, with the claims `iss` = "Upstash", `sub` = the
// destination URL, `exp`/`nbf`/`iat`, `jti` and `body` = the base64url SHA-256 of the raw body. The keys here are made up for the tests;
// they are the keys of no Upstash account and the application's `.env` files never hold them.

export const testSigningKeys = {
  current: 'test-qstash-current-signing-key-0000000000001',
  next: 'test-qstash-next-signing-key-00000000000000002',
};

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** The signature QStash would send for this raw body, signed with `key`. `now` and `lifetime` are seconds. */
export function signDelivery(
  rawBody: string,
  options: {key?: string; destination?: string; now?: number; lifetime?: number; claims?: Record<string, unknown>; bodyHash?: string} = {},
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: options.destination ?? 'http://127.0.0.1:4173/api/jobs',
      exp: now + (options.lifetime ?? 300),
      nbf: now,
      iat: now,
      jti: `jwt_${randomUUID()}`,
      body: options.bodyHash ?? createHash('sha256').update(rawBody).digest('base64url'),
      ...options.claims,
    }),
  );
  const signature = createHmac('sha256', options.key ?? testSigningKeys.current).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

/** A complete signed call: the body, and the headers QStash sends with a scheduled message. */
export function signedCall(
  body: {task: string; instance: string} | string,
  options: {key?: string; messageId?: string; scheduleId?: string | null; now?: number; lifetime?: number; claims?: Record<string, unknown>} = {},
) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'upstash-signature': signDelivery(text, options),
    'upstash-message-id': options.messageId ?? `msg_${randomUUID()}`,
  };
  if (options.scheduleId !== null) headers['upstash-schedule-id'] = options.scheduleId ?? `scd_${randomUUID()}`;
  return {body: text, headers};
}
