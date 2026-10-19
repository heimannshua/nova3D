// Story 2.2. The ordered set of pictures a person is putting together on the picture intake screen (C-03): what a picture is, which
// ones may be added, and how the set changes when a picture is added, replaced, moved or removed. Pure: no runtime import, no browser or
// Node API, no clock, no random source (the caller hands in how a key is made and how a preview is made), so the screen, the tests and
// the upload code all agree on the same rules and the same answers. Erasable TypeScript syntax only.
//
// The rules here are the browser's first look, made so a person is told at once. The gateway (Story 1.12) checks the bytes again and the
// database checks the saved set again from the uploads' leases (api.record_picture_set), so nothing below is the authority on a file.
//
// Limits: 1 to 12 pictures, each a JPEG, PNG or WebP of 1 byte to 12 MiB, 60 MiB for the set, and no two with the same SHA-256.

export const maxPictures = 12;
export const maxPictureBytes = 12 * 1024 * 1024;
export const maxSetBytes = 60 * 1024 * 1024;
export const pictureTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PictureType = (typeof pictureTypes)[number];

/**
 * The three accepted formats, each to be put into a message through its own placeholder (`{jpeg}`, `{png}`, `{webp}`): a Hebrew message holds no Latin word, and
 * each language writes its own list ("JPEG, PNG or WebP"; the Hebrew "..., ... או ...") around the three names.
 */
export const formatParams = {jpeg: 'JPEG', png: 'PNG', webp: 'WebP'} as const;
/** The value of a file input's `accept`: exactly the three types (a phone that holds HEIC pictures converts them when it is asked only for these). */
export const acceptAttribute = pictureTypes.join(',');

const typeLabels: Record<PictureType, string> = {'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP'};

export function isPictureType(value: unknown): value is PictureType {
  return typeof value === 'string' && (pictureTypes as readonly string[]).includes(value);
}

/** The format of a picture in words (`JPEG`, `PNG`, `WebP`): a token, never translated. */
export function typeLabel(type: PictureType): string {
  return typeLabels[type];
}

/**
 * A size as `12 MiB`, `1.5 MiB` or `480 KiB`: the same text on the server and in the browser (no locale), to be put into a message through a placeholder.
 * A value that rounds up to the next unit is written in it (1,048,575 bytes is `1 MiB`, never `1024 KiB`), a whole number of MiB has no decimal (`12 MiB`, not
 * `12.0 MiB`), a file with bytes in it is never less than `1 KiB`, and an empty one is `0 KiB`. With a `limit`, a size that is below it never reads as the limit:
 * a total one byte under 60 MiB is `59.9 MiB`, not `60 MiB`, so "60 MiB of 60 MiB" is only ever said of a set that is full.
 */
export function formatBytes(bytes: number, limit?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KiB';
  const KiB = 1024;
  const MiB = KiB * 1024;
  const kibibytes = Math.max(1, Math.round(bytes / KiB));
  const mebibytes = bytes / MiB;
  let text: string;
  if (kibibytes < 1024) {
    text = `${kibibytes} KiB`;
  } else {
    const tenths = Math.round(mebibytes * 10) / 10;
    text = `${Number.isInteger(tenths) ? tenths : tenths.toFixed(1)} MiB`;
  }
  if (limit !== undefined && bytes < limit && text.endsWith(' MiB') && text === formatBytes(limit)) {
    // Truncated, not rounded: one byte under the limit is the last tenth below it.
    const floored = Math.floor((bytes / MiB) * 10) / 10;
    return `${Number.isInteger(floored) ? floored : floored.toFixed(1)} MiB`;
  }
  return text;
}

/** The first twelve characters of a SHA-256, enough for a person to tell two pictures apart. */
export function shortSha(sha256: string): string {
  return sha256.slice(0, 12);
}

// The model ------------------------------------------------------------------------------------------------------------------

/**
 * Why a picture's upload did not finish, in the gateway's own terms made plain (lib/picture-upload.ts maps every answer to one of these):
 *  - `content`: the file is not really a JPEG, PNG or WebP (the gateway looked at its first bytes);
 *  - `type`: the type the browser named is not one the gateway takes;
 *  - `changed`: the bytes that arrived were not the bytes the browser hashed (a changed or damaged file);
 *  - `too_large`: more than the gateway takes;
 *  - `quota`: the Account's private staging is full;
 *  - `reload`: the session or the page's token is no longer good: reload the page;
 *  - `conflict`: the upload ID was already taken, or the upload was ended: try again (with a new ID);
 *  - `unavailable`: the gateway or the service did not answer: try again;
 *  - `network`: the connection broke (a refused upload may be cut before its answer is read): try again;
 *  - `rejected`: the ticket or the upload was refused for a reason the person cannot fix (a bug or a closed service);
 *  - `duplicate`: the database found, from the uploads' leases, that this picture has the same SHA-256 as an earlier one in the set (the browser's own check had
 *    not seen it): remove it.
 */
