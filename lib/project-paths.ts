// Story 1.7. Where the Project pages are, as plain strings with no dependencies, so the proxy, the pages, the components and the
// tests can all use them.
export const projectsPath = '/projects';
export const projectPath = (projectId: string) => `/projects/${projectId}`;
export const sourcesPath = (projectId: string) => `/projects/${projectId}/sources`;
/** The picture screen (Story 2.2: C-03) of a Project whose latest request is an unconfirmed picture request. */
export const picturesPath = (projectId: string) => `/projects/${projectId}/pictures`;

/**
 * Where a link is sent when its Project ID cannot even be decoded (`/projects/%E0%A4%A`: a percent sign that starts no escape).
 * Next.js decodes the ID before any page runs, and answers 500 for one that does not decode, so the proxy REWRITES such a link to
 * this path (the address in the browser does not change): a segment that is not an ID, which is the one unavailable page with a
 * 404, the same as any other malformed ID. It rewrites every non-API request for such an address (the document, a navigation
 * payload and a Server Action POST), because the page it renders at that address sends its own requests there.
 */
export const undecodableProjectPath = `${projectsPath}/not-a-project-id`;

/** Whether the path is a Project page (the overview, Sources or Pictures) whose ID segment is not valid percent-encoding. */
export function hasUndecodableProjectId(pathname: string): boolean {
  const match = /^\/projects\/([^/]+)(?:\/(?:sources|pictures))?\/?$/.exec(pathname);
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return false;
  } catch {
    return true;
  }
}

/** Where a person describes a model in words and confirms what was understood (Story 2.1: C-02 and C-06, one narrow page). */
export const newProjectPath = '/projects/new';

/** Where a person chooses or photographs the views of a new picture request and saves them privately (Story 2.2: C-03). The Project is born at the first save. */
export const newPicturesPath = '/projects/new/pictures';
