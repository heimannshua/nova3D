import type {ReactElement} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

// What a request renders with (Story 1.4d): the Account's stored record when the request belongs to an active
// Account that has one, the device's cookies and Accept-Language otherwise. The request is faked (cookies and
// headers) and so is the Account (`getAccess`), because lib/access has its own tests.
const request = vi.hoisted(() => ({cookies: {} as Record<string, string>, acceptLanguage: null as string | null}));
const mocks = vi.hoisted(() => ({getAccess: vi.fn()}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name in request.cookies ? {name, value: request.cookies[name]} : undefined),
    getAll: () => Object.entries(request.cookies).map(([name, value]) => ({name, value})),
  }),
  headers: async () => ({get: (name: string) => (name.toLowerCase() === 'accept-language' ? request.acceptLanguage : null)}),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({...(await importOriginal<typeof import('@/lib/auth')>()), getAccess: mocks.getAccess}));

import RootLayout, {generateMetadata} from '@/app/layout';
import {getI18n} from '@/lib/i18n/server';
import {getRequestPreferences} from '@/lib/preferences.server';
import type {PreferenceRecord} from '@/lib/preferences';

const session = 'sb-abcdefgh-auth-token';
const USER = '5f0d6c1e-8a52-4c1b-9d57-2b6a1f0e7c44';
const SESSION = '3b1c9a3e-6a3e-4f19-9d0e-0a4f5e2c8d11';
const ACCOUNT = '7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const active = (preferences: PreferenceRecord | null) => ({
  state: 'active',
  user: {id: USER, email: 'person@example.com', sessionId: SESSION},
  account: {accountId: ACCOUNT, workspaceId: null, role: 'member', epoch: 1, preferences},
});
const hebrewDark: PreferenceRecord = {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  request.cookies = {};
  request.acceptLanguage = null;
  mocks.getAccess.mockReset().mockResolvedValue(active(null));
});

describe('an Account with a record: the record wins', () => {
  it('renders the record\'s values, whatever the cookies of this device say (a new device)', async () => {
    request.cookies = {[session]: 'x', 'nova3d-locale': 'en', 'nova3d-theme': 'light', 'nova3d-detail': 'simple', 'nova3d-guidance': 'shown'};
    mocks.getAccess.mockResolvedValue(active(hebrewDark));
    expect(await getRequestPreferences()).toEqual({
      preferences: {locale: 'he', theme: 'dark', detail: 'technical', guidance: 'dismissed'},
      deviceLocale: 'en',
      localeOverridden: true,
      accountBacked: true,
    });
  });

  it('renders the record on a device with no cookies at all, and leaves it alone (nothing is written here)', async () => {
    request.cookies = {[session]: 'x'};
    mocks.getAccess.mockResolvedValue(active(hebrewDark));
    expect((await getRequestPreferences()).preferences).toEqual(hebrewDark);
  });

  it('"Match my device": a record with no language follows Accept-Language, and is not an override', async () => {
    request.cookies = {[session]: 'x', 'nova3d-locale': 'en'};
    request.acceptLanguage = 'he-IL,he;q=0.9';
    mocks.getAccess.mockResolvedValue(active({...hebrewDark, locale: null}));
    expect(await getRequestPreferences()).toMatchObject({preferences: {locale: 'he'}, deviceLocale: 'he', localeOverridden: false, accountBacked: true});
    request.acceptLanguage = 'fr-FR';
    expect(await getRequestPreferences()).toMatchObject({preferences: {locale: 'en'}, deviceLocale: 'en', localeOverridden: false});
  });

  it('keeps the device\'s language as the device\'s even when the record chose another', async () => {
    request.cookies = {[session]: 'x'};
    request.acceptLanguage = 'he-IL';
    mocks.getAccess.mockResolvedValue(active({...hebrewDark, locale: 'en'}));
    expect(await getRequestPreferences()).toMatchObject({preferences: {locale: 'en'}, deviceLocale: 'he', localeOverridden: true});
  });
});