export const uploadProblems = ['content', 'type', 'changed', 'too_large', 'quota', 'reload', 'conflict', 'unavailable', 'network', 'rejected', 'duplicate'] as const;
export type UploadProblem = (typeof uploadProblems)[number];

/**
 * Whether trying the same file again can help (a new attempt always has a new upload ID). It cannot for a file that is not a picture of a kind the gateway
 * takes (`content`, `type`, `too_large`: replace it), nor for a session that needs refreshing (`reload`: the page's token is only renewed by loading the page
 * again, which also loses the chosen files), nor for a picture that is the same as another (`duplicate`: remove it).
 */
export function retryable(problem: UploadProblem): boolean {
  return problem !== 'content' && problem !== 'type' && problem !== 'too_large' && problem !== 'reload' && problem !== 'duplicate';
}

/**
 * `checking`: being read and hashed, or waiting its turn (uploads run one at a time);
 * `uploading`: on its way to the gateway;
 * `ready`: staged privately (it has an upload ID);
 * `failed`: its upload did not finish (`problem` says why).
 */
export type ItemState = 'checking' | 'uploading' | 'ready' | 'failed';

export type PictureItem = {
  /** A name for this item on this screen: it does not change when the item moves, and is not the upload ID (a retry makes a new upload). */
  key: string;
  state: ItemState;
  /** How much of the upload has gone, 0 to 1. */
  progress: number;
  /** The SHA-256 of the whole file, in lower-case hex, once the browser has hashed it (a saved picture has it from the start). */
  sha256: string | null;
  length: number;
  contentType: PictureType;
  /** The upload ID once staged. */
  uploadId: string | null;
  /** A local object URL of the chosen file: the only way a picture is ever shown. A saved picture has none after a reload. */
  previewUrl: string | null;
  /** The chosen file, kept for a retry; null for a saved picture. */
  file: File | null;
  /** Part of the saved revision (its upload is the revision's, and is released by the save that drops it, never discarded by this screen). */
  saved: boolean;
  /** For a saved picture: when its private copy lapses, and whether it is still there. */
  expiresAt: string | null;
  available: boolean;
  problem: UploadProblem | null;
};

export type PictureSet = readonly PictureItem[];

export const emptySet: PictureSet = [];

/** How an item is made on this screen: the key, and the preview of its file (an object URL, made and revoked by the caller; null for none). */
export type ItemMaker = {key: () => string; preview?: (file: File) => string | null};

/** A picture saved earlier, as the Project's request revision names it. */
export type SavedPicture = {
  position: number;
  uploadId: string;
  sha256: string;
  length: number;
  contentType: PictureType;
  expiresAt: string | null;
  available: boolean;
};

/** The set of a saved revision, in its order, each picture ready (and, if its private copy has lapsed, not available). */
export function savedSet(pictures: readonly SavedPicture[], key: (picture: SavedPicture) => string): PictureSet {
  return [...pictures]
    .sort((a, b) => a.position - b.position)
    .map((picture) => ({
      key: key(picture),
      state: 'ready' as const,
      progress: 1,
      sha256: picture.sha256,
      length: picture.length,
      contentType: picture.contentType,
      uploadId: picture.uploadId,
      previewUrl: null,
      file: null,
      saved: true,
      expiresAt: picture.expiresAt,
      available: picture.available,
      problem: null,
    }));
}

// What a file is called, on this screen --------------------------------------------------------------------------------------

// Control characters, and the bidirectional controls that could make a name read in another order than it is written (U+202A to U+202E, U+2066 to U+2069).
const unwanted = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu;

/** A file's name as a message may say it: the person's own words, without a control character or a bidirectional control. */
export function displayName(name: string): string {
  return name.replace(unwanted, '').trim();
}

// Problems with a file --------------------------------------------------------------------------------------------------------

/**
 * Why a file cannot be added: `type` (not a JPEG, PNG or WebP: a HEIC or HEIF picture too), `empty` (0 bytes), `too_large` (over 12 MiB),
 * `too_many` (the set already holds 12), `set_too_large` (the set would be over 60 MiB), `duplicate` (the same SHA-256 as a picture already in
 * the set) and `unreadable` (the browser could not read it, or could not hash it).
 */
export const fileProblems = ['type', 'empty', 'too_large', 'too_many', 'set_too_large', 'duplicate', 'unreadable'] as const;
export type FileProblem = (typeof fileProblems)[number];

/** What `fileProblem` needs of a file: a `File` is one. The SHA-256 is known only after the browser has hashed it, and `unreadable` after it failed to. */
export type Candidate = {type: string; size: number; sha256?: string | null; unreadable?: boolean};

