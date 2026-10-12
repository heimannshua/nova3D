import {randomBytes} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {isRecoveryToken, newRecoveryToken, recoveryTokenBytes} from '@/lib/accounts';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';
import {
  recoveredCountOf,
  recoverPath,
  recoveryConfirmPath,
  recoveryLandingPath,
  recoveryLandingUrl,
  recoveryRedeemIdle,
  recoveryRedeemKeys,
  recoveryRequestIdle,
  recoveryRequestKeys,
  recoveryTokenPattern,
  tokenFromFragment,
} from '@/lib/recovery-state';

// What the recovery pages and their actions agree on (Story 1.6), with nothing that reaches the server.
describe('the token', () => {
  it('is 32 random bytes: 43 URL-safe characters, and the one pattern the server and the page share', () => {
    expect(recoveryTokenBytes).toBe(32);
    for (let index = 0; index < 50; index += 1) {
      const token = newRecoveryToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(recoveryTokenPattern.test(token)).toBe(true);
      expect(isRecoveryToken(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
    expect(new Set(Array.from({length: 200}, () => newRecoveryToken())).size).toBe(200);
  });

  it('is made from exactly the bytes the random source gives, and refuses a source that gives another number', () => {
    const bytes = randomBytes(32);
    expect(newRecoveryToken(() => bytes)).toBe(bytes.toString('base64url'));
    expect(() => newRecoveryToken(() => randomBytes(31))).toThrow('wrong number of bytes');
    expect(() => newRecoveryToken(() => randomBytes(33))).toThrow('wrong number of bytes');
  });

  it.each([undefined, null, 42, {}, '', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)} `, `${'a'.repeat(42)}\n`, 'é'.repeat(43)])('is not %j', (value) => {
    expect(isRecoveryToken(value)).toBe(false);
  });
});

describe('tokenFromFragment', () => {
  const token = newRecoveryToken();

  it('reads the token from `window.location.hash` as the browser spells it, with or without the #', () => {
    expect(tokenFromFragment(`#${token}`)).toBe(token);
    expect(tokenFromFragment(token)).toBe(token);
  });

  it.each([undefined, null, '', '#', '#short', '#' + 'a'.repeat(44), '##' + 'a'.repeat(43), ' #' + 'a'.repeat(43), '#' + 'a'.repeat(43) + '&x=1', '#token=' + 'a'.repeat(43), '#' + 'a'.repeat(21) + '.' + 'a'.repeat(21)])('is none for %j', (fragment) => {
    expect(tokenFromFragment(fragment as string | null | undefined)).toBeNull();
  });
});

describe('where recovery goes', () => {
  it('names the two public pages and where a recovery ends', () => {
    expect(recoverPath).toBe('/recover');
    expect(recoveryConfirmPath).toBe('/recover/confirm');
    expect(recoveryLandingPath).toBe('/admin');
  });

  it('says how many other sessions it ended in the address, as a number and nothing else', () => {
    expect(recoveryLandingUrl(0)).toBe('/admin?recovered=0');
    expect(recoveryLandingUrl(7)).toBe('/admin?recovered=7');
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) expect(recoveryLandingUrl(bad), String(bad)).toBe('/admin?recovered=0');
  });

  it('reads that number back only when it is a short run of digits', () => {
    expect(recoveredCountOf('0')).toBe(0);
    expect(recoveredCountOf('12')).toBe(12);
    expect(recoveredCountOf(['3', '9'])).toBe(3);
    for (const bad of [undefined, '', '-1', '1.5', '1e3', ' 3', '3 ', '12345', 'three', '0x10', '3;', '<script>']) expect(recoveredCountOf(bad), String(bad)).toBeNull();
    expect(recoveredCountOf([])).toBeNull();
  });
});

describe('the states and their words', () => {
  it('start idle', () => {
    expect(recoveryRequestIdle).toEqual({outcome: 'idle'});
    expect(recoveryRedeemIdle).toEqual({outcome: 'idle'});
  });

  it('have a message in the catalog for every answer, in both languages, and each one different', () => {
    const keys = [...Object.values(recoveryRequestKeys), ...Object.values(recoveryRedeemKeys)];
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    for (const key of keys) {
      expect(en[key as keyof typeof en], key).toBeTruthy();
      expect(he[key as keyof typeof he], key).toBeTruthy();
    }
    expect(Object.keys(recoveryRequestKeys).sort()).toEqual(['limited', 'sent', 'unavailable']);
    expect(Object.keys(recoveryRedeemKeys).sort()).toEqual(['invalid', 'unavailable', 'unknown']);
  });

  it('say nothing of an address, a name or a Workspace', () => {
    const keys = Object.keys(en).filter((key) => /^(?:recover\.|recoverConfirm\.|admin\.recovered|login\.recover)/.test(key));
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      for (const catalog of [en, he] as Record<string, unknown>[]) {
        const message = catalog[key];
        const text = typeof message === 'string' ? message : Object.values(message as Record<string, string>).join(' ');
        expect(text, key).not.toMatch(/@|\{email\}|\{name\}|\{address\}/);
      }
    }
  });
});
