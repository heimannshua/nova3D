import {createHmac, timingSafeEqual} from 'node:crypto';

export const interimSessionCookie = 'nova3d-interim-session';
const sessionLifetimeSeconds = 60 * 60 * 12;

export function getInterimPassword() {
  const password = process.env.NOVA_INTERIM_PASSWORD?.trim();
  return password || null;
}

export function interimAuthEnabled() {
  return Boolean(getInterimPassword());
}

function signature(expiresAt: string, password: string) {
  return createHmac('sha256', password).update(expiresAt).digest('hex');
}

export function createInterimSession(now = Date.now()) {
  const password = getInterimPassword();
  if (!password) return null;
  const expiresAt = String(Math.floor(now / 1000) + sessionLifetimeSeconds);
  return `${expiresAt}.${signature(expiresAt, password)}`;
}

export function verifyInterimSession(value: string | undefined, now = Date.now()) {
  const password = getInterimPassword();
  if (!password || !value) return false;
  const [expiresAt, providedSignature] = value.split('.');
  if (!expiresAt || !providedSignature || Number(expiresAt) <= Math.floor(now / 1000)) return false;

  const expected = signature(expiresAt, password);
  const provided = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
}

export {sessionLifetimeSeconds};
