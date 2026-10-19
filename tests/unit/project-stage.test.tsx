import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ProjectOverview} from '@/components/projects/project-overview';
import {toneShapes} from '@/components/ui/status-badge';
import {catalogs, locales, translate} from '@/lib/i18n';
import {I18nProvider} from '@/lib/i18n/react';
import {fixtureRows, projectFixtures} from '@/lib/project-fixtures';
import {isProjectStage, nextActionDestination, projectStages, stageDefinition, stageDefinitions, type StageDefinition} from '@/lib/project-stage';
import {AnnouncerProvider} from '@/components/ui/announcer';

// Story 1.7 (AC-2): the stages. Every Project stage has a word, a shape of its own and a sentence that names the next thing to do; a
// stage whose page does not exist yet has no destination, and its next action is text and not a link. Story 2.1 added the first stage,
// `request_confirmed` (the person confirmed what they asked for, and nothing has started or been charged): seven in all. Story 2.2 added one
// before it, `request_draft` (the pictures are saved privately and nothing is confirmed yet): eight in all.
describe('the eight stages', () => {
  it('are the eight the database allows, in the order a Project moves through them', () => {
    expect([...projectStages]).toEqual(['request_draft', 'request_confirmed', 'researching', 'awaiting_plan_approval', 'generating', 'awaiting_model_approval', 'validation_failed', 'export_ready']);
    expect(Object.keys(stageDefinitions)).toEqual([...projectStages]);
  });

  it('covers awaiting Model Approval and Export ready in words, in both languages', () => {
    expect(translate('en', stageDefinition('awaiting_model_approval').label)).toBe('Awaiting Model Approval');
    expect(translate('en', stageDefinition('export_ready').label)).toBe('Export ready');
    for (const stage of projectStages) {
      for (const locale of locales) {
        for (const key of [stageDefinition(stage).label, stageDefinition(stage).nextAction]) expect(catalogs[locale][key], `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  it('gives each stage its own word and its own shape: no two share either, and every shape is a drawn icon', () => {
    for (const locale of locales) {
      const words = projectStages.map((stage) => translate(locale, stageDefinition(stage).label));
      expect(new Set(words).size, locale).toBe(projectStages.length);
    }
    const shapes = projectStages.map((stage) => stageDefinition(stage).icon);
    expect(new Set(shapes).size).toBe(projectStages.length);
    for (const stage of projectStages) expect(Object.keys(toneShapes), stage).toContain(stageDefinition(stage).tone);
  });

  it('names the next required action for each stage in a sentence of its own', () => {
    for (const locale of locales) {
      const sentences = projectStages.map((stage) => translate(locale, stageDefinition(stage).nextAction));
      expect(new Set(sentences).size, locale).toBe(projectStages.length);
      for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(20);
    }
  });

  it('has a destination only for request_draft, the review of the pictures (Story 2.3): until the story that owns a page registers one, the next action is words and no link', () => {
    for (const stage of projectStages) {
      if (stage === 'request_draft') continue;
      expect(stageDefinition(stage).destination, stage).toBeNull();
      expect(nextActionDestination(stage, 'any-id'), stage).toBeNull();
    }
    // Story 2.3 gives the stage its destination on purpose: the review of the pictures, built from the Project's ID.
    expect(stageDefinition('request_draft').destination).toBeTypeOf('function');
    expect(nextActionDestination('request_draft', 'abc')).toBe('/projects/abc/pictures/review');
  });

  it('gives a link only to a stage that has registered a destination, built from the Project\'s ID', () => {
    const registered: Record<(typeof projectStages)[number], StageDefinition> = {...stageDefinitions, generating: {...stageDefinitions.generating, destination: (id) => `/projects/${id}/progress`}};
    expect(nextActionDestination('generating', 'abc', registered)).toBe('/projects/abc/progress');
    expect(nextActionDestination('researching', 'abc', registered)).toBeNull();
  });

  it('recognises exactly the eight words', () => {
    for (const stage of projectStages) expect(isProjectStage(stage)).toBe(true);
    for (const other of ['', 'draft', 'Researching', 'export-ready', null, undefined, 3, {}]) expect(isProjectStage(other), String(other)).toBe(false);
  });
});

describe('the fixtures', () => {
  it('hold one Project for each of the eight stages, and no more', () => {
    // The new stages' fixtures come last (Story 2.1's, then Story 2.2's), so the sample cards and the seeded lists of Story 1.7 keep their order.
    expect(projectFixtures.map((fixture) => fixture.stage)).toEqual([...projectStages.slice(2), 'request_confirmed', 'request_draft']);
    expect([...projectFixtures.map((fixture) => fixture.stage)].sort()).toEqual([...projectStages].sort());
    expect(new Set(projectFixtures.map((fixture) => fixture.key)).size).toBe(projectFixtures.length);
    expect(new Set(projectFixtures.map((fixture) => fixture.title)).size).toBe(projectFixtures.length);
  });

  it('are valid titles and Versions, with a Hebrew one among them', () => {
    for (const fixture of projectFixtures) {
      expect(fixture.title).toBe(fixture.title.trim());
      expect([...fixture.title].length).toBeGreaterThan(0);
      expect(fixture.title).not.toMatch(/\p{Cc}/u);
      expect(Number.isInteger(fixture.currentVersion) && fixture.currentVersion >= 0).toBe(true);
    }
    expect(projectFixtures.some((fixture) => /[֐-׿]/.test(fixture.title))).toBe(true);
  });

  it('become rows with fixed IDs and times, newest first, that a page renders the same on the server and in the browser', () => {
    const rows = fixtureRows();
    expect(fixtureRows()).toEqual(rows);
    expect(rows.map((row) => row.updatedAt)).toEqual([...rows.map((row) => row.updatedAt)].sort().reverse());
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    for (const row of rows) expect(row).toMatchObject({revision: 1});
  });
});

describe('the overview shows every stage (AC-2)', () => {
  const render = (locale: 'en' | 'he', row: ReturnType<typeof fixtureRows>[number]) =>
    renderToStaticMarkup(<I18nProvider locale={locale}><AnnouncerProvider><ProjectOverview project={row}/></AnnouncerProvider></I18nProvider>);
  const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

  it.each(locales)('names the stage, the Version, the next action, and the Model and Sources entries for each stage, in %s', (locale) => {
    for (const row of fixtureRows()) {
      const markup = render(locale, row);
      const words = text(markup);
      expect(words).toContain(translate(locale, stageDefinition(row.stage).label));
      expect(words).toContain(translate(locale, stageDefinition(row.stage).nextAction));
      expect(words).toContain(row.currentVersion > 0 ? translate(locale, 'project.version', {version: row.currentVersion}) : translate(locale, 'project.versionNone'));
      expect(markup).toContain(`<bdi>${row.title}</bdi>`);
      expect(words).toContain(translate(locale, 'project.model.title'));
      // Sources is a link to the Project's own Sources page.
      expect(markup).toContain(`href="/projects/${row.id}/sources"`);
      // The status badge draws its own shape.
      expect(markup).toContain(`<span class="status-badge tone-${stageDefinition(row.stage).tone}"><svg`);
    }
  });

  it('renders a null destination as text, never as a link: the only links on the page are Sources and the shell\'s own (request_draft links to its review)', () => {
    for (const row of fixtureRows()) {
      const markup = render('en', row);
      const links = [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
      if (row.stage === 'request_draft') {
        // Story 2.3: the stage's next action is a link to the review of the pictures.
        expect(markup).not.toContain(translate('en', 'project.nextNoPage'));
        expect(markup).toContain(translate('en', 'project.nextLink'));
        expect(links).toEqual([`/projects/${row.id}/pictures/review`, `/projects/${row.id}/sources`]);
        continue;
      }
      expect(markup).toContain(translate('en', 'project.nextNoPage'));
      expect(markup).not.toContain(translate('en', 'project.nextLink'));
      expect(links).toEqual([`/projects/${row.id}/sources`]);
    }
  });
});