describe('an Account with no record yet: the cookies serve the page, and a change is still saved to the Account', () => {
  it('renders the device\'s cookies and Accept-Language', async () => {
    request.cookies = {[session]: 'x', 'nova3d-locale': 'he', 'nova3d-theme': 'dark'};
    expect(await getRequestPreferences()).toEqual({
      preferences: {locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'},
      deviceLocale: 'en',
      localeOverridden: true,
      accountBacked: true,
    });
  });

  it('ignores a tampered cookie without an error', async () => {
    request.cookies = {[session]: 'x', 'nova3d-locale': 'klingon', 'nova3d-theme': 'neon'};
    request.acceptLanguage = 'he-IL';
    expect(await getRequestPreferences()).toMatchObject({preferences: {locale: 'he', theme: 'light'}, localeOverridden: false, accountBacked: true});
  });
});

describe('a request with no Account: the device\'s cookies, and no one is asked', () => {
  it('does not ask for the Account when the request carries no session cookie (the sign-in page and the kit cost nothing signed out)', async () => {
    request.cookies = {'nova3d-theme': 'dark'};
    expect(await getRequestPreferences()).toMatchObject({preferences: {theme: 'dark'}, accountBacked: false});
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['another project\'s session cookie', {'sb-otherproj-auth-token': 'x'}],
    ['a sign-in under way (only the PKCE verifier)', {'sb-abcdefgh-auth-token-code-verifier': 'x'}],
    ['a look-alike name', {'sb-abcdefgh-auth-token-extra': 'x', 'xsb-abcdefgh-auth-token': 'x'}],
  ])('does not ask either for %s', async (_name, cookies) => {
    request.cookies = cookies;
    expect((await getRequestPreferences()).accountBacked).toBe(false);
    expect(mocks.getAccess).not.toHaveBeenCalled();
  });

  it('asks for a chunked session cookie too', async () => {
    request.cookies = {[`${session}.0`]: 'x', [`${session}.1`]: 'y'};
    await getRequestPreferences();
    expect(mocks.getAccess).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signed out', {state: 'signed-out'}],
    ['a session that ended', {state: 'session-ended', reason: 'revoked', user: {id: USER, email: 'a@b.c', sessionId: SESSION}}],
    ['an identity with no Account', {state: 'unregistered', user: {id: USER, email: 'a@b.c', sessionId: SESSION}}],
    ['a disabled Account', {state: 'disabled', user: {id: USER, email: 'a@b.c', sessionId: SESSION}}],
    ['a changed Google identity', {state: 'refused'}],
  ])('falls back to the cookies, never the record, and keeps a choice on the device, for %s', async (_name, access) => {
    request.cookies = {[session]: 'x', 'nova3d-theme': 'dark'};
    mocks.getAccess.mockResolvedValue(access);
    expect(await getRequestPreferences()).toMatchObject({preferences: {theme: 'dark', locale: 'en'}, accountBacked: false});
  });

  describe('an Account that could not be read keeps its changes going to the Account', () => {
    it('renders from the cookies, but is account-backed, so a change fails visibly instead of being kept on the device and overridden by the record later (an outage)', async () => {
      request.cookies = {[session]: 'x', 'nova3d-theme': 'dark', 'nova3d-locale': 'he'};
      mocks.getAccess.mockResolvedValue({state: 'unavailable'});
      expect(await getRequestPreferences()).toEqual({
        preferences: {locale: 'he', theme: 'dark', detail: 'simple', guidance: 'shown'},
        deviceLocale: 'en',
        localeOverridden: true,
        accountBacked: true,
      });
    });

    it('is the same when asking throws', async () => {
      request.cookies = {[session]: 'x', 'nova3d-theme': 'dark'};
      mocks.getAccess.mockRejectedValue(new Error('boom'));
      expect(await getRequestPreferences()).toMatchObject({preferences: {theme: 'dark'}, accountBacked: true});
    });

    it('is not so without a session cookie: nobody is asked, and nobody is signed in to save to', async () => {
      request.cookies = {'nova3d-theme': 'dark'};
      mocks.getAccess.mockResolvedValue({state: 'unavailable'});
      expect(await getRequestPreferences()).toMatchObject({accountBacked: false});
      expect(mocks.getAccess).not.toHaveBeenCalled();
    });
  });
});

describe('the layout, the metadata and getI18n render from it (first paint)', () => {
  const html = async () => {
    const tree = (await RootLayout({children: null})) as ReactElement<{lang: string; dir: string; 'data-theme': string}>;
    return {lang: tree.props.lang, dir: tree.props.dir, theme: tree.props['data-theme']};
  };

  beforeEach(() => {
    request.cookies = {[session]: 'x', 'nova3d-locale': 'en', 'nova3d-theme': 'light'};
    mocks.getAccess.mockResolvedValue(active(hebrewDark));
  });

  it('puts the record\'s language, direction and theme in the first HTML', async () => {
    expect(await html()).toEqual({lang: 'he', dir: 'rtl', theme: 'dark'});
  });

  it('hands the provider the record, and tells it the page belongs to an Account', async () => {
    const tree = (await RootLayout({children: null})) as ReactElement<{children: ReactElement<{initial: unknown; accountBacked: boolean; localeOverridden: boolean}>}>;
    const provider = (tree.props.children as unknown as ReactElement<{children: ReactElement<{initial: unknown; accountBacked: boolean; localeOverridden: boolean}>}>).props.children;
    expect(provider.props).toMatchObject({initial: hebrewDark, accountBacked: true, localeOverridden: true});
  });

  it('titles the document in the record\'s language', async () => {
    expect(JSON.stringify(await generateMetadata())).toContain('יוצרים עם ראיות');
  });

  it('gives getI18n the record\'s language', async () => {
    expect(await getI18n()).toMatchObject({locale: 'he', dir: 'rtl'});
  });

  it('is the cookies again the moment the Account has no record', async () => {
    mocks.getAccess.mockResolvedValue(active(null));
    expect(await html()).toEqual({lang: 'en', dir: 'ltr', theme: 'light'});
  });
});
