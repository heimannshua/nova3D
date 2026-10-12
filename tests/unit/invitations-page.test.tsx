import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {CodeReveal} from '@/components/admin/code-reveal';
import {InvitationsContent} from '@/components/admin/invitations-content';
import {SettingsContent} from '@/components/settings/settings-content';
import {locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import type {Confirmation, InvitationRow, IssuedCode} from '@/lib/invitations';

// Story 1.11: the Administrator's invitation page, rendered to markup in both languages. What needs a browser (the
// dialogs, the copy action, focus, the live regions) is in tests/e2e/invitations.spec.ts.
const UNUSED_NAMED: InvitationRow = {invitationId: '11111111-1111-4111-8111-111111111111', kind: 'named', label: 'Daniel', state: 'unused', createdAt: '2026-10-12T00:24:11.123456+00:00'};
const USED_NAMED: InvitationRow = {invitationId: '22222222-2222-4222-8222-222222222222', kind: 'named', label: 'Noa & <Ben>', state: 'redeemed', createdAt: '2026-10-11T09:00:00+00:00'};
const REVOKED_NAMED: InvitationRow = {invitationId: '33333333-3333-4333-8333-333333333333', kind: 'named', label: 'Ruth', state: 'revoked', createdAt: '2026-10-10T09:00:00+00:00'};
const USED_GENERAL: InvitationRow = {invitationId: '44444444-4444-4444-8444-444444444444', kind: 'general', label: null, state: 'redeemed', createdAt: '2026-10-09T09:00:00+00:00'};
const UNUSED_GENERAL: InvitationRow = {invitationId: '55555555-5555-4555-8555-555555555555', kind: 'general', label: null, state: 'unused', createdAt: '2026-10-12T00:30:00+00:00'};
const CODE = 'H7K2-9QXM-D3FZ-W8TV-0N4B-RJ6Y-CP5E-GA1S';

const render = (locale: Locale, invitations: InvitationRow[] | null, confirmation: Confirmation = 'confirmed') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <InvitationsContent invitations={invitations} confirmation={confirmation}/>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

describe.each(locales)('the invitation page in %s', (locale) => {
  const all = [UNUSED_GENERAL, UNUSED_NAMED, USED_NAMED, REVOKED_NAMED, USED_GENERAL];
  const markup = render(locale, all);

  it('has one level-one heading, then a heading for each section in order: named code, general code, all codes', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'invitations.title'));
    const headings = [...markup.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim());
    expect(headings).toEqual([t(locale, 'invitations.named.title'), t(locale, 'invitations.general.title'), t(locale, 'invitations.list.title')]);
  });

  it('names the field, hints at the limit and describes the field by the hint', () => {
    expect(markup).toMatch(/<label[^>]*for="([^"]+)"[^>]*>/);
    const id = /<label[^>]*for="([^"]+)"/.exec(markup)![1];
    expect(markup).toContain(`id="${id}"`);
    expect(text(markup)).toContain(t(locale, 'invitations.named.label'));
    expect(text(markup)).toContain(t(locale, 'invitations.named.hint', {max: 80}));
    const field = /<input[^>]*\bname="label"[^>]*>/.exec(markup)![0];
    expect(field).toContain('aria-required="true"');
    expect(field).toMatch(/aria-describedby="[^"]+"/);
    expect(field).not.toMatch(/maxLength/i);
    expect(markup).toMatch(/<form[^>]*noValidate/);
  });

  it('shows no code, no alert and no made-code panel before anything is done', () => {
    expect(markup).not.toContain('code-reveal');
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain('aria-invalid');
    expect(markup).not.toMatch(/(?:[0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}/);
  });

  it('lists every code newest first as it was given, each with its name, kind, status, identifier and time', () => {
    const items = [...markup.matchAll(/<li class="invite-item">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(items).toHaveLength(all.length);
    items.forEach((item, index) => {
      const row = all[index];
      const words = text(item);
      expect(words).toContain(row.kind === 'general' ? t(locale, 'invitations.row.general') : (row.label as string));
      expect(words).toContain(t(locale, `invitations.status.${row.state}`));
      expect(words).toContain(t(locale, row.kind === 'general' ? 'invitations.row.kind.general' : 'invitations.row.kind.named'));
      expect(item).toContain(row.invitationId);
    });
    expect(markup).toContain('<time dateTime="2026-10-12T00:24:11.123Z">2026-10-12 00:24 UTC</time>');
  });

  it('puts the name in the page as text, never as markup', () => {
    expect(markup).not.toContain('<Ben>');
    expect(markup).toContain('Noa &amp; &lt;Ben&gt;');
  });

  it('gives every status a word and a shape, never a colour alone', () => {
    for (const state of ['unused', 'redeemed', 'revoked'] as const) {
      const badges = [...markup.matchAll(/<span class="status-badge tone-[a-z-]+">(<svg[\s\S]*?<\/svg>)<span>(.*?)<\/span><\/span>/g)].filter((match) => match[2] === t(locale, `invitations.status.${state}`));
      expect(badges.length, state).toBeGreaterThan(0);
      for (const badge of badges) expect(badge[1]).toContain('aria-hidden="true"');
    }
    const tones = Object.fromEntries([...markup.matchAll(/<span class="status-badge (tone-[a-z-]+)">[\s\S]*?<span>(.*?)<\/span><\/span>/g)].map((match) => [match[2], match[1]]));
    expect(tones[t(locale, 'invitations.status.unused')]).toBe('tone-success');
    expect(tones[t(locale, 'invitations.status.redeemed')]).toBe('tone-neutral');
    expect(tones[t(locale, 'invitations.status.revoked')]).toBe('tone-danger');
  });

  it('offers Revoke for an unused code only, and names which code it revokes', () => {
    const buttons = [...markup.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)].map((match) => match[1].replace(/&#x27;/g, "'"));
    expect(buttons).toEqual([t(locale, 'invitations.row.revokeLabel', {name: t(locale, 'invitations.row.general')}), t(locale, 'invitations.row.revokeLabel', {name: 'Daniel'})]);
    // The visible word is inside the accessible name.
    for (const name of buttons) expect(name).toContain(t(locale, 'invitations.row.revoke'));
  });

  it('offers Replace while a general code is waiting, and Make when none is, and never both', () => {
    expect(text(markup)).toContain(t(locale, 'invitations.general.replace'));
    expect(text(markup)).toContain(t(locale, 'invitations.general.waiting'));
    expect(text(markup)).not.toContain(t(locale, 'invitations.general.mint'));
    expect(markup).toContain('name="replace" value="true"');
    const none = render(locale, [UNUSED_NAMED, USED_GENERAL]);
    expect(text(none)).toContain(t(locale, 'invitations.general.mint'));
    expect(text(none)).toContain(t(locale, 'invitations.general.none'));
    expect(text(none)).toContain(t(locale, 'invitations.general.noneBadge'));
    expect(text(none)).not.toContain(t(locale, 'invitations.general.replace'));
    expect(none).toContain('name="replace" value="false"');
    // A general code that was used or revoked is not "waiting".
    expect(text(render(locale, [USED_GENERAL, {...UNUSED_GENERAL, state: 'revoked'}]))).toContain(t(locale, 'invitations.general.mint'));
    // A named code that is unused is not a general one.
    expect(text(render(locale, [UNUSED_NAMED]))).toContain(t(locale, 'invitations.general.mint'));
  });

  it('holds no confirmation dialog until one is asked for', () => {
    expect(markup).not.toContain('<dialog');
  });

  it('says the list could not be loaded, and nothing about the codes, when it could not', () => {
    const failed = render(locale, null);
    expect(text(failed)).toContain(t(locale, 'invitations.list.error.title'));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('invite-item');
    // With no list there is no way to tell whether a general code is waiting: nothing is claimed either way (no "waiting",
    // no "none waiting", no badge), Make is offered, and the server decides (it answers "exists" if one is waiting).
    expect(text(failed)).toContain(t(locale, 'invitations.general.mint'));
    expect(text(failed)).not.toContain(t(locale, 'invitations.general.none'));
    expect(text(failed)).not.toContain(t(locale, 'invitations.general.noneBadge'));
    expect(text(failed)).not.toContain(t(locale, 'invitations.general.waiting'));
    expect(text(failed)).not.toContain(t(locale, 'invitations.general.replace'));
    expect(failed).not.toContain('class="invite-state"');
    expect(failed).toContain('name="replace" value="false"');
  });

  it('says there are no codes yet, when there are none', () => {
    const empty = render(locale, []);
    expect(text(empty)).toContain(t(locale, 'invitations.list.empty.title'));
    expect(empty).not.toContain('invite-item');
  });

  it('is described in words by the page: what a code is and that it is shown once', () => {
    expect(text(markup)).toContain(t(locale, 'invitations.lede'));
    expect(text(markup)).toContain(t(locale, 'invitations.list.help'));
  });
});

describe.each(locales)('whether the Administrator has confirmed it is them, in %s', (locale) => {
  it('offers the step-up for administration, beforehand, when there is no valid marker', () => {
    const markup = render(locale, [], 'needed');
    expect(markup).toMatch(/<a [^>]*href="\/step-up\?for=administration"[^>]*>/);
    expect(text(markup)).toContain(t(locale, 'invitations.confirm.action'));
    // Beforehand it is a note that a change needs a fresh sign-in, not the report of a refused change.
    expect(text(markup)).toContain(t(locale, 'invitations.confirm.needed'));
    expect(text(markup)).not.toContain(t(locale, 'invitations.error.needsConfirm'));
    expect(markup).not.toContain('notice-success');
    // Nothing yet happened, so nothing is announced as an alert.
    expect(markup).not.toContain('role="alert"');
  });

  it('says it is confirmed, and offers no step-up, when there is one', () => {
    const markup = render(locale, [], 'confirmed');
    expect(text(markup)).toContain(t(locale, 'invitations.confirm.ok'));
    expect(markup).toContain('notice-success');
    expect(markup).not.toContain('/step-up');
  });

  it('says neither when the check could not be made: the actions decide', () => {
    const markup = render(locale, [], 'unknown');
    expect(markup).not.toContain('/step-up');
    expect(markup).not.toContain('notice-success');
  });
});

describe.each(locales)('a code that was just made, in %s', (locale) => {
  const made = (patch: Partial<IssuedCode> = {}): IssuedCode => ({invitationId: UNUSED_NAMED.invitationId, kind: 'named', label: 'Daniel', code: CODE, replacedInvitationId: null, ...patch});
  const reveal = (item: IssuedCode) => renderToStaticMarkup(<I18nProvider locale={locale}><CodeReveal item={item} onHide={() => undefined}/></I18nProvider>);

  it('shows the code once, with a copy action and a way to hide it, under a heading that says whose it is', () => {
    const markup = reveal(made());
    expect(markup).toMatch(/<section[^>]*tabindex="-1"[^>]*aria-labelledby="[^"]+"/);
    expect(text(markup)).toContain(t(locale, 'invitations.reveal.named', {label: 'Daniel'}));
    expect(text(markup)).toContain(t(locale, 'invitations.reveal.once'));
    expect(markup).toContain(`<code>${CODE}</code>`);
    expect(text(markup)).toContain(t(locale, 'invitations.reveal.copy'));
    expect(text(markup)).toContain(t(locale, 'invitations.reveal.hide'));
    expect(markup.match(/<button\b/g)).toHaveLength(2);
    expect(markup).not.toContain('<h1');
  });

  it('reads the code left to right in either language, and describes the section by the sentence that says it is shown once', () => {
    const markup = reveal(made());
    expect(markup).toMatch(/<bdi[^>]*dir="ltr"[^>]*><code>/);
    const described = /aria-describedby="([^"]+)"/.exec(markup)![1];
    expect(markup).toContain(`id="${described}"`);
  });

  it('says a general code is new, and when it replaced the previous one says that was revoked', () => {
    const plain = reveal(made({kind: 'general', label: null}));
    expect(text(plain)).toContain(t(locale, 'invitations.reveal.general'));
    expect(text(plain)).not.toContain(t(locale, 'invitations.reveal.rotated'));
    const rotated = reveal(made({kind: 'general', label: null, replacedInvitationId: UNUSED_GENERAL.invitationId}));
    expect(text(rotated)).toContain(t(locale, 'invitations.reveal.rotated'));
    // The replaced code's identifier is not shown here; the list holds it.
    expect(rotated).not.toContain(UNUSED_GENERAL.invitationId);
  });

  it('shows no copy outcome before one is tried', () => {
    const markup = reveal(made());
    expect(markup).toMatch(/<p class="settings-help" role="status"><\/p>/);
  });
});

describe.each(locales)('Settings in %s', (locale) => {
  const settings = (isAdministrator?: boolean) => renderToStaticMarkup(<I18nProvider locale={locale}><SettingsContent isAdministrator={isAdministrator}/></I18nProvider>);

  it('links to the invitation page for the Administrator, in a section of its own', () => {
    const markup = settings(true);
    expect(text(markup)).toContain(t(locale, 'settings.admin.title'));
    expect(markup).toMatch(/<a [^>]*href="\/admin\/invitations"[^>]*>/);
    expect(text(markup)).toContain(t(locale, 'settings.admin.invitations'));
  });

  it('shows no such section to anyone else, and by default', () => {
    for (const markup of [settings(false), settings(undefined)]) {
      expect(markup).not.toContain('/admin/invitations');
      expect(text(markup)).not.toContain(t(locale, 'settings.admin.title'));
    }
  });
});
