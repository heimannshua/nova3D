// Story 2.1. The domain-package manifest: what a domain package tells nova3D about the subjects it can build. A subject that is in
// no manifest has no generator, so this is the whole list of what a person can ask for in words.
//
// This file is a contract, not a feature: it has NO runtime imports and only erasable TypeScript syntax, so a worker, a script or
// another runtime can load it through Node type stripping, and a later story can add manifest fields without touching a caller. It
// never throws: `validateManifest` names every problem it finds and the caller decides what to do with them (the registry, which
// is lib/domain-registry.ts, refuses to register a manifest that has any).
//
// The rules (docs/domain-packages.md is the long form):
//   - `packageId` and each subject `id`: a lower-case slug, `^[a-z][a-z0-9-]{0,62}$`
//   - `version`: a positive integer
//   - 1 to 32 subjects
//   - `displayName`: trimmed, 1 to 120 characters, no control character
//   - 1 to 16 aliases of 1 to 60 characters, trimmed, no control character, and no two aliases of one subject equal after
//     normalization (the same normalization the matching uses: lib/request-intake.ts `normalizeText`)

/** One subject a package can build: a stable ID, the name a person sees, and the words a description may use for it. */
export type ManifestSubject = {
  readonly id: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
};

/** What a domain package publishes: its ID, the version of this manifest, and its subjects. */
export type DomainManifest = {
  readonly packageId: string;
  readonly version: number;
  readonly subjects: readonly ManifestSubject[];
};

export const maxSubjects = 32;
export const maxAliases = 16;
export const maxDisplayNameLength = 120;
export const maxAliasLength = 60;

/** The shape of a package ID and of a subject ID. */
export const slugPattern = /^[a-z][a-z0-9-]{0,62}$/;

export type ManifestValidation = {ok: true; manifest: DomainManifest} | {ok: false; problems: string[]};

// A control character in the sense the database checks use (C0 and C1, and DEL).
const control = /[\u0000-\u001f\u007f-\u009f]/;

// The comparison form of an alias: the same steps as lib/request-intake.ts `normalizeText` (NFKC; the Hebrew points U+0591 to U+05C7
// removed, except that U+05BE, U+05C0, U+05C3 and U+05C6 become a space; lower case; every white-space run one space; trimmed). It is
// repeated here, not imported, because this file may import nothing at run time; tests/unit/domain-manifest.test.ts holds the two equal.
// Exported for the registry, which compares display names the same way, and for that test.
export function comparable(alias: string): string {
  return alias
    .normalize('NFKC')
    .replace(/[\u05be\u05c0\u05c3\u05c6]/g, ' ')
    .replace(/[\u0591-\u05c7]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const length = (text: string) => [...text].length;

function validateText(name: string, value: unknown, max: number, problems: string[]): value is string {
  if (typeof value !== 'string') {
    problems.push(`${name} must be text`);
    return false;
  }
  let sound = true;
  if (value !== value.trim()) {
    problems.push(`${name} must be trimmed`);
    sound = false;
  }
  if (length(value) < 1 || length(value) > max) {
    problems.push(`${name} must be 1 to ${max} characters`);
    sound = false;
  }
  if (control.test(value)) {
    problems.push(`${name} must not contain a control character`);
    sound = false;
  }
  return sound;
}

/**
 * Checks a value against the manifest rules and names every problem (an empty `problems` never comes with `ok: false`). It does not
 * throw, whatever it is given: a value that is not an object is one problem. The manifest it returns is the value itself, typed.
 */
export function validateManifest(value: unknown): ManifestValidation {
  const problems: string[] = [];
  if (!isRecord(value)) return {ok: false, problems: ['the manifest must be an object']};

  if (typeof value.packageId !== 'string' || !slugPattern.test(value.packageId)) problems.push('packageId must match ^[a-z][a-z0-9-]{0,62}$');
  if (typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1) problems.push('version must be a positive integer');

  if (!Array.isArray(value.subjects)) {
    problems.push('subjects must be a list');
  } else {
    if (value.subjects.length < 1 || value.subjects.length > maxSubjects) problems.push(`subjects must hold 1 to ${maxSubjects} subjects`);
    // Index loops, not forEach: a hole in a sparse list is a missing entry (it reads as undefined and is a problem), where forEach would skip it.
    // At most one more than the limit is looked at, so a list that claims a huge length costs nothing.
    for (let index = 0; index < Math.min(value.subjects.length, maxSubjects + 1); index += 1) {
      const at = `subjects[${index}]`;
      const subject: unknown = value.subjects[index];
      if (!isRecord(subject)) {
        problems.push(`${at} must be an object`);
        continue;
      }
      if (typeof subject.id !== 'string' || !slugPattern.test(subject.id)) problems.push(`${at}.id must match ^[a-z][a-z0-9-]{0,62}$`);
      validateText(`${at}.displayName`, subject.displayName, maxDisplayNameLength, problems);
      if (!Array.isArray(subject.aliases)) {
        problems.push(`${at}.aliases must be a list`);
        continue;
      }
      if (subject.aliases.length < 1 || subject.aliases.length > maxAliases) problems.push(`${at}.aliases must hold 1 to ${maxAliases} aliases`);
      const seen = new Map<string, number>();
      for (let aliasIndex = 0; aliasIndex < Math.min(subject.aliases.length, maxAliases + 1); aliasIndex += 1) {
        const alias: unknown = subject.aliases[aliasIndex];
        const name = `${at}.aliases[${aliasIndex}]`;
        const sound = validateText(name, alias, maxAliasLength, problems);
        // An alias that is nothing after normalization (only Hebrew points, say) can never match, and would equal every other such alias.
        if (!sound || typeof alias !== 'string') continue;
        const form = comparable(alias);
        if (form === '') {
          problems.push(`${name} must not be empty after normalization`);
          continue;
        }
        const earlier = seen.get(form);
        if (earlier !== undefined) problems.push(`${name} repeats aliases[${earlier}] after normalization`);
        else seen.set(form, aliasIndex);
      }
    }
  }

  return problems.length ? {ok: false, problems} : {ok: true, manifest: value as DomainManifest};
}
