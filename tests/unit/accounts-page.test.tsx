import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {AccountList, messageFor} from '@/components/admin/account-list';
import {AccountsContent} from '@/components/admin/accounts-content';
import {AdminContent} from '@/components/admin/admin-content';
import type {AccountActionState, AccountRow} from '@/lib/account-admin';
import type {Confirmation} from '@/lib/administration';
import {createTranslator, locales, translate, type Locale, type MessageKey} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';

// Story 1.5: the Administrator's Accounts page and the Administration index, rendered to markup in both languages. What needs a
// browser (the dialogs, focus, the live regions, the Server Actions) is in tests/e2e/accounts.spec.ts.
const ENABLED_NAMED: AccountRow = {accountId: '11111111-1111-4111-8111-111111111111', email: 'dana@example.com', invitationKind: 'named', invitationLabel: 'Dana', role: 'member', status: 'active', createdAt: '2026-10-12T00:24:11.123456+00:00'};
const DISABLED_GENERAL: AccountRow = {accountId: '22222222-2222-4222-8222-222222222222', email: 'noa+<ben>@example.com', invitationKind: 'general', invitationLabel: null, role: 'member', status: 'disabled', createdAt: '2026-10-11T09:00:00+00:00'};
const ADMINISTRATOR: AccountRow = {accountId: '33333333-3333-4333-8333-333333333333', email: 'josh@example.com', invitationKind: null, invitationLabel: null, role: 'administrator', status: 'active', createdAt: '2026-10-09T09:00:00+00:00'};
const NO_ADDRESS: AccountRow = {accountId: '44444444-4444-4444-8444-444444444444', email: null, invitationKind: 'named', invitationLabel: null, role: 'member', status: 'active', createdAt: 'not a time'};

const render = (locale: Locale, accounts: AccountRow[] | null, confirmation: Confirmation = 'confirmed') =>
  renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <AccountsContent accounts={accounts} confirmation={confirmation}/>
    </I18nProvider>,
  );
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const t = (locale: Locale, key: MessageKey, params?: Record<string, string | number>) => translate(locale, key, params);

