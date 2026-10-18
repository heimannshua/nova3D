// Story 1.7. Sample Projects, one for each of the stages (six in Story 1.7, seven since Story 2.1 added `request_confirmed`), for the design kit (/kit), the unit tests and the local seed
// (scripts/seed-projects.mjs). They are NOT real data for any Account: no page reads this file for a signed-in person, whose
// Projects come from the database and from nowhere else. Until the stories that own the stages exist (research is Epic 3,
// generation Epic 4, approval and export later ones), this is how every stage is seen at all.
//
// Only erasable TypeScript syntax and no runtime imports, so the seed script can load it through Node type stripping.
import type {ProjectStage} from './project-stage.ts';
import type {ProjectRow} from './project-view.ts';

export type ProjectFixture = {
  /** A stable name for tests and for the seed (which skips a fixture whose title the Account already has). */
  key: string;
  title: string;
  stage: ProjectStage;
  currentVersion: number;
};

export const projectFixtures: readonly ProjectFixture[] = [
  {key: 'courtyard-bench', title: 'Courtyard bench', stage: 'researching', currentVersion: 0},
  {key: 'garden-arch', title: 'Garden arch study', stage: 'awaiting_plan_approval', currentVersion: 0},
  {key: 'ramp', title: 'Ramp and landing', stage: 'generating', currentVersion: 1},
  // Hebrew on purpose: a title is the person's own words in any language, whatever language the page is in.
  {key: 'outer-altar', title: 'המזבח החיצון והכבש', stage: 'awaiting_model_approval', currentVersion: 2},
  {key: 'stair-rail', title: 'Stair rail bracket', stage: 'validation_failed', currentVersion: 3},
  {key: 'reading-lamp', title: 'Reading lamp base', stage: 'export_ready', currentVersion: 4},
  // Story 2.1's stage comes first in a Project's life but last here, so the sample cards and the seeded lists Story 1.7 made keep their order.
  {key: 'workshop-door', title: 'Workshop door handle', stage: 'request_confirmed', currentVersion: 0},
];

/** The moment the fixtures' update times count back from: a fixed one, so a page that renders them says the same on the server and in the browser. */
export const fixtureTime = new Date('2026-09-14T09:30:00.000Z');

/** The fixtures as the rows a page shows them, with IDs a test or the kit can rely on and update times one day apart, newest first, so the order is the list's own. */
export function fixtureRows(now: Date = fixtureTime): ProjectRow[] {
  return projectFixtures.map((fixture, index) => {
    const updated = new Date(now.getTime() - index * 86_400_000).toISOString();
    return {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: fixture.title,
      stage: fixture.stage,
      currentVersion: fixture.currentVersion,
      revision: 1,
      createdAt: updated,
      updatedAt: updated,
    };
  });
}