/** How many pictures and how many bytes a set holds. `ready`, `pending` (checking or uploading) and `failed` count the pictures by state. */
export function totals(set: PictureSet): {count: number; bytes: number; ready: number; pending: number; failed: number} {
  let bytes = 0;
  let ready = 0;
  let pending = 0;
  let failed = 0;
  for (const item of set) {
    bytes += item.length;
    if (item.state === 'ready') ready += 1;
    else if (item.state === 'failed') failed += 1;
    else pending += 1;
  }
  return {count: set.length, bytes, ready, pending, failed};
}

/**
 * The first problem a file has for joining this set, or null. In this order: its type, that it is empty, that it is over 12 MiB, that the set is
 * full, that the set would be over 60 MiB, that its SHA-256 is already in the set, that it could not be read. `set` is the set the file would join
 * (to replace a picture, the set without it). Without a `sha256` there is no duplicate to find yet.
 */
export function fileProblem(file: Candidate, set: PictureSet): FileProblem | null {
  if (!isPictureType(file.type.toLowerCase())) return 'type';
  if (file.size <= 0) return 'empty';
  if (file.size > maxPictureBytes) return 'too_large';
  const held = totals(set);
  if (held.count >= maxPictures) return 'too_many';
  if (held.bytes + file.size > maxSetBytes) return 'set_too_large';
  if (file.sha256 && set.some((item) => item.sha256 === file.sha256)) return 'duplicate';
  if (file.unreadable) return 'unreadable';
  return null;
}

// Changing the set ----------------------------------------------------------------------------------------------------------

function itemOf(file: File, make: ItemMaker): PictureItem {
  const type = file.type.toLowerCase();
  return {
    key: make.key(),
    state: 'checking',
    progress: 0,
    sha256: null,
    length: file.size,
    contentType: isPictureType(type) ? type : 'image/jpeg',
    uploadId: null,
    previewUrl: make.preview?.(file) ?? null,
    file,
    saved: false,
    expiresAt: null,
    available: true,
    problem: null,
  };
}

export type Added = {set: PictureSet; added: PictureItem[]; problems: {name: string; problem: FileProblem}[]};

/**
 * Adds the files in the order given, each at the end, as `checking` items (the caller hashes them next). A file with a problem is not added and is
 * named in `problems` with the file's own name; the others are. The checks run file by file against the growing set, so the 13th file is `too_many`
 * and the one that would pass 60 MiB is `set_too_large`, and the files before them are kept.
 */
export function addFiles(set: PictureSet, files: readonly File[], make: ItemMaker): Added {
  let current = set;
  const added: PictureItem[] = [];
  const problems: Added['problems'] = [];
  for (const file of files) {
    const problem = fileProblem(file, current);
    if (problem) {
      problems.push({name: displayName(file.name), problem});
      continue;
    }
    const item = itemOf(file, make);
    current = [...current, item];
    added.push(item);
  }
  return {set: current, added, problems};
}

export type Replaced = {set: PictureSet; added: PictureItem | null; replaced: PictureItem | null; problem: FileProblem | null};

/**
 * Puts a new file in the place of a picture (the same position), as a `checking` item. A file with a problem changes nothing (`problem` names it).
 * `replaced` is the picture that left, for the caller to revoke its preview and, if it was staged and not saved, to discard its upload.
 */
export function replaceItem(set: PictureSet, key: string, file: File, make: ItemMaker): Replaced {
  const index = set.findIndex((item) => item.key === key);
  if (index < 0) return {set, added: null, replaced: null, problem: null};
  const others = set.filter((item) => item.key !== key);
  const problem = fileProblem(file, others);
  if (problem) return {set, added: null, replaced: null, problem};
  const item = itemOf(file, make);
  const next = [...set];
  next[index] = item;
  return {set: next, added: item, replaced: set[index], problem: null};
}

/** Takes a picture out of the set. `removed` is the picture that left (null when the key names none). */
export function removeItem(set: PictureSet, key: string): {set: PictureSet; removed: PictureItem | null} {
  const index = set.findIndex((item) => item.key === key);
  if (index < 0) return {set, removed: null};
  return {set: set.filter((item) => item.key !== key), removed: set[index]};
}

/** Moves a picture one place earlier or later. The first cannot go earlier and the last cannot go later: the set is returned as it was. */
export function moveItem(set: PictureSet, key: string, direction: 'earlier' | 'later'): PictureSet {
  const index = set.findIndex((item) => item.key === key);
  const target = direction === 'earlier' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= set.length) return set;
  const next = [...set];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Changes some fields of one item (progress, state, upload ID, problem...). The set is returned as it was when the key names none. */
export function updateItem(set: PictureSet, key: string, patch: Partial<Omit<PictureItem, 'key'>>): PictureSet {
  if (!set.some((item) => item.key === key)) return set;
  return set.map((item) => (item.key === key ? {...item, ...patch} : item));
}

