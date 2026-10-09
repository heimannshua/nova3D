import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {contrastRatio} from '../support/contrast';
import {parseRules, stripComments, tokensFor} from '../support/css';

const source = readFileSync(resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');
const css = stripComments(source);
const rules = parseRules(source);

const darkSelector = ':root[data-theme="dark"]';
const moreContrast = '@media (prefers-contrast: more)';

const light = tokensFor(rules, ':root');
const dark = {...light, ...tokensFor(rules, darkSelector)};
const lightMore = {...light, ...tokensFor(rules, ':root', moreContrast)};
// In the cascade :root[data-theme="dark"] outranks a bare :root, so only the dark selector's own
// high-contrast block applies on top of the dark palette.
const darkMore = {...dark, ...tokensFor(rules, darkSelector, moreContrast)};

const palettes = {light, dark, 'light, high contrast': lightMore, 'dark, high contrast': darkMore};

const surfaces = ['--surface-page', '--surface-card', '--surface-sunken', '--surface-raised'];
const textTokens = ['--text-strong', '--text', '--text-muted', '--text-subtle', '--text-accent'];
const statusNames = ['status-success', 'status-warning', 'status-danger', 'status-info', 'status-neutral'];
const evidenceNames = ['evidence-sourced', 'evidence-inferred', 'evidence-disputed', 'evidence-unknown', 'evidence-user-added'];

describe.each(Object.entries(palettes))('token contrast: %s (UX-DR1, UX-DR4)', (_name, tokens) => {
  const value = (token: string) => {
    const found = tokens[token];
    expect(found, `${token} is defined`).toBeDefined();
    return found;
  };
  const ratio = (a: string, b: string) => contrastRatio(value(a), value(b));

  it('keeps text at 4.5:1 or better on every surface', () => {
    for (const surface of surfaces) {
      for (const text of textTokens) expect(ratio(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps button and chip text at 4.5:1 on its own fill', () => {
    expect(ratio('--action-text', '--action')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--action-text', '--action-hover')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--danger-action-text', '--danger-action')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--danger-action-text', '--danger-action-hover')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--action-soft-text', '--action-soft')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--text-accent', '--action-soft')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps status and evidence text at 4.5:1 on its background', () => {
    for (const name of [...statusNames, ...evidenceNames]) {
      expect(ratio(`--${name}-fg`, `--${name}-bg`), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps control boundaries, focus rings and the action colour at 3:1 against every surface', () => {
    for (const surface of surfaces) {
      for (const token of ['--border-strong', '--focus', '--action']) {
        expect(ratio(token, surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(ratio('--border-strong', '--action-soft')).toBeGreaterThanOrEqual(3);
  });

  it('keeps status colours distinguishable from text on the card surface at 3:1 (icons and borders)', () => {
    for (const name of [...statusNames, ...evidenceNames]) expect(ratio(`--${name}-fg`, '--surface-card'), name).toBeGreaterThanOrEqual(3);
  });
});

describe('dark mode is explicit (SC-7)', () => {
  it('is defined only under data-theme="dark"', () => {
    expect(tokensFor(rules, darkSelector)['--surface-page']).toBeDefined();
  });

  it('never follows the operating system colour scheme', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
  });

  it('declares the colour-scheme of each theme', () => {
    expect(light['--surface-page']).not.toEqual(dark['--surface-page']);
    expect(rules.find((rule) => rule.selector === ':root' && rule.at === null)?.body).toMatch(/color-scheme:\s*light/);
    expect(rules.find((rule) => rule.selector === darkSelector && rule.at === null)?.body).toMatch(/color-scheme:\s*dark/);
  });
});

describe('semantic tokens (UX-DR1)', () => {
  it('covers surfaces, slate text, indigo actions, status, evidence, spacing, radii, elevation and type', () => {
    const wanted = [
      ...surfaces, ...textTokens, '--border', '--border-strong', '--action', '--action-hover', '--action-soft', '--focus',
      ...statusNames.flatMap((name) => [`--${name}-fg`, `--${name}-bg`]),
      ...evidenceNames.flatMap((name) => [`--${name}-fg`, `--${name}-bg`]),
      '--space-1', '--space-4', '--space-7', '--radius-sm', '--radius-lg', '--radius-pill',
      '--elevation-1', '--elevation-2', '--elevation-3', '--font-sans', '--text-base', '--text-3xl', '--target',
    ];
    for (const token of wanted) expect(light[token], token).toBeDefined();
  });

  it('overrides every colour token in dark mode, so no light value leaks through', () => {
    const colourTokens = Object.keys(light).filter((token) => /^#/.test(light[token]));
    const overridden = tokensFor(rules, darkSelector);
    for (const token of colourTokens) expect(overridden[token], token).toBeDefined();
  });

  it('uses the system font stack and no downloaded font', () => {
    expect(light['--font-sans']).toMatch(/system-ui/);
    expect(css).not.toMatch(/@font-face|fonts\.googleapis|@import url/);
  });

  it('keeps the touch target at 44 px or more', () => {
    expect(light['--target']).toMatch(/^2\.75rem$/);
    expect(css).toMatch(/\.btn \{[^}]*min-block-size: var\(--target\)/);
    expect(css).toMatch(/\.icon-btn \{[^}]*inline-size: var\(--target\)/);
    expect(css).toMatch(/\.icon-btn \{[^}]*block-size: var\(--target\)/);
    expect(css).toMatch(/\.nav-item \{[^}]*min-block-size: 3\.5rem/);
    expect(css).toMatch(/\.choice \{[^}]*min-block-size: var\(--target\)/);
  });
});

describe('accessibility modes are present (SC-7, AC-3)', () => {
  it('has high-contrast, forced-colours and reduced-motion rules', () => {
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toMatch(/@media \(forced-colors: active\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('removes animation and smooth scrolling for reduced motion', () => {
    const reduced = rules.filter((rule) => rule.at === '@media (prefers-reduced-motion: reduce)').map((rule) => rule.body).join('\n');
    expect(reduced).toMatch(/animation-duration: 0\.01ms/);
    expect(reduced).toMatch(/transition-duration: 0\.01ms/);
    expect(reduced).toMatch(/scroll-behavior: auto/);
  });

  it('pads the page above the bottom bar by the device safe area', () => {
    expect(css).toMatch(/\.main-column \{[^}]*padding-block-end: calc\(4\.75rem \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/\.main-nav \{[^}]*padding-block-end: env\(safe-area-inset-bottom\)/);
  });

  it('keeps a focus ring on the search input where :has() is not supported', () => {
    const fallback = rules.find((rule) => rule.at === '@supports not selector(:has(*))' && rule.selector === '.search-box input:focus-visible');
    expect(fallback?.body).toMatch(/outline: 0\.1875rem solid var\(--focus\)/);
  });

  it('draws one visible focus ring', () => {
    expect(css).toMatch(/:focus-visible \{[^}]*outline: 0\.1875rem solid var\(--focus\)/);
  });

  it('never removes the outline without replacing it', () => {
    for (const match of css.matchAll(/([^{}]+)\{([^}]*outline:\s*(?:none|0(?![.\d]))[^}]*)\}/g)) {
      expect(match[1].trim(), 'only main and the search input may drop the native outline').toMatch(/^(main:focus|\.search-box input)$/);
    }
  });
});

describe('logical directions and relative units (UX-DR5)', () => {
  const declarations = css.replace(/\{/g, '{\n').replace(/;/g, ';\n');

  it('uses no physical left or right properties', () => {
    const physical = [
      /(?:^|[\s;{])(?:margin|padding)-(?:left|right)\s*:/m,
      /(?:^|[\s;{])border-(?:left|right)(?:-[a-z]+)?\s*:/m,
      /(?:^|[\s;{])border-(?:top|bottom)-(?:left|right)-radius\s*:/m,
      /(?:^|[\s;{])(?:left|right)\s*:/m,
      /text-align:\s*(?:left|right)/,
      /(?:^|[\s;{])float\s*:/m,
      /(?:^|[\s;{])(?:min-|max-)?(?:inset-)?(?:left|right)\s*:/m,
    ];
    for (const pattern of physical) expect(declarations, String(pattern)).not.toMatch(pattern);
  });

  it('mirrors direction icons from one rule rather than duplicated assets', () => {
    expect(css).toMatch(/\.icon-directional:dir\(rtl\) \{ transform: scaleX\(-1\); \}/);
  });

  it('uses px only for hairlines of 1 to 3 px', () => {
    const outside = [...css.matchAll(/(-?\d*\.?\d+)px\b/g)].map((match) => Number(match[1])).filter((n) => Math.abs(n) > 3);
    expect(outside).toEqual([]);
  });

  it('sets no font size in px', () => {
    expect(css).not.toMatch(/font-size:\s*[\d.]+px/);
  });

  it('writes breakpoints in rem so enlarged text reflows sooner', () => {
    for (const match of css.matchAll(/@media[^{]*\((?:min|max)-(?:width|height):\s*([\d.]+)(\w+)\)/g)) expect(match[2], match[0]).toBe('rem');
  });
});