describe.each(locales)('the Accounts page in %s', (locale) => {
  const all = [ENABLED_NAMED, DISABLED_GENERAL, ADMINISTRATOR];
  const markup = render(locale, all);

  it('has one level-one heading and one section, the list of Accounts', () => {
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    expect(text(markup)).toContain(t(locale, 'accounts.title'));
    const headings = [...markup.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim());
    expect(headings).toEqual([t(locale, 'accounts.list.title')]);
  });

  it('lists every Account as it was given, each with its address, role, invitation, status and time', () => {
    const items = [...markup.matchAll(/<li class="invite-item account-item">([\s\S]*?)<\/li>/g)].map((match) => match[1]);
    expect(items).toHaveLength(all.length);
    const words = items.map(text);
    expect(words[0]).toContain('dana@example.com');
    expect(words[0]).toContain(t(locale, 'accounts.row.role.member'));
    expect(words[0]).toContain('Dana');
    expect(words[0]).toContain(t(locale, 'accounts.status.active'));
    expect(words[1]).toContain(t(locale, 'accounts.row.invitation.general'));
    expect(words[1]).toContain(t(locale, 'accounts.status.disabled'));
    expect(words[2]).toContain(t(locale, 'accounts.row.role.administrator'));
    expect(words[2]).toContain(t(locale, 'accounts.row.invitation.none'));
    expect(markup).toContain('<time dateTime="2026-10-12T00:24:11.123Z">2026-10-12 00:24 UTC</time>');
  });

  it('puts an address in the page as text, never as markup, and keeps it left to right', () => {
    expect(markup).not.toContain('<ben>');
    expect(markup).toContain('noa+&lt;ben&gt;@example.com');
    expect(markup).toMatch(/<bdi[^>]*dir="ltr"[^>]*class="ltr-token"[^>]*>noa\+&lt;ben&gt;@example\.com<\/bdi>|<bdi[^>]*class="ltr-token"[^>]*dir="ltr"[^>]*>noa\+&lt;ben&gt;@example\.com<\/bdi>/);
  });

  it('gives every status a word and a shape, never a colour alone', () => {
    for (const state of ['active', 'disabled'] as const) {
      const badges = [...markup.matchAll(/<span class="status-badge tone-[a-z-]+">(<svg[\s\S]*?<\/svg>)<span>(.*?)<\/span><\/span>/g)].filter((match) => match[2] === t(locale, `accounts.status.${state}`));
      expect(badges.length, state).toBeGreaterThan(0);
      for (const badge of badges) expect(badge[1]).toContain('aria-hidden="true"');
    }
    const tones = Object.fromEntries([...markup.matchAll(/<span class="status-badge (tone-[a-z-]+)">[\s\S]*?<span>(.*?)<\/span><\/span>/g)].map((match) => [match[2], match[1]]));
    expect(tones[t(locale, 'accounts.status.active')]).toBe('tone-success');
    expect(tones[t(locale, 'accounts.status.disabled')]).toBe('tone-warning');
  });

  it('offers Disable for an enabled member, Re-enable for a disabled one and neither for the Administrator, and names which Account it changes', () => {
    const buttons = [...markup.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)].map((match) => match[1].replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(buttons).toEqual([t(locale, 'accounts.row.disableLabel', {name: 'dana@example.com'}), t(locale, 'accounts.row.enableLabel', {name: 'noa+<ben>@example.com'})]);
    // The visible word is inside the accessible name.
    expect(buttons[0]).toContain(t(locale, 'accounts.row.disable'));
    expect(buttons[1]).toContain(t(locale, 'accounts.row.enable'));
    const administrator = [...markup.matchAll(/<li class="invite-item account-item">([\s\S]*?)<\/li>/g)].map((match) => match[1])[2];
    expect(administrator).not.toContain('<button');
    expect(text(administrator)).toContain(t(locale, 'accounts.row.administratorNote'));
  });

  it('carries only the Account\'s ID in each form, as a hidden field', () => {
    expect(markup).toContain(`name="accountId" value="${ENABLED_NAMED.accountId}"`);
    expect(markup).toContain(`name="accountId" value="${DISABLED_GENERAL.accountId}"`);
    expect(markup).not.toContain(`value="${ADMINISTRATOR.accountId}"`);
    expect(markup.match(/<input type="hidden"/g)).toHaveLength(2);
  });

  it('shows nothing of a Workspace: no project, file or usage', () => {
    // The words the page uses to say it shows none are fine; what must not exist is a column or a figure for them.
    expect(markup).not.toMatch(/class="[^"]*(?:workspace|project|usage)/i);
    expect(markup).not.toMatch(/<dt>[^<]*(?:project|usage|file|פרויקט|קבצ|שימוש)/i);
  });

  it('holds no confirmation dialog, no alert and no outcome message until something is done', () => {
    expect(markup).not.toContain('<dialog');
    expect(markup).not.toContain('role="alert"');
  });

  it('says the list could not be loaded, and nothing about the Accounts, when it could not', () => {
    const failed = render(locale, null);
    expect(text(failed)).toContain(t(locale, 'accounts.list.error.title'));
    expect(failed).toContain('role="alert"');
    expect(failed).not.toContain('invite-item');
    expect(failed).not.toContain('<button');
  });

  it('says there are no Accounts when there are none', () => {
    const empty = render(locale, []);
    expect(text(empty)).toContain(t(locale, 'accounts.list.empty.title'));
  });

  it('stands in for an address that Auth no longer vouches for, and an unreadable time, instead of breaking', () => {
    const odd = render(locale, [NO_ADDRESS]);
    expect(text(odd)).toContain(t(locale, 'accounts.row.noAddress'));
    expect(odd).not.toContain('<time');
    expect(text(odd)).toContain(t(locale, 'accounts.row.disableLabel', {name: t(locale, 'accounts.row.noAddress')}).slice(0, 4));
  });

  it('says a fresh sign-in is confirmed, or offers the step-up beforehand, and says nothing when it cannot tell', () => {
    expect(text(render(locale, all, 'confirmed'))).toContain(t(locale, 'accounts.confirm.ok'));
    expect(render(locale, all, 'confirmed')).toContain('notice-success');
    const needed = render(locale, all, 'needed');
    expect(text(needed)).toContain(t(locale, 'accounts.confirm.needed'));
    expect(needed).toMatch(/<a [^>]*href="\/step-up\?for=administration"[^>]*>/);
    expect(needed).not.toContain('notice-success');
    const unknown = render(locale, all, 'unknown');
    expect(unknown).not.toContain('notice-success');
    expect(unknown).not.toContain('notice-warning');
    expect(unknown).not.toContain('/step-up');
  });
});

