# Domain packages: which subjects nova3D can build, and how one is added

Story 2.1 (confirm natural-language intent and personalization) adds the manifest contract and the registry port. A **domain package** knows how to build some subjects (the first is Middot, the Temple's outer altar and ramp). A **manifest** is what a package tells nova3D about them. A subject that is in no registered manifest has no generator: it cannot be asked for in words, and a description that names nothing registered is told so, with the list of what is supported, before anything else happens. Nothing here calls a model, a provider or the network: understanding a description is deterministic and free.

## The contract

`packages/contracts/domain-manifest.ts` holds the types and the check. It imports nothing at run time and uses only erasable TypeScript syntax, so a worker, a script or another runtime can load it through Node type stripping; every import in it is `import type`.

```ts
type ManifestSubject = {id: string; displayName: string; aliases: readonly string[]};
type DomainManifest = {packageId: string; version: number; subjects: readonly ManifestSubject[]};
validateManifest(value: unknown): {ok: true; manifest: DomainManifest} | {ok: false; problems: string[]}
```

`validateManifest` names **every** problem it finds and never throws, whatever it is given. The rules:

| Field | Rule |
| --- | --- |
| `packageId`, a subject's `id` | a lower-case slug, `^[a-z][a-z0-9-]{0,62}$` |
| `version` | a positive integer |
| `subjects` | 1 to 32 |
| `displayName` | trimmed, 1 to 120 characters, no control character |
| `aliases` | 1 to 16 per subject, each 1 to 60 characters, trimmed, no control character, and no two equal after normalization |

"Equal after normalization" is the matching's own normalization (`normalizeText` in `lib/request-intake.ts`: Unicode NFKC, the Hebrew points removed, lower case, white space collapsed), so `Altar` and `ALTAR`, or `מִזְבֵּחַ` and `מזבח`, are the same alias. The contract may import nothing at run time, so it repeats those steps; `tests/unit/domain-manifest.test.ts` holds the two equal over a corpus. An alias that is nothing after normalization (only Hebrew points, say) is refused: it could never match.

A later story adds manifest fields as the things they describe land (surfaces for personalization in Story 4.2, generators in Epic 4); a new field is optional until a caller needs it.

## The registry port

`lib/domain-registry.ts` holds the port the application uses:

```ts
type RegisteredSubject = ManifestSubject & {packageId: string; packageVersion: number};
type DomainRegistry = {subjects(): readonly RegisteredSubject[]; subject(id: string): RegisteredSubject | null};
createDomainRegistry(manifests: readonly DomainManifest[]): DomainRegistry
defaultDomainRegistry   // the application's registry: Middot only
```

`subjects()` is in registration order (the manifests in the order given, each manifest's subjects in its order). `createDomainRegistry` throws a `TypeError` that names every problem when a manifest is invalid or a subject ID appears twice (in one manifest or across two). **Two subjects may share an alias**: a description that matches both asks the person which one they mean (C-06, "ambiguous"), and a chosen subject is accepted only if it is among the matches.

The database cannot know the registry. It checks that a subject ID is shaped like one (`^[a-z][a-z0-9-]{0,62}$`) and that a text request has one; the application, which validates the subject against the registry in `confirmRequest`, is the only caller of `api.create_project_request`.

## The Middot manifest and its aliases

`packages/domains/middot/manifest.ts`: package `middot`, version 1, one subject.

| Subject ID | Display name | Aliases |
| --- | --- | --- |
| `middot-altar-ramp` | The outer altar and ramp (Middot 3) | `altar`, `ramp`, `mizbeach`, `kevesh`, `מזבח`, `כבש` |

**The alias list is not approved yet.** Josh approves it with the G-1 corpus; the approval will be recorded here and in `_bmad-output/implementation-artifacts/deferred-work.md`, and no code gates on it. Until then it is the list the story names. What the matching does and does not do, so that the approval can weigh it:

- **Subjects are matched by their aliases only, not by their display names.** A description that says "The outer altar and ramp (Middot 3)" matches because it contains `altar` and `ramp`, not because it repeats the name.
- **A generic alias can match text that is about something else.** `altar` and `ramp` are common English words (a loading ramp, an altar in a church), and `כבש` also means "lamb" in Hebrew. A description about another altar, or about a lamb, will be understood as the Temple's subject, and the person is shown that understanding before anything is saved, so the cost of a wrong match is a screen the person corrects with Edit, not a wrong Project; but the more generic the alias, the more often that screen is wrong. The approval should weigh each alias against the corpus for this.
- **Only the aliases as written are found.** Plurals (`altars`, `ramps`), other transliterations (`mizbeah`, `kevesh`'s variants) and synonyms are not matched; neither are Hebrew inflections other than the one or two prefix letters `ו ב כ ל מ ש ה` and the points. A missed match shows "we cannot build that yet" with the supported subjects and the picture offer, so it costs the person a rewrite, never a wrong subject. Adding an alias is the way to find more, at the price above.
- **An alias another subject also uses turns every description that uses it into a question** (the several-matches screen), which is exactly what the fixture second subject in the tests exercises.

The display name is the Project's title and is shown in a `<bdi>` in both languages: it is data from the manifest, not interface copy, so it is English in the Hebrew interface too (see the deferred work).

## How a description is matched

Both the description and each alias are normalized, and a subject matches when the description contains one of its aliases as a **whole word**: the character before and the character after are not a letter, a digit or a mark (`\p{L}\p{N}\p{M}`; JavaScript's `\b` is ASCII-only). An alias that starts with a Hebrew letter also matches after one or two of the prefix letters `ו ב כ ל מ ש ה` that themselves follow a non-letter, because Hebrew writes its articles and prepositions attached to the noun: `המזבח`, `במזבח` and `לכבש` match; `altarpiece`, `ramps` and `kevesher` do not. The person's own words are stored as written; only the comparison uses the normalized form.

`understand` returns exactly one of `invalid` (named field problems), `no_match` (the registered subjects, for the explanation), `ambiguous` (the matching subjects, in registry order) or `clear` (one subject).

## Adding a subject

1. Add the subject to a manifest, in the package that builds it: an ID that follows the slug rule and is unique across every registered manifest, the name a person should see, and the words a description may use for it (1 to 16, none equal to another of its own after normalization). Pick aliases a person would write; remember that an alias another subject also uses turns every description that uses it into a question.
2. Register the manifest where the registry is built (`defaultDomainRegistry` in `lib/domain-registry.ts`). `createDomainRegistry` refuses it at start-up, naming the problems, if it is wrong, so a bad manifest never reaches a person.
3. Add the subject's generator in the story that owns it. Until then it can be confirmed (a Project is created with the subject recorded) but nothing builds it: research and generation are later stories.
4. Test it with the fixture second subject's pattern: `tests/support/fixture-domains.ts` holds `fixture-incense-altar` ("The incense altar (fixture)", aliases `altar` and `incense`), which shares `altar` with Middot to exercise the several-matches case. **The fixture lives in `tests/support/` only and is never in the default registry**; a test of the ambiguous screen renders the result that registry would have produced.

## What a confirmed request records

A request revision (`projects.request_revisions`, owned by Projects) holds the subject ID, the scope and outcome the person confirmed, the mode, the description and the personalization as understood. It carries **no approval, permission or payment field**: confirming a request starts no Job, approves no plan and authorizes no cost. See "Confirming a request" in [authority-contract.md](authority-contract.md) for the command and for the rule a later writer of a successor revision must follow.

## Personalization

Personalization is free wording mapped to the one supported kind, raised or recessed text on declared surfaces (`classifyPersonalization` in `lib/request-intake.ts`). Exactly one quoted text of 1 to 24 characters, between one pair of quotation marks: straight `"…"`, curly `“…”` or `«…»`. The words outside the quotes choose the style, as whole words and with the forms of their verb:

- recessed: `recess`, `recesses`, `recessed`, `recessing`, `engrave`, `engraves`, `engraved`, `engraving`, `carve`, `carves`, `carved`, `carving`, `incise`, `incises`, `incised`, `incising`, `deboss`, `debosses`, `debossed`, `debossing`, `etch`, `etched`, `sunken`, `חרוט`, `שקוע`;
- raised: `raise`, `raises`, `raised`, `raising`, `emboss`, `embosses`, `embossed`, `embossing`, `relief`, `protruding`, `protrude`, `protrudes`, `בולט`, `מוגבה`.

Both is a conflict; neither is raised. A longer word that merely contains one (`engravedish`, `unraised`) is not a style word. Anything else in the wording is not used.

A wish that cannot be applied is explained in plain words, may still be confirmed, and is recorded not applied with its reason:

| Reason | When |
| --- | --- |
| `no_quoted_text` | no pair of quotation marks, or a pair with nothing in it, or a lone mark |
| `several_texts` | more than one quoted text, or one quoted text and another quotation mark without its pair (`"צה"ל"`): which text is meant is not guessed |
| `text_too_long` | the text is over 24 characters |
| `text_invalid` | the text has a control character, a bidirectional control, or nothing that draws |
| `conflicting_styles` | both a raised word and a recessed word |
| `image_direct_has_no_surfaces` | the mode is `image_direct`: an image-derived model carries no declared surfaces, so any wording is declined |

The 24-character limit is the first surface's (Story 4.2) and moves into the surface declaration there.

## Text that draws nothing, and bidirectional controls

A description, scope, outcome, personalization wording or quoted wish text that is empty once the characters that draw nothing are removed counts as empty: control, format and separator characters (`\p{Cc}\p{Cf}\p{Z}`, which holds the zero-width space and the no-break and ideographic spaces) and four fill characters (U+2800, U+3164, U+115F, U+1160), the set a Project's title already uses. The bidirectional override, embedding and isolate controls (U+202A to U+202E, U+2066 to U+2069) are refused in all of them, because they can make text read in an order other than the one it is stored in. The zero-width non-joiner and joiner (U+200C, U+200D) are NOT refused: Hebrew, Persian and emoji text need them. The database makes the same two checks (`projects.is_invisible`, `projects.has_bidi_control`; a Postgres regular expression has no Unicode properties, so the class is written out, and `tests/integration/request-revisions.test.ts` holds it equal to the application's over every code point).
