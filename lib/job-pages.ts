// Story 2.7. How the Job pages read what they show: In Progress (J-01) and a Job's detail (J-02). Each read is the database's, for the Account and epoch of the verified access, and
// each says what it found in words a page can act on, exactly as lib/project-pages.ts does for Projects:
//
//   listed       the Account's Jobs whose Project is live, open ones first
//   found        one Job in full
//   unavailable  the Job is another Account's, deleted, unknown, belongs to a Project that is deleted or tombstoned, or is not an ID: ONE answer, which the page shows as the one
//                unavailable page with a 404 status and nothing of any Job
//   unreadable   the database did not answer. This is NOT `unavailable`: the page says "try again", because "the database is down" must not look like "this Job is not yours"
//   denied       the Account has no authority for this request; the page sends the person Home, where the gate decides
//
// SERVER-ONLY. What went wrong is logged as a name and a message, which never contain a title or an ID.
import {cache} from 'react';
import {gatingTimeoutMs, type ActiveAccess} from '@/lib/access';
import {operationOf} from '@/lib/authority';
import {listJobs, readJobDetail} from '@/lib/job-commands';
import {jobIdOf, type JobDetail, type JobListItem} from '@/lib/job-view';

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : 'unknown failure');

/** How many Jobs In Progress lists: the database's default, open ones first. */
export const listedJobs = 50;

export type JobListing = {state: 'listed'; jobs: JobListItem[]} | {state: 'unreadable'} | {state: 'denied'};

/** The Account's Jobs, open ones first. A list that cannot be read is `unreadable`, never an empty one. */
export async function loadJobList(access: ActiveAccess): Promise<JobListing> {
  try {
    const list = await listJobs(operationOf(access.account), {limit: listedJobs}, {timeoutMs: gatingTimeoutMs});
    return list.outcome === 'found' ? {state: 'listed', jobs: list.jobs} : {state: 'denied'};
  } catch (error) {
    console.error('The Job list could not be read.', describe(error));
    return {state: 'unreadable'};
  }
}

export type JobLoading = {state: 'found'; job: JobDetail} | {state: 'unavailable'} | {state: 'unreadable'} | {state: 'denied'};

/**
 * One Job of the Account. React's `cache` makes it one read per render for the same Account, epoch and ID: the page and its metadata share one answer, and the next request starts
 * from nothing. An ID that is not an ID is `unavailable` without the database being asked: nothing can be learned from it, so nothing is asked.
 */
export const loadJob = cache(async (accountId: string, epoch: number, jobId: string): Promise<JobLoading> => {
  const id = jobIdOf(jobId);
  if (id === null) return {state: 'unavailable'};
  try {
    const read = await readJobDetail({accountId, epoch}, {jobId: id}, {timeoutMs: gatingTimeoutMs});
    return read.outcome === 'found' ? {state: 'found', job: read.job} : {state: read.outcome};
  } catch (error) {
    console.error('A Job could not be read.', describe(error));
    return {state: 'unreadable'};
  }
});
