// Story 1.7. How the Project pages read what they show: Home, My Projects, a Project's overview and its Sources page. Each read
// is the database's, for the Account and epoch of the verified access, and each says what it found in words a page can act on.
//
//   listed       the Account's Projects (newest update first) and how many it has in all
//   found        one Project
//   unavailable  the Project is another Account's, deleted, unknown or not an ID: ONE answer, which the page shows as the one
//                unavailable page with a 404 status and nothing of any Project
//   unreadable   the database did not answer. This is NOT `unavailable`: the page says "try again", because "the database is
//                down" must not look like "this Project is not yours"
//   denied       the Account has no authority for this request; the page sends the person Home, where the gate decides
//
// SERVER-ONLY. What went wrong is logged as a name and a message, which never contain a title or an ID.
import {cache} from 'react';
import {gatingTimeoutMs, type ActiveAccess} from '@/lib/access';
import {operationOf} from '@/lib/authority';
import {defaultDomainRegistry} from '@/lib/domain-registry';
import {listProjects, readProject, readProjectRequest, type ProjectRequestRow, type ProjectRow} from '@/lib/projects';

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

export type ProjectListing = {state: 'listed'; projects: ProjectRow[]; total: number} | {state: 'unreadable'} | {state: 'denied'};

/** The Account's Projects, newest update first, at most `limit`. A list that cannot be read is `unreadable`, never an empty one. */
export async function loadProjectList(access: ActiveAccess, limit?: number): Promise<ProjectListing> {
  try {
    const list = await listProjects(operationOf(access.account), {limit}, {timeoutMs: gatingTimeoutMs});
    if (list.outcome === 'denied') return {state: 'denied'};
    return {state: 'listed', projects: list.projects, total: list.total};
  } catch (error) {
    console.error('The Project list could not be read.', describe(error));
    return {state: 'unreadable'};
  }
}

export type ProjectLoading = {state: 'found'; project: ProjectRow} | {state: 'unavailable'} | {state: 'unreadable'} | {state: 'denied'};

/**
 * One Project of the Account. React's `cache` makes it one read per render for the same Account, epoch and ID: the page and its
 * metadata share one answer, and the next request starts from nothing. The arguments are values (not an object) so the cache
 * can tell two reads apart.
 */
export const loadProject = cache(async (accountId: string, epoch: number, projectId: string): Promise<ProjectLoading> => {
  try {
    const read = await readProject({accountId, epoch}, projectId, {timeoutMs: gatingTimeoutMs});
    return read.outcome === 'found' ? {state: 'found', project: read.project} : {state: read.outcome};
  } catch (error) {
    console.error('A Project could not be read.', describe(error));
    return {state: 'unreadable'};
  }
});

export type ProjectRequestLoading =
  | {state: 'found'; request: ProjectRequestRow; subjectName: string | null}
  | {state: 'none'}
  | {state: 'unavailable'}
  | {state: 'unreadable'}
  | {state: 'denied'};

/**
 * The request a Project was confirmed from (Story 2.1): its latest revision, with the display name of its subject from the registry
 * (null if no registered subject has that ID any more). A request that cannot be read is `unreadable`, and says so on the page; it
 * never makes the Project unavailable. One read per render for the same Account, epoch and ID, as `loadProject` is.
 */
export const loadProjectRequest = cache(async (accountId: string, epoch: number, projectId: string): Promise<ProjectRequestLoading> => {
  try {
    const read = await readProjectRequest({accountId, epoch}, projectId, {timeoutMs: gatingTimeoutMs});
    if (read.outcome !== 'found') return {state: read.outcome};
    const subject = read.request.subjectId ? defaultDomainRegistry.subject(read.request.subjectId) : null;
    return {state: 'found', request: read.request, subjectName: subject?.displayName ?? null};
  } catch (error) {
    console.error('A Project request could not be read.', describe(error));
    return {state: 'unreadable'};
  }
});
