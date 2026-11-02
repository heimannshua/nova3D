// Story 2.7. Where the Job pages are, as plain strings with no dependencies, so the proxy, the pages, the components and the tests can all use them (as lib/project-paths.ts does
// for the Projects).
export const progressPath = '/progress';
export const jobPath = (jobId: string) => `/progress/${jobId}`;

/**
 * Where a link is sent when its Job ID cannot even be decoded (`/progress/%E0%A4%A`: a percent sign that starts no escape). Next.js decodes the ID before any page runs, and
 * answers 500 for one that does not decode, so the proxy REWRITES such a link to this path (the address in the browser does not change): a segment that is not an ID, which is the
 * one unavailable page with a 404, the same as any other malformed ID. It rewrites every non-API request for such an address (the document, a navigation payload and a Server
 * Action POST), because the page it renders at that address sends its own requests there.
 */
export const undecodableJobPath = `${progressPath}/not-a-job-id`;

/** Whether the path is a Job page whose ID segment is not valid percent-encoding. */
export function hasUndecodableJobId(pathname: string): boolean {
  const match = /^\/progress\/([^/]+)\/?$/.exec(pathname);
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return false;
  } catch {
    return true;
  }
}
