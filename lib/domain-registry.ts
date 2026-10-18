// Story 2.1. The domain registry: the port through which the application learns which subjects nova3D can build, and the default
// registry, which registers the Middot package only. A subject in no registered manifest has no generator.
//
// Pure and client-safe (no I/O, no environment): it holds manifests, which are data. `createDomainRegistry` refuses an invalid
// manifest, a repeated package ID, a repeated subject ID and a display name two subjects share (compared as the matching compares
// text), naming the problems, so a package that is wrong fails the moment it is registered and never half-way through a person's
// request. Two subjects MAY share an alias: a description that matches both asks the person which, and the display names are what
// tell the two apart on that screen.
import {comparable, validateManifest, type DomainManifest, type ManifestSubject} from '../packages/contracts/domain-manifest.ts';
import {middotManifest} from '../packages/domains/middot/manifest.ts';

/** A subject as the registry holds it: the manifest's subject, and the package and manifest version that registered it. */
export type RegisteredSubject = ManifestSubject & {
  readonly packageId: string;
  readonly packageVersion: number;
};

export type DomainRegistry = {
  /** Every registered subject, in registration order (the manifests in the order given, each manifest's subjects in its order). */
  subjects(): readonly RegisteredSubject[];
  /** One subject by its ID, or null. */
  subject(id: string): RegisteredSubject | null;
};

/**
 * A registry of the given manifests. Throws a TypeError naming every problem when a manifest is invalid, a package ID appears in two
 * manifests, a subject ID appears twice (in one manifest or across two), or two subjects share a display name (equal after
 * normalization: the person could not tell them apart when asked which one they mean). The registry it returns is a snapshot: the
 * manifests are copied.
 */
export function createDomainRegistry(manifests: readonly DomainManifest[]): DomainRegistry {
  const problems: string[] = [];
  const registered: RegisteredSubject[] = [];
  const seen = new Set<string>();
  const packages = new Set<string>();
  const names = new Map<string, string>();
  manifests.forEach((candidate, index) => {
    const checked = validateManifest(candidate);
    if (!checked.ok) {
      for (const problem of checked.problems) problems.push(`manifest ${index}: ${problem}`);
      return;
    }
    const manifest = checked.manifest;
    if (packages.has(manifest.packageId)) problems.push(`manifest ${index} (${manifest.packageId}): package ${manifest.packageId} is already registered`);
    packages.add(manifest.packageId);
    for (const subject of manifest.subjects) {
      if (seen.has(subject.id)) {
        problems.push(`manifest ${index} (${manifest.packageId}): subject ${subject.id} is already registered`);
        continue;
      }
      seen.add(subject.id);
      const name = comparable(subject.displayName);
      const sharer = names.get(name);
      if (sharer !== undefined) {
        problems.push(`manifest ${index} (${manifest.packageId}): subject ${subject.id} has the same display name as subject ${sharer}`);
        continue;
      }
      names.set(name, subject.id);
      registered.push(
        Object.freeze({
          id: subject.id,
          displayName: subject.displayName,
          aliases: Object.freeze([...subject.aliases]),
          packageId: manifest.packageId,
          packageVersion: manifest.version,
        }),
      );
    }
  });
  if (problems.length) throw new TypeError(`The domain manifests are not valid: ${problems.join('; ')}`);
  const subjects = Object.freeze([...registered]);
  const byId = new Map(subjects.map((subject) => [subject.id, subject] as const));
  return {
    subjects: () => subjects,
    subject: (id) => byId.get(id) ?? null,
  };
}

/** The registry the application uses: Middot's one subject. A fixture second subject lives in tests/support only. */
export const defaultDomainRegistry: DomainRegistry = createDomainRegistry([middotManifest]);