describe.each(locales)('the Administration index in %s', (locale) => {
  const render = (confirmation: Confirmation) =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <AdminContent confirmation={confirmation}/>
      </I18nProvider>,
    );

  it('links to Invitation codes, to Accounts and (Story 1.13) to Operations, each in a section of its own, and to nothing else', () => {
    const markup = render('needed');
    expect(markup.match(/<h1\b/g)).toHaveLength(1);
    const headings = [...markup.matchAll(/<h2\b[^>]*>(.*?)<\/h2>/g)].map((match) => text(match[1]).trim());
    expect(headings).toEqual([t(locale, 'admin.invitations.title'), t(locale, 'admin.accounts.title'), t(locale, 'admin.operations.title')]);
    const links = [...markup.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((match) => match[1]);
    expect(links).toEqual(['/admin/invitations', '/admin/accounts', '/admin/operations']);
    expect(text(markup)).toContain(t(locale, 'admin.invitations.open'));
    expect(text(markup)).toContain(t(locale, 'admin.accounts.open'));
    expect(text(markup)).toContain(t(locale, 'admin.operations.open'));
    expect(text(markup)).toContain(t(locale, 'admin.operations.help'));
  });

  it('says the person has just confirmed it is them, which is where the step-up returns, and says nothing otherwise', () => {
    expect(text(render('confirmed'))).toContain(t(locale, 'admin.confirm.ok'));
    for (const confirmation of ['needed', 'unknown'] as const) {
      expect(render(confirmation)).not.toContain('notice');
      expect(render(confirmation)).not.toContain('/step-up');
    }
  });
});

describe.each(locales)('the Administration index after a recovery (Story 1.6) in %s', (locale) => {
  const render = (recovered: number | null | undefined, confirmation: Confirmation = 'confirmed') =>
    renderToStaticMarkup(
      <I18nProvider locale={locale}>
        <AdminContent confirmation={confirmation} recovered={recovered}/>
      </I18nProvider>,
    );

  it('says nothing about a recovery when there was none', () => {
    for (const recovered of [null, undefined]) {
      expect(render(recovered)).not.toContain(t(locale, 'admin.recovered.none'));
      expect(text(render(recovered))).not.toContain(text(t(locale, 'admin.recovered', {count: 2})));
    }
  });

  it.each([1, 2, 5])('says, as a status and not an alert, that the person is back in and how many other sessions were signed out: %i', (count) => {
    const markup = render(count);
    expect(text(markup)).toContain(t(locale, 'admin.recovered', {count}));
    expect(markup).toMatch(/<div class="notice notice-success" role="status">[\s\S]*?<\/div>/);
    expect(markup).not.toContain('role="alert"');
  });

  it('says there were none to sign out when there were none', () => {
    expect(text(render(0))).toContain(t(locale, 'admin.recovered.none'));
  });

  it('comes before the notice that the person has confirmed it is them, which the recovered session holds too', () => {
    const markup = render(2, 'confirmed');
    expect(markup.indexOf('notice-success')).toBeLessThan(markup.lastIndexOf('notice-success'));
    expect(text(markup).indexOf(t(locale, 'admin.recovered', {count: 2}))).toBeLessThan(text(markup).indexOf(t(locale, 'admin.confirm.ok')));
  });

  it('shows only the number it is given, as text: it grants nothing', () => {
    expect(render(7)).not.toMatch(/recovered=|href="[^"]*recovered/);
  });
});

