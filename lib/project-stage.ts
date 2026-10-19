// Story 1.7. The stages a Project can be in, and what each one says: a word (never colour alone: every stage also has its
// own shape), a sentence that names the next thing the person has to do, and where that is done. Story 1.7 had six; Story 2.1 adds the
// first, `request_confirmed`: the person has confirmed what they asked for, and nothing has started or been charged. Story 2.2 adds one before it,
// `request_draft`: pictures are saved privately and the request is not confirmed yet (choosing how to use them and confirming arrive later).
//
// The stages are set by the stories that own them (the request is Story 2.1, research is Epic 3, generation Epic 4, approval and export
// later ones); this story only reads and shows them. A stage's `destination` is where its next required action is done. It is null until the
// story that owns that page registers a route here (a stage with a function in its row gets a link; the others get text). A
// null destination is rendered as words and never as a link: a link to a page that does not exist is a dead end, and a dead
// end is a lie about what the person can do.
//
// Like the other modules a worker or a script may load, this one has only erasable TypeScript syntax and no runtime imports
// (scripts/seed-projects.mjs reads it through Node type stripping); the types it names are imported with `import type`.
import type {IconName} from '../components/ui/icon.tsx';
import type {StatusTone} from '../components/ui/status-badge.tsx';
import type {MessageKey} from './i18n/index.ts';

export const projectStages = [
  'request_draft',
  'request_confirmed',
  'researching',
  'awaiting_plan_approval',
  'generating',
  'awaiting_model_approval',
  'validation_failed',
  'export_ready',
] as const;
export type ProjectStage = (typeof projectStages)[number];

/** Whether a value is one of the stages (the database's own word for each). */
export function isProjectStage(value: unknown): value is ProjectStage {
  return typeof value === 'string' && (projectStages as readonly string[]).includes(value);
}

export type StageDefinition = {
  /** The stage in words: "Request confirmed", "Researching", "Awaiting Model Approval", "Export ready". */
  label: MessageKey;
  /** One sentence naming what happens next or what the person has to do. */
  nextAction: MessageKey;
  /** The colour family of the stage's badge; the shape below and the word above carry the meaning as well. */
  tone: StatusTone;
  /** The stage's own shape: no two stages share one. */
  icon: IconName;
  /** Which of the card's three pictures frames the project. Decoration only. */
  visual: 'violet' | 'blue' | 'amber';
  /** The page where the next required action is done, or null until the story that owns it registers one. */
  destination: ((projectId: string) => string) | null;
};

export const stageDefinitions: Record<ProjectStage, StageDefinition> = {
  // The pictures are saved and the request is not confirmed. Choosing how to use them (Story 2.3) and confirming arrive later and own the next step, so there is no destination.
  request_draft: {label: 'stage.request_draft.label', nextAction: 'stage.request_draft.next', tone: 'info', icon: 'image', visual: 'blue', destination: null},
  // Nothing owns the next step yet (research arrives with Epic 3, and asks for its own permission), so there is no destination.
  request_confirmed: {label: 'stage.request_confirmed.label', nextAction: 'stage.request_confirmed.next', tone: 'neutral', icon: 'text', visual: 'violet', destination: null},
  researching: {label: 'stage.researching.label', nextAction: 'stage.researching.next', tone: 'running', icon: 'search', visual: 'amber', destination: null},
  awaiting_plan_approval: {label: 'stage.awaiting_plan_approval.label', nextAction: 'stage.awaiting_plan_approval.next', tone: 'info', icon: 'doc', visual: 'violet', destination: null},
  generating: {label: 'stage.generating.label', nextAction: 'stage.generating.next', tone: 'running', icon: 'spark', visual: 'amber', destination: null},
  awaiting_model_approval: {label: 'stage.awaiting_model_approval.label', nextAction: 'stage.awaiting_model_approval.next', tone: 'info', icon: 'grid', visual: 'violet', destination: null},
  validation_failed: {label: 'stage.validation_failed.label', nextAction: 'stage.validation_failed.next', tone: 'danger', icon: 'x-octagon', visual: 'amber', destination: null},
  export_ready: {label: 'stage.export_ready.label', nextAction: 'stage.export_ready.next', tone: 'success', icon: 'check-circle', visual: 'blue', destination: null},
};

export function stageDefinition(stage: ProjectStage): StageDefinition {
  return stageDefinitions[stage];
}

/**
 * Where the next required action of a Project in this stage is done, or null when its stage has no page yet (the page then says
 * the action in words and offers no link). `definitions` is a parameter only so a test can register a destination without
 * waiting for the story that owns it.
 */
export function nextActionDestination(stage: ProjectStage, projectId: string, definitions: Record<ProjectStage, StageDefinition> = stageDefinitions): string | null {
  const destination = definitions[stage].destination;
  return destination ? destination(projectId) : null;
}