/**
 * Records the SHA-256 the browser computed for an item, or that it could not. A hash that equals another picture's removes the item as a
 * `duplicate`; one that could not be made removes it as `unreadable`. Otherwise the item keeps its place with the hash, still `checking` (it waits for
 * its turn to upload). `removed` is the item that left (the caller revokes its preview); `name` is the file's name, cleaned for a message.
 *
 * `restore` is the picture a replacement stands in for, kept aside until the replacement settled: when the replacement has a problem, that picture is put back
 * in the slot (the set keeps its length and its order) and `restored` is true; the problem is still named, for the message.
 */
export function settleHash(
  set: PictureSet,
  key: string,
  outcome: {sha256: string} | {unreadable: true},
  restore?: PictureItem,
): {set: PictureSet; problem: FileProblem | null; removed: PictureItem | null; restored: boolean; name: string | null} {
  const item = set.find((candidate) => candidate.key === key);
  if (!item) return {set, problem: null, removed: null, restored: false, name: null};
  const others = set.filter((candidate) => candidate.key !== key);
  const sha256 = 'sha256' in outcome ? outcome.sha256 : null;
  const problem = 'unreadable' in outcome ? 'unreadable' : others.some((candidate) => candidate.sha256 === sha256) ? 'duplicate' : null;
  const name = item.file ? displayName(item.file.name) : null;
  if (problem) {
    if (restore) return {set: set.map((candidate) => (candidate.key === key ? restore : candidate)), problem, removed: item, restored: true, name};
    return {set: others, problem, removed: item, restored: false, name};
  }
  return {set: updateItem(set, key, {sha256}), problem: null, removed: null, restored: false, name: null};
}

// What the set is, for saving ------------------------------------------------------------------------------------------------

/** The upload IDs of the ready pictures, in order. */
export function orderedUploadIds(set: PictureSet): string[] {
  return set.flatMap((item) => (item.state === 'ready' && item.uploadId ? [item.uploadId] : []));
}

/**
 * What stops the set from being saved: `empty` (no picture), `busy` (a picture is still being checked or uploaded), `failed` (a picture's upload did
 * not finish), `expired` (a saved picture's private copy has lapsed: replace it). Null when it can be saved.
 */
export type SetProblem = 'empty' | 'busy' | 'failed' | 'expired';

export function setProblem(set: PictureSet): SetProblem | null {
  if (set.length === 0) return 'empty';
  if (set.some((item) => item.state === 'failed')) return 'failed';
  if (set.some((item) => item.state === 'checking' || item.state === 'uploading')) return 'busy';
  if (set.some((item) => item.saved && !item.available)) return 'expired';
  return null;
}

/** Whether the ready pictures are not exactly, in order, the saved ones. */
export function differsFrom(set: PictureSet, savedIds: readonly string[]): boolean {
  const ids = orderedUploadIds(set);
  return ids.length !== savedIds.length || ids.some((id, index) => id !== savedIds[index]);
}

/**
 * A failed picture tried again: back to `checking`, with its problem and progress cleared. After the gateway found that the bytes that arrived were not the ones
 * that were hashed (`changed`: the file changed, or was damaged), the digest that was kept is no longer trusted, so it is reset and the file is read and hashed again
 * before it is sent; after any other problem the digest stands. The set is returned as it was when the key names no picture, the picture has not failed, or its file is
 * not here any more (there is nothing to send: replace it).
 */
export function retryItem(set: PictureSet, key: string): PictureSet {
  const item = set.find((candidate) => candidate.key === key);
  if (!item || item.state !== 'failed' || !item.file) return set;
  return updateItem(set, key, {state: 'checking', progress: 0, problem: null, ...(item.problem === 'changed' ? {sha256: null} : {})});
}

/**
 * The uploads a screen gives back when it goes: those of the pictures that are `ready`, were staged by the screen (not part of a saved revision) and are not in the
 * Save that was sent (`submitted`: they belong to it, whatever its answer turns out to be). In the order of the items, none twice.
 */
export function unsavedUploadIds(items: readonly PictureItem[], submitted: readonly string[]): string[] {
  const sent = new Set(submitted);
  const ids = items.flatMap((item) => (item.state === 'ready' ? [discardable(item)] : [])).filter((id): id is string => id !== null && !sent.has(id));
  return [...new Set(ids)];
}

/**
 * The upload a screen asks to have released when a picture is replaced or removed, or when the screen is left: one staged by this screen (it has an upload ID)
 * and not part of a saved revision. The request is best effort (a screen that is closing cannot be sure it is sent, and a failed release is silent): an upload
 * that is not released lapses on its own, 24 hours after its last activity, and the hourly cleanup then removes its object.
 */
export function discardable(item: PictureItem): string | null {
  return item.uploadId && !item.saved ? item.uploadId : null;
}