describe('what a finished action says above the list', () => {
  const states: [string, AccountActionState][] = [
    ['disabled', {outcome: 'disabled', sessionsEnded: 2, jobsCancelled: 3, cancellationsFailed: 0}],
    ['enabled', {outcome: 'enabled'}],
    ['already_disabled', {outcome: 'already_disabled'}],
    ['already_enabled', {outcome: 'already_enabled'}],
    ['administrator', {outcome: 'administrator'}],
    ['not_found', {outcome: 'not_found'}],
  ];

  it.each(locales)('has a message in %s for each answer that changes or explains the list, and none for any other', (locale) => {
    const say = createTranslator(locale);
    for (const [name, state] of states) {
      const message = messageFor(state, 'dana@example.com', say);
      expect(message, name).not.toBeNull();
      expect(message!.text.length, name).toBeGreaterThan(0);
    }
    for (const state of [{outcome: 'idle'}, {outcome: 'refused', stepUp: true}, {outcome: 'refused', stepUp: false}, {outcome: 'denied'}, {outcome: 'unavailable', unknown: true}, {outcome: 'unavailable', unknown: false}] as AccountActionState[]) {
      expect(messageFor(state, 'dana@example.com', say), state.outcome).toBeNull();
    }
  });

  it('says a disable in English with the Account, the sessions that ended and the Jobs that were cancelled', () => {
    const say = createTranslator('en');
    const done = messageFor({outcome: 'disabled', sessionsEnded: 2, jobsCancelled: 3, cancellationsFailed: 0}, 'dana@example.com', say)!;
    expect(done.tone).toBe('success');
    expect(done.text.replace(/[⁨⁩]/g, '')).toBe('dana@example.com is now disabled. 2 sessions were ended. 3 jobs were cancelled.');
    const one = messageFor({outcome: 'disabled', sessionsEnded: 1, jobsCancelled: 0, cancellationsFailed: 0}, 'dana@example.com', say)!;
    expect(one.text.replace(/[⁨⁩]/g, '')).toBe('dana@example.com is now disabled. 1 session was ended. 0 jobs were cancelled.');
    const none = messageFor({outcome: 'disabled', sessionsEnded: 0, jobsCancelled: 0, cancellationsFailed: 0}, 'dana@example.com', say)!;
    expect(none.text).toContain('0 sessions were ended.');
  });

  it('adds that a canceller did not finish, and that those Jobs cannot publish anyway, when one did not', () => {
    const say = createTranslator('en');
    const partial = messageFor({outcome: 'disabled', sessionsEnded: 1, jobsCancelled: 1, cancellationsFailed: 2}, 'dana@example.com', say)!;
    expect(partial.text).toContain(say('accounts.disable.cancelFailed'));
    expect(partial.text).toMatch(/cannot publish anything/);
  });

  it('says a re-enable, and which are only information or a warning', () => {
    const say = createTranslator('en');
    expect(messageFor({outcome: 'enabled'}, 'dana@example.com', say)).toMatchObject({tone: 'success'});
    expect(messageFor({outcome: 'already_disabled'}, 'dana@example.com', say)).toMatchObject({tone: 'info'});
    expect(messageFor({outcome: 'already_enabled'}, 'dana@example.com', say)).toMatchObject({tone: 'info'});
    expect(messageFor({outcome: 'administrator'}, 'dana@example.com', say)).toMatchObject({tone: 'warning'});
    expect(messageFor({outcome: 'not_found'}, 'dana@example.com', say)).toMatchObject({tone: 'warning'});
  });

  it('is rendered above the list, as a notice', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider locale="en">
        <AccountList accounts={[ENABLED_NAMED]} message={{tone: 'success', text: 'Done.'}} onMessage={() => undefined}/>
      </I18nProvider>,
    );
    expect(markup.indexOf('notice-success')).toBeGreaterThan(markup.indexOf('<h2'));
    expect(markup.indexOf('notice-success')).toBeLessThan(markup.indexOf('invite-list'));
  });
});

describe('the Hebrew words for disabling an Account and for cancelling', () => {
  it('keep "ביטול" for the Cancel button, and use another word for disabling an Account', () => {
    const cancel = translate('he', 'confirm.cancel');
    expect(cancel).toBe('ביטול');
    for (const key of ['accounts.row.disable', 'accounts.row.disableLabel', 'accounts.disable.title', 'accounts.disable.confirm', 'accounts.disable.pending', 'accounts.status.disabled'] as const) {
      expect(translate('he', key), key).not.toMatch(/בטל|בוטל|ביטול/);
      expect(translate('he', key), key).toMatch(/השבת|השבית|מושבת|משביתים/);
    }
  });
});
