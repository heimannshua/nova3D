'use server';

import {redirect} from 'next/navigation';
import {homePath} from '@/lib/access';
import {AccountsConfigError, AccountsUnavailableError} from '@/lib/accounts';
import {withActiveAccount} from '@/lib/auth';
import {operationOf} from '@/lib/authority';
import {withinBudget} from '@/lib/deadline';
import {defaultDomainRegistry} from '@/lib/domain-registry';
import {commandIdOf, projectPath} from '@/lib/project-view';
import {createProjectRequest} from '@/lib/projects';
import {checkRequest, classifyPersonalization, fieldText, understand} from '@/lib/request-intake';
import type {ConfirmState, SubjectView, UnderstandState} from '@/lib/request-view';

// Confirm a natural-language request (Story 2.1): the two Server Actions behind C-02 and C-06, in the pattern of the rename action
// (app/projects/actions.ts). Both are behind `withActiveAccount`, which asks for the live authorization itself, every time, so neither
// trusts the page that rendered the form: an Account that is disabled, a session that was revoked or an epoch that is stale is sent where
// any private request is sent. The Account is the verified access's (`operationOf(access.account)`), never a form field.
//
//   understandRequest   FREE and stores nothing: matches the description against the registered subjects and maps the personalization wording
//                       to the one supported kind (lib/request-intake.ts). The matching reads no database and calls no model or network; it only
//                       says what was understood. (The gate, `withActiveAccount`, asks for the live authorization first, as for every action.)
//   confirmRequest      the one command that stores anything. It RECOMPUTES everything from the submitted fields (the description, the
//                       subject the person chose, the scope and outcome they edited, the wording) and trusts nothing the client says it
//                       understood: the subject must be a match for the description, the title is the subject's display name from the
//                       registry, and the wish is classified here. Then ONE database transaction creates the Project and its first revision.
//                       Confirming starts nothing, approves nothing and spends nothing: no Job, no permission, no cost.
//
// A command ID is chosen once by the client for each distinct request; sent again with the same payload (a retry after an answer was lost)
// the database answers the original receipt, so a retry creates at most one Project. This file prints only the name and message of an
// error, which never contain a description, a scope, a title or an ID.

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

const subjectView = (subject: {id: string; displayName: string}): SubjectView => ({id: subject.id, displayName: subject.displayName});

/** What the registered subjects say about a described request, and what the wish means. Free: its matching makes no database call (the gate's authorization check, first, does). */
export async function understandRequest(_previous: UnderstandState, formData: FormData): Promise<UnderstandState> {
  return withActiveAccount<UnderstandState>({unavailable: {outcome: 'unavailable'}}, async () => {
    const description = fieldText(formData.get('description'));
    const wording = fieldText(formData.get('personalization'));
    const understanding = understand({description, wording}, defaultDomainRegistry);
    switch (understanding.kind) {
      case 'invalid':
        return {outcome: 'invalid', problems: understanding.problems};
      case 'no_match':
        return {outcome: 'no_match', subjects: understanding.subjects.map(subjectView)};
      case 'ambiguous':
        return {outcome: 'ambiguous', matches: understanding.matches.map(subjectView), personalization: classifyPersonalization(wording, 'evidence_text')};
      case 'clear':
        return {outcome: 'clear', subject: subjectView(understanding.subject), personalization: classifyPersonalization(wording, 'evidence_text')};
    }
  });
}

/**
 * Whether the confirmation certainly did not happen. A request the database never received (the key is not configured), or one it
 * understood and rejected (a 4xx), changed nothing. Anything else may have reached it: a dropped connection, a timeout, a server
 * error, an answer that makes no sense. For those the person is told to check My Projects first.
 */
function failed(error: unknown): ConfirmState {
  console.error('The request confirmation failed.', describe(error));
  const certain = error instanceof AccountsConfigError || (error instanceof AccountsUnavailableError && !error.outcomeUnknown);
  return {outcome: 'unavailable', unknown: !certain};
}

/** Confirms the request the form describes: creates the Project and its first revision, and goes to the Project. */
export async function confirmRequest(_previous: ConfirmState, formData: FormData): Promise<ConfirmState> {
  return withActiveAccount<ConfirmState>({unavailable: {outcome: 'unavailable', unknown: false}}, async ({access, budget}) => {
    const commandId = commandIdOf(formData.get('commandId'));
    // A form that is not shaped like the screen's: nothing to point at.
    if (!commandId) return {outcome: 'invalid', problems: []};
    const chosen = formData.get('subjectId');
    const check = checkRequest(
      {
        // Picture modes are Stories 2.2 and 2.3's: a person confirms a text request here, whatever the form says.
        mode: 'evidence_text',
        description: fieldText(formData.get('description')),
        subjectId: typeof chosen === 'string' && chosen !== '' ? chosen : null,
        scope: fieldText(formData.get('scope')),
        outcome: fieldText(formData.get('outcome')),
        wording: fieldText(formData.get('personalization')),
      },
      defaultDomainRegistry,
    );
    if (!check.ok) return check.kind === 'invalid' ? {outcome: 'invalid', problems: check.problems} : {outcome: 'changed'};

    let receipt: Awaited<ReturnType<typeof createProjectRequest>>;
    try {
      receipt = await withinBudget(budget, (timeoutMs) => createProjectRequest(operationOf(access.account), {commandId, request: check.request}, {timeoutMs}));
    } catch (error) {
      return failed(error);
    }

    switch (receipt.outcome) {
      case 'created':
      case 'replayed':
        // To the new Project, whose page shows the Request section. (A replay is the same Project: the command was already made.)
        return redirect(projectPath(receipt.projectId));
      case 'reused':
        return {outcome: 'reused'};
      case 'unavailable':
        // A replay of a request whose Project has since been deleted: there is nothing to go to, so say so instead of redirecting to a 404.
        return {outcome: 'gone'};
      default:
        // The database no longer gives this request authority (it ended between the gate and the write): nothing was saved, and Home
        // lets the gate say where this person now belongs.
        return redirect(homePath);
    }
  });
}
