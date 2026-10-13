import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {KitContent} from '@/components/kit/kit-content';
import {NovaDashboard} from '@/components/nova-dashboard';
import {Shell} from '@/components/shell/shell';
import {AnnouncerProvider} from '@/components/ui/announcer';
import {catalogs, locales} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {healthSummary} from '@/lib/mock-data';
import {fixtureRows, projectFixtures} from '@/lib/project-fixtures';

// Story 1.7: the shell stops saying it is a sample, because it no longer is. Home, My Projects and In Progress read the signed-in
// Account's own Projects; the banner, the mode card, the sample date, the sample Account name, the sample notification and the
// activity list are gone. What stays synthetic is said where it is: the design kit (/kit) and the health summary.
const render = (element: React.ReactNode, locale: 'en' | 'he' = 'en') => renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider>{element}</AnnouncerProvider></I18nProvider>);
const empty = {state: 'listed' as const, projects: [], total: 0};
const none = {
  home: <Shell pathname="/" accountAddress="person@example.com"><NovaDashboard view="home" listing={empty}/></Shell>,
  projects: <Shell pathname="/projects" accountAddress="person@example.com"><NovaDashboard view="projects" listing={empty}/></Shell>,
  progress: <Shell pathname="/progress" accountAddress="person@example.com"><NovaDashboard view="progress"/></Shell>,
  'create panel': <Shell pathname="/" initialCreateOpen><NovaDashboard view="home" listing={empty}/></Shell>,
  'notifications popover': <Shell pathname="/" initialNoticeOpen><NovaDashboard view="home" listing={empty}/></Shell>,
};

describe.each(locales)('the real shell makes no sample claim, in %s', (locale) => {
  describe.each(Object.entries(none))('%s', (_name, element) => {
    const markup = render(element, locale);

    it('has no synthetic banner, mode card or note landmark', () => {
      expect(markup).not.toContain('synthetic-banner');
      expect(markup).not.toContain('mode-card');
      expect(markup).not.toContain('role="note"');
      for (const key of ['shell.syntheticBadge', 'shell.syntheticNote', 'shell.modeTitle', 'shell.modeCopy']) expect((catalogs[locale] as Record<string, unknown>)[key], key).toBeUndefined();
    });

    it('shows none of the sample content', () => {
      // The sample date, the sample Account name, the greeting, the sample notification and the activity list are not catalog keys any more.
      for (const key of ['sample.date', 'home.greeting', 'account.sampleName', 'notifications.sampleTitle', 'home.activityTitle', 'home.noticeLead']) {
        expect((catalogs[locale] as Record<string, unknown>)[key], key).toBeUndefined();
      }
      for (const fixture of projectFixtures) expect(markup).not.toContain(fixture.title);
      expect(markup).not.toMatch(/Josh|Good morning|Synthetic|Sample/i);
      expect(markup).not.toContain('>SAMPLE<');
      expect(markup).not.toContain('class="activity');
    });
  });
});

describe.each(locales)('the Account panel and the notifications, in %s', (locale) => {
  const panel = (address: string | null) =>
    render(<Shell pathname="/" accountAddress={address} initialAccountOpen><NovaDashboard view="home" listing={empty}/></Shell>, locale);

  it('shows the verified Google address, as text, inside the left-to-right token, with its initial, and no name', () => {
    const markup = panel('noa+x@example.com');
    // The panel is open: the address is in the panel, in the one token that reads left to right whatever the language.
    expect(markup).toContain('<strong><bdi dir="ltr" class="ltr-token">noa+x@example.com</bdi></strong>');
    expect(markup).toContain('<span class="avatar" aria-hidden="true">N</span>');
    expect(markup).toContain(catalogs[locale]['account.signedInWith'] as string);
    expect(markup).not.toMatch(/Josh|Sample|sample/);
    // And the Account menu's button is the one that opened it.
    expect(markup).toMatch(new RegExp(`aria-label="${catalogs[locale]['nav.account'] as string}" aria-expanded="true"`));
  });

  it('puts an address in the page as text, never as markup', () => {
    const markup = panel('a<b>@example.com');
    expect(markup).not.toContain('<b>');
    expect(markup).toContain('<bdi dir="ltr" class="ltr-token">a&lt;b&gt;@example.com</bdi>');
  });

  it('says only that the person is signed in, with a person shape instead of an initial, when there is no address to show', () => {
    const markup = panel(null);
    expect(markup).toContain(`<strong>${catalogs[locale]['account.signedIn'] as string}</strong>`);
    expect(markup).not.toContain('ltr-token">');
    expect(markup).toMatch(/<span class="avatar" aria-hidden="true"><svg/);
  });

  it('is closed, and shows no address at all, until the menu is opened', () => {
    const markup = render(<Shell pathname="/" accountAddress="noa@example.com"><NovaDashboard view="home" listing={empty}/></Shell>, locale);
    expect(markup).not.toContain('noa@example.com');
    expect(markup).not.toContain('class="account-card"');
  });

  it('has notifications that are an honest empty state with no count and no dot', () => {
    const markup = render(<Shell pathname="/" initialNoticeOpen><NovaDashboard view="home" listing={empty}/></Shell>, locale);
    expect(markup).toContain(catalogs[locale]['notifications.emptyTitle'] as string);
    expect(markup).toContain(catalogs[locale]['notifications.emptyBody'] as string);
    expect(markup).not.toContain('notification-dot');
    expect(markup).not.toMatch(/unread|שלא נקראו/i);
  });
});

describe('what stays synthetic says so', () => {
  it('keeps the design kit and its sample cards, fed by the fixtures', () => {
    const markup = render(<KitContent/>);
    expect(markup).toContain('Synthetic sample data');
    expect(markup).toContain('>SAMPLE<');
    const [first, second] = fixtureRows();
    expect(markup).toContain(`<bdi>${first.title}</bdi>`);
    expect(markup).toContain(`<bdi>${second.title}</bdi>`);
  });

  it('keeps the health summary exactly as it was', () => {
    expect(healthSummary).toEqual({appMode: 'synthetic-shell', providerCall: false, authConfigured: false, syntheticData: true});
  });
});
