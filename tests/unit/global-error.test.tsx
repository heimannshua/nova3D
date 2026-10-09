import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import GlobalError from '@/app/global-error';
import {GlobalErrorView} from '@/components/global-error-view';
import {deviceLanguages, readClientPreferences, type CookieJar} from '@/lib/preferences';
import {locales} from '@/lib/i18n';

afterEach(() => vi.unstubAllGlobals());

describe('global error page (root layout failure)', () => {
  it('is a complete document with its own html and body, a heading, an alert and a retry button', () => {
    const markup = renderToStaticMarkup(<GlobalErrorView locale="en" theme="light" retry={() => undefined}/>);
    expect(markup).toMatch(/^<html lang="en" dir="ltr" data-theme="light">/);
    expect(markup).toContain('<body>');
    expect(markup).toContain('<main id="main-content" tabindex="-1"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('<h1 class="state-title">Something went wrong</h1>');
    expect(markup).toContain('<span>Try again</span>');
    expect(markup).toContain('<title>Something went wrong · nova3D</title>');
  });

  it.each(locales)('reads in %s with the right direction, and in dark when asked', (locale) => {
    const markup = renderToStaticMarkup(<GlobalErrorView locale={locale} theme="dark" retry={() => undefined}/>);
    expect(markup).toContain(`lang="${locale}"`);
    expect(markup).toContain(`dir="${locale === 'he' ? 'rtl' : 'ltr'}"`);
    expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain(locale === 'he' ? 'משהו השתבש' : 'Something went wrong');
  });

  it('wires the button to retry', () => {
    const retry = vi.fn();
    const view = GlobalErrorView({locale: 'en', theme: 'light', retry});
    // Walk the element tree to the Button's onClick.
    const find = (node: unknown): (() => void) | undefined => {
      if (!node || typeof node !== 'object') return undefined;
      const element = node as {props?: {onClick?: () => void; children?: unknown; action?: unknown}};
      if (element.props?.onClick) return element.props.onClick;
      for (const child of [element.props?.action, ...[element.props?.children].flat()]) {
        const found = find(child);
        if (found) return found;
      }
      return undefined;
    };
    find(view)?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders from the component Next mounts, as English and light on the server render', () => {
    const markup = renderToStaticMarkup(<GlobalError error={new Error('boom')} retry={() => undefined}/>);
    expect(markup).toMatch(/^<html lang="en" dir="ltr" data-theme="light">/);
    expect(markup).not.toContain('boom');
  });
});

describe('what the page reads from the browser', () => {
  const jarOf = (cookie: string): CookieJar => ({read: () => cookie, write: () => undefined});

  it('takes language and theme from valid cookies', () => {
    expect(readClientPreferences(jarOf('nova3d-locale=he; nova3d-theme=dark'))).toMatchObject({locale: 'he', theme: 'dark'});
  });

  it('ignores tampered cookies and falls back to the device language, then English', () => {
    vi.stubGlobal('navigator', {languages: ['he-IL', 'en'], language: 'he-IL'});
    expect(readClientPreferences(jarOf('nova3d-locale=klingon; nova3d-theme=neon'))).toMatchObject({locale: 'he', theme: 'light'});
    vi.stubGlobal('navigator', {languages: ['fr-FR'], language: 'fr-FR'});
    expect(readClientPreferences(jarOf(''))).toMatchObject({locale: 'en', theme: 'light'});
  });

  it('falls back to navigator.language when navigator.languages is empty', () => {
    vi.stubGlobal('navigator', {languages: [], language: 'he-IL'});
    expect(deviceLanguages()).toBe('he-IL');
    expect(readClientPreferences(jarOf('')).locale).toBe('he');
    vi.stubGlobal('navigator', {language: 'he-IL'});
    expect(deviceLanguages()).toBe('he-IL');
    vi.stubGlobal('navigator', {languages: ['he', 'en-US'], language: 'he'});
    expect(deviceLanguages()).toBe('he,en-US');
    vi.stubGlobal('navigator', undefined);
    expect(deviceLanguages()).toBeUndefined();
  });
});
