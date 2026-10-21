import {createHash, randomUUID} from 'node:crypto';
import type {Client} from 'pg';
import {beforeAll, describe, expect, it} from 'vitest';
import {AccountsUnavailableError} from '@/lib/accounts';
import {defaultDomainRegistry} from '@/lib/domain-registry';
import {projectStages} from '@/lib/project-stage';
import {createProjectRequest, readProjectRequest, renameProjectCommand} from '@/lib/projects';
import {checkRequest} from '@/lib/request-intake';
import {createHarness, stack} from '../support/accounts-db';
import {stackEnvironment} from '../support/stack';

// Story 2.1 against the Supabase CLI stack: the immutable request-revision record, the one idempotent command that creates a Project and its first
// revision at confirmation (api.create_project_request) and the read of the latest revision (api.read_project_request), every database-level row of the
// I/O matrix. Most cases run inside a transaction that is rolled back, as the service role. The cases that need several real connections (the same
// command arriving twice at once, a disable racing a create), the REST path and the typed calls the application makes commit data that is removed
// afterwards (tests/support/accounts-data.ts deletes revisions before Projects).

const {db, connect, committed, cleanup, inTx, addUser, attempt, rows, api} = createHarness();

let env: Record<string, string>;
beforeAll(async () => {
  env = await stackEnvironment(db);
});

// Fixtures ---------------------------------------------------------------------------------------------------------------------

type Fixture = {user: Awaited<ReturnType<typeof addUser>>; accountId: string; workspaceId: string; epoch: number};

/** An Account with its Workspace, made the way registration makes one (identity.activate_account). */
async function account(client: Client): Promise<Fixture> {
  const user = await addUser(client);
  const {rows: made} = await client.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
  const accountId = made[0].id as string;
  const {rows: workspace} = await client.query('select id from projects.workspaces where account_id = $1', [accountId]);
  return {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
}

async function committedAccount(): Promise<Fixture> {
  const made = await account(db);
  committed.users.push(made.user.id);
  return made;
}

/** A Project, inserted directly (the owner can). A Project made this way has no request revision. */
async function project(client: Client, owner: Fixture, options: {title?: string; stage?: string; deleted?: boolean} = {}): Promise<string> {
  const {rows: made} = await client.query(
    `insert into projects.projects (workspace_id, account_id, title, stage, deleted_at) values ($1, $2, $3, $4, case when $5 then now() end) returning id`,
    [owner.workspaceId, owner.accountId, options.title ?? 'Courtyard bench', options.stage ?? 'researching', options.deleted === true],
  );
  return made[0].id as string;
}

/** What the application sends to api.create_project_request, in the function's own words. */
type Request = {
  account: string;
  epoch: number | null;
  command: string | null;
  title: string | null;
  mode: string | null;
  subject: string | null;
  scope: string | null;
  outcome: string | null;
  description: string | null;
  wording: string | null;
  text: string | null;
  style: string | null;
  applied: boolean | null;
  reason: string | null;
};

const TITLE = 'The outer altar and ramp (Middot 3)';
const request = (who: Fixture, patch: Partial<Request> = {}): Request => ({
  account: who.accountId,
  epoch: who.epoch,
  command: randomUUID(),
  title: TITLE,
  mode: 'evidence_text',
  subject: 'middot-altar-ramp',
  scope: TITLE,
  outcome: 'A model built from what the research finds',
  description: 'Build the altar and ramp',
  wording: null,
  text: null,
  style: null,
  applied: false,
  reason: null,
  ...patch,
});
/** An applied wish, in the fields that carry it. */
const applied = {wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed', applied: true, reason: null} as const;
/** A declined wish: the wording and the reason it was not applied, and no text or style. */
const declined = {wording: 'add something nice', text: null, style: null, applied: false, reason: 'no_quoted_text'} as const;

const createSql = 'select * from api.create_project_request($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)';
const valuesOf = (r: Request) => [r.account, r.epoch, r.command, r.title, r.mode, r.subject, r.scope, r.outcome, r.description, r.wording, r.text, r.style, r.applied, r.reason];
const createRaw = (client: Client, r: Request) => attempt(client, 'service_role', createSql, valuesOf(r));
async function create(client: Client, who: Fixture, patch: Partial<Request> = {}) {
  const result = await createRaw(client, request(who, patch));
  if (!result.ok) throw new Error(`api.create_project_request failed: ${result.message}`);
  return result.rows[0];
}
const asService = async (client: Client, sql: string, params: unknown[]) => (await rows(client, 'service_role', sql, params))[0];
const read = (client: Client, who: Fixture, projectId: string, epoch: number | null = who.epoch) =>
  asService(client, 'select * from api.read_project_request($1, $2, $3)', [who.accountId, epoch, projectId]);
const rename = (client: Client, who: Fixture, input: {projectId: string; title: string; command: string; expected?: number}) =>
  asService(client, 'select * from api.rename_project($1, $2, $3, $4, $5, $6)', [who.accountId, who.epoch, input.command, input.projectId, input.expected ?? 1, input.title]);

/** The digest the function builds: SHA-256 of 'create_project_request', a newline, then each field as `<byte length>:<value>` (a dash for none). */
const part = (value: string | null) => (value === null ? '-' : `${Buffer.byteLength(value, 'utf8')}:${value}`);
const digestOf = (r: Request) =>
  createHash('sha256')
    .update(`create_project_request\n${[r.title, r.mode, r.subject, r.scope, r.outcome, r.description, r.wording, r.text, r.style, String(r.applied), r.reason].map(part).join('')}`, 'utf8')
    .digest('hex');

const revisionsOf = async (client: Client, accountId: string) =>
  (
    await client.query(
      `select id, project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_wording as wording, personalization_text as text,
              personalization_style as style, personalization_applied as applied, personalization_reason as reason, digest, confirmed_at, created_at
         from projects.request_revisions where account_id = $1 order by seq, created_at`,
      [accountId],
    )
  ).rows;
const projectsOf = async (client: Client, accountId: string) =>
  (await client.query('select id, title, stage, current_version, revision::int as revision, workspace_id, created_at, updated_at, deleted_at from projects.projects where account_id = $1 order by created_at', [accountId])).rows;
const counts = async (client: Client, accountId: string) => ({projects: (await projectsOf(client, accountId)).length, revisions: (await revisionsOf(client, accountId)).length});

/** A revision inserted directly as the owner, in a Project of its own, to check the table's own rules. Every field can be changed with `patch`. */
async function revise(client: Client, owner: Fixture, patch: Record<string, unknown> = {}) {
  const projectId = (patch.project_id as string | undefined) ?? (await project(client, owner));
  const v = {
    seq: 1,
    command_id: randomUUID(),
    mode: 'evidence_text',
    subject_id: 'middot-altar-ramp',
    scope: 'Scope',
    outcome: 'Outcome',
    description: 'Description',
    personalization_wording: null,
    personalization_text: null,
    personalization_style: null,
    personalization_applied: false,
    personalization_reason: null,
    digest: 'a'.repeat(64),
    account_id: owner.accountId,
    ...patch,
  };
  const result = await attempt(
    client,
    null,
    `insert into projects.request_revisions (project_id, account_id, seq, command_id, mode, subject_id, scope, outcome, description, personalization_wording, personalization_text,
                                              personalization_style, personalization_applied, personalization_reason, digest, confirmed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now()) returning id`,
    [projectId, v.account_id, v.seq, v.command_id, v.mode, v.subject_id, v.scope, v.outcome, v.description, v.personalization_wording, v.personalization_text, v.personalization_style, v.personalization_applied, v.personalization_reason, v.digest],
  );
  return {result, projectId};
}
/** A wish that is applied, as the fields that carry it, with a text of the given value (so the text's own checks are the ones tried). */
const wishWithText = (text: string) => ({personalization_wording: 'Add "x"', personalization_text: text, personalization_style: 'raised', personalization_applied: true});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until the backend is blocked on a lock, so a test knows the other connection really is waiting for it. */
async function untilBlocked(pid: number) {
  for (let attemptNumber = 0; attemptNumber < 100; attemptNumber += 1) {
    const {rows: found} = await db.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (found[0]?.wait_event_type === 'Lock') return;
    await wait(50);
  }
  throw new Error('The other connection never started waiting for the lock.');
}

const nothing = {
  request_id: null,
  project_id: null,
  seq: null,
  mode: null,
  subject_id: null,
  scope: null,
  intended_outcome: null,
  description: null,
  personalization_wording: null,
  personalization_text: null,
  personalization_style: null,
  personalization_applied: null,
  personalization_reason: null,
  confirmed_at: null,
  // Story 2.2: whether the revision is confirmed, and its pictures.
  confirmed: null,
  images: null,
  // Story 2.3: whether the person confirmed nothing blocks the subject and whether they acknowledged incomplete inputs, with the times.
  obstruction_confirmed: null,
  obstruction_confirmed_at: null,
  acknowledged: null,
  acknowledged_at: null,
};

// ---------------------------------------------------------------------------------------------------
describe('the record: immutable request revisions that Projects own', () => {
  it('has exactly the columns the story lists, and no approval, permission or payment field', async () => {
    const {rows: columns} = await db.query(
      `select column_name as name, is_nullable = 'NO' as required from information_schema.columns where table_schema = 'projects' and table_name = 'request_revisions' order by column_name`,
    );
    expect(columns.map((column) => column.name)).toEqual(
      [
        'id', 'project_id', 'account_id', 'seq', 'command_id', 'mode', 'subject_id', 'scope', 'outcome', 'description', 'personalization_wording', 'personalization_text',
        'personalization_style', 'personalization_applied', 'personalization_reason', 'digest', 'confirmed_at', 'created_at',
        // Story 2.3: whether the person confirmed nothing blocks the subject, and the Generate anyway acknowledgment (when, and the digest it is pinned to).
        'obstruction_confirmed_at', 'incomplete_acknowledged_at', 'incomplete_acknowledged_digest',
      ].sort(),
    );
    // Story 2.2: `scope`, `outcome`, `description` and `confirmed_at` may be null (together, and only together): an unconfirmed picture revision claims none of them.
    expect(columns.filter((column) => column.required).map((column) => column.name)).toEqual(
      ['id', 'project_id', 'account_id', 'seq', 'command_id', 'mode', 'personalization_applied', 'digest', 'created_at'].sort(),
    );
    for (const column of columns) expect(column.name, column.name).not.toMatch(/approv|permission|payment|paid|cost|price|job|reserv|manifest/);
  });

  it('is tied to its Project and Account by a composite foreign key that restricts: a revision cannot point at another Account\'s Project, and a Project with one cannot be deleted', async () => {
    const {rows: keys} = await db.query(
      `select pg_get_constraintdef(c.oid) as definition, c.confdeltype as on_delete from pg_constraint c where c.conrelid = 'projects.request_revisions'::regclass and c.contype = 'f'`,
    );
    expect(keys).toHaveLength(1);
    expect(keys[0].definition).toMatch(/FOREIGN KEY \(project_id, account_id\) REFERENCES projects\.projects\(id, account_id\)/);
    expect(keys[0].on_delete).toBe('r');
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const projectA = await project(client, a);
      const crossed = await revise(client, b, {project_id: projectA});
      expect(crossed.result.ok).toBe(false);
      if (!crossed.result.ok) expect(crossed.result.code).toBe('23503');
      const unknown = await revise(client, a, {project_id: randomUUID()});
      expect(unknown.result.ok).toBe(false);
      if (!unknown.result.ok) expect(unknown.result.code).toBe('23503');
      const made = await revise(client, a);
      expect(made.result.ok).toBe(true);
      const removal = await attempt(client, null, 'delete from projects.projects where id = $1', [made.projectId]);
      expect(removal.ok).toBe(false);
      if (!removal.ok) expect(removal.code).toBe('23503');
    });
  });

  it('numbers its revisions from 1, once for each Project, and gives each command ID to one revision of an Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const first = await revise(client, a);
      expect(first.result.ok).toBe(true);
      for (const seq of [0, -1]) {
        const result = (await revise(client, a, {seq})).result;
        expect(result.ok, `seq ${seq}`).toBe(false);
        if (!result.ok) expect(result.code, `seq ${seq}`).toBe('23514');
      }
      // The same number twice in a Project is refused; a successor is seq + 1. (On purpose changed from the unique key's 23505 to the check of Story 2.2's
      // trigger, `projects.check_revision_seq`, which makes a revision's number the Project's highest plus one and runs before the key is looked at; the key
      // is still the second line, tests/integration/picture-sets.test.ts holds both.)
      const twice = (await revise(client, a, {project_id: first.projectId, seq: 1})).result;
      expect(twice.ok).toBe(false);
      if (!twice.ok) expect(twice.code).toBe('23514');
      expect((await revise(client, a, {project_id: first.projectId, seq: 2})).result.ok).toBe(true);
      // One command ID, one revision, for an Account; another Account may use the same ID.
      const command = randomUUID();
      expect((await revise(client, a, {command_id: command})).result.ok).toBe(true);
      const again = (await revise(client, a, {command_id: command})).result;
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toBe('23505');
      expect((await revise(client, b, {command_id: command})).result.ok).toBe(true);
    });
  });

  it('knows three modes, wants a subject for a text request and lets the other modes go without one', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const mode of ['evidence_text', 'evidence_images', 'image_direct']) expect((await revise(client, a, {mode})).result.ok, mode).toBe(true);
      for (const mode of ['', 'text', 'Evidence_Text', 'evidence-text', 'image_indirect']) {
        const result = (await revise(client, a, {mode})).result;
        expect(result.ok, mode).toBe(false);
        if (!result.ok) expect(result.code, mode).toBe('23514');
      }
      const missing = (await revise(client, a, {mode: 'evidence_text', subject_id: null})).result;
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.code).toBe('23514');
      for (const mode of ['evidence_images', 'image_direct']) expect((await revise(client, a, {mode, subject_id: null})).result.ok, mode).toBe(true);
    });
  });

  it('checks a subject ID against the slug rule (^[a-z][a-z0-9-]{0,62}$), and accepts 63 characters', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const subject of ['middot-altar-ramp', 'a', 'a1-b2', `a${'b'.repeat(62)}`]) expect((await revise(client, a, {subject_id: subject})).result.ok, subject).toBe(true);
      for (const subject of ['', 'Altar', '1altar', '-altar', 'alt_ar', 'alt ar', 'altar ', `a${'b'.repeat(63)}`, 'מזבח']) {
        const result = (await revise(client, a, {subject_id: subject})).result;
        expect(result.ok, JSON.stringify(subject)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(subject)).toBe('23514');
      }
    });
  });

  it('holds scope and outcome to 1 to 300 trimmed characters with no control character at all', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const column of ['scope', 'outcome']) {
        for (const value of ['x', 'x'.repeat(300), 'ש'.repeat(300), '😀'.repeat(300), 'המזבח החיצון והכבש', 'The outer altar and ramp (Middot 3)']) {
          expect((await revise(client, a, {[column]: value})).result.ok, `${column}: ${value.slice(0, 8)}`).toBe(true);
        }
        for (const value of ['', ' ', ' padded', 'padded ', 'x'.repeat(301), '😀'.repeat(301), 'tab\there', 'line\nbreak', 'carriage\rreturn', 'bell\u0007', 'c1\u0085control', 'del\u007f']) {
          const result = (await revise(client, a, {[column]: value})).result;
          expect(result.ok, `${column}: ${JSON.stringify(value).slice(0, 14)}`).toBe(false);
          if (!result.ok) expect(result.code, `${column}: ${JSON.stringify(value).slice(0, 14)}`).toBe('23514');
        }
      }
    });
  });

  it('holds the description to 1 to 2,000 trimmed characters, and lets a newline and a tab into it (and nothing else that is a control character)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const value of ['x', 'x'.repeat(2000), '😀'.repeat(2000), 'line one\nline two', 'a\tb', 'a\n\n\tb', 'ש'.repeat(2000)]) {
        expect((await revise(client, a, {description: value})).result.ok, JSON.stringify(value).slice(0, 14)).toBe(true);
      }
      for (const value of ['', ' ', ' padded', 'padded ', '\npadded', 'padded\n', '\tpadded', 'padded\t', 'x'.repeat(2001), 'carriage\rreturn', 'bell\u0007', 'c1\u0085control', 'del\u007f', 'null\u0001']) {
        const result = (await revise(client, a, {description: value})).result;
        expect(result.ok, JSON.stringify(value).slice(0, 14)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(value).slice(0, 14)).toBe('23514');
      }
    });
  });

  it('holds the personalization wording to 1 to 300 trimmed characters (a newline and a tab allowed) and its text to 1 to 24 with no control character at all', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const wish = (wording: string) => ({personalization_wording: wording, personalization_applied: false, personalization_reason: 'no_quoted_text'});
      for (const value of ['x', 'x'.repeat(300), 'Add "x"\nengraved', 'a\tb', 'ש'.repeat(300)]) {
        expect((await revise(client, a, wish(value))).result.ok, JSON.stringify(value).slice(0, 14)).toBe(true);
      }
      for (const value of ['', ' ', ' padded', 'padded ', 'padded\n', 'x'.repeat(301), 'carriage\rreturn', 'bell\u0007', 'c1\u0085control', 'del\u007f']) {
        const result = (await revise(client, a, wish(value))).result;
        expect(result.ok, JSON.stringify(value).slice(0, 14)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(value).slice(0, 14)).toBe('23514');
      }
      for (const value of ['D', 'x'.repeat(24), 'ש'.repeat(24), '😀'.repeat(24), 'דוד', 'Dav id']) expect((await revise(client, a, wishWithText(value))).result.ok, value).toBe(true);
      for (const value of ['', ' ', ' padded', 'padded ', 'x'.repeat(25), '😀'.repeat(25), 'Dav\tid', 'Dav\nid', 'Dav\rid', 'bell\u0007']) {
        const result = (await revise(client, a, wishWithText(value))).result;
        expect(result.ok, JSON.stringify(value).slice(0, 14)).toBe(false);
        if (!result.ok) expect(result.code, JSON.stringify(value).slice(0, 14)).toBe('23514');
      }
    });
  });

  it('knows two styles and six reasons, and requires the applied flag, the digest and the times', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const style of ['raised', 'recessed']) expect((await revise(client, a, {...wishWithText('David'), personalization_style: style})).result.ok, style).toBe(true);
      for (const style of ['', 'Raised', 'engraved', 'embossed', 'both']) {
        const result = (await revise(client, a, {...wishWithText('David'), personalization_style: style})).result;
        expect(result.ok, style).toBe(false);
        if (!result.ok) expect(result.code, style).toBe('23514');
      }
      for (const reason of ['no_quoted_text', 'several_texts', 'text_too_long', 'text_invalid', 'conflicting_styles', 'image_direct_has_no_surfaces']) {
        expect((await revise(client, a, {personalization_wording: 'x', personalization_reason: reason})).result.ok, reason).toBe(true);
      }
      for (const reason of ['', 'unsupported', 'No_Quoted_Text', 'too_long']) {
        const result = (await revise(client, a, {personalization_wording: 'x', personalization_reason: reason})).result;
        expect(result.ok, reason).toBe(false);
        if (!result.ok) expect(result.code, reason).toBe('23514');
      }
      const noFlag = (await revise(client, a, {personalization_applied: null})).result;
      expect(noFlag.ok).toBe(false);
      if (!noFlag.ok) expect(noFlag.code).toBe('23502');
      for (const digest of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)]) {
        const result = (await revise(client, a, {digest})).result;
        expect(result.ok, digest).toBe(false);
        if (!result.ok) expect(result.code, digest).toBe('23514');
      }
    });
  });

  it('keeps an applied wish whole, a wish that is not applied without text and style, and a reason exactly where there is a wording that was not applied (each refusal a check)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const ok: [string, Record<string, unknown>][] = [
        ['no wish', {}],
        ['an applied wish', {personalization_wording: 'Add "David"', personalization_text: 'David', personalization_style: 'recessed', personalization_applied: true}],
        ['a declined wish', {personalization_wording: 'something nice', personalization_applied: false, personalization_reason: 'no_quoted_text'}],
        ['a declined wish in image_direct', {mode: 'image_direct', personalization_wording: 'Add "David"', personalization_applied: false, personalization_reason: 'image_direct_has_no_surfaces'}],
        ['an applied wish in evidence_images', {mode: 'evidence_images', personalization_wording: 'Add "David"', personalization_text: 'David', personalization_style: 'raised', personalization_applied: true}],
      ];
      for (const [name, patch] of ok) expect((await revise(client, a, patch)).result.ok, name).toBe(true);
      const whole = {personalization_wording: 'Add "David"', personalization_text: 'David', personalization_style: 'recessed', personalization_applied: true};
      const refused: [string, Record<string, unknown>][] = [
        ['applied with no wording', {...whole, personalization_wording: null}],
        ['applied with no text', {...whole, personalization_text: null}],
        ['applied with no style', {...whole, personalization_style: null}],
        ['applied in image_direct', {...whole, mode: 'image_direct'}],
        ['applied with a reason', {...whole, personalization_reason: 'no_quoted_text'}],
        ['not applied with a text', {personalization_wording: 'x', personalization_text: 'David', personalization_applied: false, personalization_reason: 'no_quoted_text'}],
        ['not applied with a style', {personalization_wording: 'x', personalization_style: 'raised', personalization_applied: false, personalization_reason: 'no_quoted_text'}],
        ['no wish but a text', {personalization_text: 'David'}],
        ['no wish but a style', {personalization_style: 'raised'}],
        ['not applied, a wording and no reason', {personalization_wording: 'something nice', personalization_applied: false}],
        ['a reason and no wording', {personalization_reason: 'no_quoted_text'}],
      ];
      for (const [name, patch] of refused) {
        const result = (await revise(client, a, patch)).result;
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('23514');
      }
    });
  });

  it('is never updated and never truncated, and a row can still be deleted (the Epic 8 purge)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await revise(client, a);
      const id = (made.result.ok ? made.result.rows[0].id : '') as string;
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      for (const change of ["scope = 'Changed'", "outcome = 'Changed'", "description = 'Changed'", 'seq = 2', "mode = 'image_direct'", 'personalization_applied = false', `digest = '${'b'.repeat(64)}'`, 'confirmed_at = now()', 'id = id', 'created_at = created_at']) {
        const result = await attempt(client, null, `update projects.request_revisions set ${change} where id = $1`, [id]);
        expect(result.ok, change).toBe(false);
        if (!result.ok) expect(result.code, change).toBe('55000');
      }
      // On purpose changed with Story 2.2: the table is now referenced by projects.request_images, so truncating it alone is refused by that foreign key
      // (0A000) before the trigger is reached; truncating the two together passes the key and meets the triggers of both tables.
      const truncate = await attempt(client, null, 'truncate projects.request_revisions');
      expect(truncate.ok).toBe(false);
      if (!truncate.ok) expect(truncate.code).toBe('0A000');
      const together = await attempt(client, null, 'truncate projects.request_revisions, projects.request_images');
      expect(together.ok).toBe(false);
      if (!together.ok) expect(together.code).toBe('55000');
      expect((await revisionsOf(client, a.accountId))[0]).toMatchObject({scope: 'Scope', seq: 1});
      expect((await attempt(client, null, 'delete from projects.request_revisions where id = $1', [id])).ok).toBe(true);
      expect(await revisionsOf(client, a.accountId)).toEqual([]);
      expect((await attempt(client, null, 'delete from projects.projects where id = $1', [made.projectId])).ok).toBe(true);
    });
  });

  it('is closed: row-level security on, no policy, no privilege for public, anon, authenticated or service_role, no ACL entry for PUBLIC, and nothing over REST', async () => {
    const {rows: found} = await db.query(
      `select c.relrowsecurity as rls, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies from pg_class c where c.oid = 'projects.request_revisions'::regclass`,
    );
    expect(found[0]).toEqual({rls: true, policies: 0});
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      const {rows: privilege} = await db.query(`select has_table_privilege($1, 'projects.request_revisions', 'select,insert,update,delete,truncate,references,trigger') as any_privilege`, [role]);
      expect(privilege[0].any_privilege, role).toBe(false);
    }
    const {rows: publicGrants} = await db.query(`select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = 'projects.request_revisions'::regclass and a.grantee = 0`);
    expect(publicGrants).toEqual([]);
    // Over REST the schema is not exposed at all: every kind of request is "not acceptable", whoever asks.
    for (const key of [stack.anonKey, stack.serviceKey]) {
      const headers = {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'accept-profile': 'projects', 'content-profile': 'projects'};
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_revisions?select=*`, {headers})).status).toBe(406);
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_revisions`, {method: 'POST', headers, body: '{}'})).status).toBe(406);
      expect((await fetch(`${stack.apiUrl}/rest/v1/request_revisions?select=*`, {method: 'DELETE', headers})).status).toBe(406);
    }
  });

  it('gives the roles nothing directly either: anon, authenticated and service_role are refused every statement on it', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const sql of ['select * from projects.request_revisions', 'insert into projects.request_revisions default values', 'delete from projects.request_revisions', 'truncate projects.request_revisions']) {
          const result = await attempt(client, role, sql);
          expect(result.ok, `${role}: ${sql}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${sql}`).toBe('42501');
        }
      }
    });
  });

  it('widens the Project\'s stage check: request_confirmed is allowed (and, since Story 2.2, request_draft), the old six still are, and any other is refused', async () => {
    const {rows: definition} = await db.query(`select pg_get_constraintdef(oid) as text from pg_constraint where conrelid = 'projects.projects'::regclass and conname = 'projects_stage_check'`);
    for (const stage of projectStages) expect(definition[0].text, stage).toContain(`'${stage}'`);
    expect([...projectStages]).toHaveLength(8);
    await inTx(async (client) => {
      const a = await account(client);
      for (const stage of projectStages) expect((await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'x', $3)`, [a.workspaceId, a.accountId, stage])).ok, stage).toBe(true);
      for (const stage of ['draft', 'Request_Confirmed', 'request-confirmed', 'confirmed', 'Request_Draft', 'request-draft', '']) {
        const result = await attempt(client, null, `insert into projects.projects (workspace_id, account_id, title, stage) values ($1, $2, 'x', $3)`, [a.workspaceId, a.accountId, stage]);
        expect(result.ok, stage).toBe(false);
        if (!result.ok) expect(result.code, stage).toBe('23514');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.create_project_request: one command creates the Project and its first revision', () => {
  it('creates both in the Account\'s Workspace in one transaction, holding exactly the values, with the digest of the length-prefixed fields', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sent = request(a, {...applied, scope: 'The altar, edited', outcome: 'A print I can hold', description: 'Please build the altar and ramp,\nand add "David" engraved on the base'});
      const made = (await createRaw(client, sent)) as {ok: true; rows: Record<string, any>[]};
      expect(made.ok).toBe(true);
      expect(made.rows[0]).toMatchObject({outcome: 'created'});
      const [row] = await projectsOf(client, a.accountId);
      expect(made.rows[0].project_id).toBe(row.id);
      expect(row).toMatchObject({title: TITLE, stage: 'request_confirmed', revision: 1, current_version: 0, workspace_id: a.workspaceId, deleted_at: null});
      expect(row.created_at).toEqual(row.updated_at);
      const [revision, ...others] = await revisionsOf(client, a.accountId);
      expect(others).toEqual([]);
      expect(made.rows[0].request_id).toBe(revision.id);
      expect(revision).toMatchObject({
        project_id: row.id,
        account_id: a.accountId,
        seq: 1,
        command_id: sent.command,
        mode: 'evidence_text',
        subject_id: 'middot-altar-ramp',
        scope: 'The altar, edited',
        outcome: 'A print I can hold',
        description: 'Please build the altar and ramp,\nand add "David" engraved on the base',
        wording: 'Add "David" engraved on the base',
        text: 'David',
        style: 'recessed',
        applied: true,
        reason: null,
        digest: digestOf(sent),
      });
      // The revision is confirmed at the moment the Project is created.
      expect(revision.confirmed_at).toEqual(revision.created_at);
      expect(revision.confirmed_at).toEqual(row.created_at);
    });
  });

  it('records no wish as no wish, a declined wish as not applied with its reason, and an applied wish in either style', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const none = await create(client, a);
      const wishless = (await revisionsOf(client, a.accountId)).find((entry) => entry.id === none.request_id);
      expect(wishless).toMatchObject({wording: null, text: null, style: null, applied: false, reason: null});
      const refused = await create(client, a, declined);
      expect((await revisionsOf(client, a.accountId)).find((entry) => entry.id === refused.request_id)).toMatchObject({wording: 'add something nice', text: null, style: null, applied: false, reason: 'no_quoted_text'});
      const raised = await create(client, a, {wording: 'Add "דוד"', text: 'דוד', style: 'raised', applied: true});
      expect((await revisionsOf(client, a.accountId)).find((entry) => entry.id === raised.request_id)).toMatchObject({text: 'דוד', style: 'raised', applied: true, reason: null});
      expect(await counts(client, a.accountId)).toEqual({projects: 3, revisions: 3});
    });
  });

  it('accepts every limit at its boundary: a title of 120, scope and outcome of 300, a description of 2,000 with a newline and a tab, wording of 300 and a text of 24', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await create(client, a, {
        title: 'ש'.repeat(120),
        scope: 'x'.repeat(300),
        outcome: '😀'.repeat(300),
        description: `${'line\t'.repeat(10)}\n${'y'.repeat(1949)}`,
        wording: 'w'.repeat(300),
        text: '😀'.repeat(24),
        style: 'raised',
        applied: true,
      });
      expect(made.outcome).toBe('created');
      expect((await projectsOf(client, a.accountId))[0].title).toBe('ש'.repeat(120));
    });
  });

  it('creates a request in a picture mode without a subject: the subject is required for text only', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      expect((await create(client, a, {mode: 'evidence_images', subject: null})).outcome).toBe('created');
      expect((await create(client, a, {mode: 'image_direct', subject: null})).outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId)).map((entry) => [entry.mode, entry.subject_id])).toEqual(expect.arrayContaining([['evidence_images', null], ['image_direct', null]]));
    });
  });

  it('answers `replayed` with the original IDs for the same command and the same payload, and writes nothing more (even after the Project was renamed)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sent = request(a, applied);
      const first = (await createRaw(client, sent)) as {ok: true; rows: Record<string, any>[]};
      expect(first.rows[0].outcome).toBe('created');
      const again = (await createRaw(client, sent)) as {ok: true; rows: Record<string, any>[]};
      expect(again.rows[0]).toEqual({outcome: 'replayed', project_id: first.rows[0].project_id, request_id: first.rows[0].request_id});
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1});
      // The Project moved on (a rename raised its revision); the original receipt is still the answer.
      expect((await rename(client, a, {projectId: first.rows[0].project_id, title: 'Renamed', command: randomUUID()})).outcome).toBe('renamed');
      expect((await createRaw(client, sent) as {rows: Record<string, any>[]}).rows[0]).toEqual({outcome: 'replayed', project_id: first.rows[0].project_id, request_id: first.rows[0].request_id});
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1});
      expect((await projectsOf(client, a.accountId))[0]).toMatchObject({title: 'Renamed', revision: 2, stage: 'request_confirmed'});
    });
  });

  it('answers `reused`, and writes nothing, for the same command with any one field changed (the title included)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const command = randomUUID();
      const sent = request(a, {command});
      expect((await create(client, a, sent)).outcome).toBe('created');
      const changes: [string, Partial<Request>][] = [
        ['title', {title: 'Another title'}],
        ['mode', {mode: 'evidence_images'}],
        ['subject', {subject: 'another-subject'}],
        ['scope', {scope: 'Another scope'}],
        ['outcome', {outcome: 'Another outcome'}],
        ['description', {description: 'Another description'}],
        ['an applied wish', applied],
        ['a declined wish', declined],
        // The fields are length-prefixed, so moving a character from one to the next is a different payload.
        ['a character moved from the scope to the outcome', {scope: sent.scope!.slice(0, -1), outcome: `${sent.scope!.slice(-1)}${sent.outcome}`}],
      ];
      for (const [name, change] of changes) {
        const result = await create(client, a, {...sent, ...change});
        expect(result, name).toEqual({outcome: 'reused', project_id: null, request_id: null});
      }
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1});
      // The same payload is still the original receipt.
      expect((await create(client, a, sent)).outcome).toBe('replayed');
    });
  });

  it('tells apart wording that is absent from wording that is a dash, and one reason from another, in the digest', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const command = randomUUID();
      expect((await create(client, a, {command, wording: '-', reason: 'no_quoted_text'})).outcome).toBe('created');
      expect((await create(client, a, {command})).outcome).toBe('reused');
      expect((await create(client, a, {command, wording: '-', reason: 'several_texts'})).outcome).toBe('reused');
      expect((await create(client, a, {command, wording: '-', reason: 'no_quoted_text'})).outcome).toBe('replayed');
    });
  });

  it('answers `unavailable`, with no IDs, and writes nothing, for a replay once its Project is deleted or tombstoned: a receipt does not outlive its Project\'s visibility (A1)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const live = request(a, {description: 'The live one'});
      const deleted = request(a, {description: 'The deleted one'});
      const tombstoned = request(a, {description: 'The tombstoned one'});
      const hidden = request(a, {description: 'The hidden one'});
      const ids: Record<string, string> = {};
      for (const sent of [live, deleted, tombstoned, hidden]) ids[sent.description!] = (await create(client, a, sent)).project_id;
      expect(await counts(client, a.accountId)).toEqual({projects: 4, revisions: 4});
      const before = (await revisionsOf(client, a.accountId)).map((row) => row.id);

      // While the Project is live a replay is the original receipt, as before.
      expect((await create(client, a, live)).outcome).toBe('replayed');

      // Deleted (deleted_at set, the revision raised by one, as a deletion will do).
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [ids[deleted.description!]]);
      // Tombstoned through the one writer, which hides the Project first.
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', ids[tombstoned.description!]])).outcome).toBe('recorded');
      // A tombstone with the Project still showing (no deleted_at): the replay asks the tombstone itself.
      await client.query(`insert into lifecycle.tombstones (kind, target_id, status_handle, revision) select 'project', id, status_handle, revision from projects.projects where id = $1`, [ids[hidden.description!]]);

      for (const gone of [deleted, tombstoned, hidden]) {
        expect(await create(client, a, gone), gone.description ?? '').toEqual({outcome: 'unavailable', project_id: null, request_id: null});
      }
      // The live one is untouched by the others' going.
      expect((await create(client, a, live)).outcome).toBe('replayed');
      // Nothing was written: the same four Projects and revisions, the same revision rows.
      expect(await counts(client, a.accountId)).toEqual({projects: 4, revisions: 4});
      expect((await revisionsOf(client, a.accountId)).map((row) => row.id)).toEqual(before);

      // Another payload under a command ID whose Project is gone is still a reused ID, not an unavailable replay.
      for (const gone of [deleted, tombstoned, hidden]) {
        expect(await create(client, a, {...gone, scope: 'Another scope'}), `${gone.description} with another payload`).toEqual({outcome: 'reused', project_id: null, request_id: null});
      }
      // A replay by another Account of the same command ID is that Account's own new request, not this one's receipt.
      const b = await account(client);
      expect((await create(client, b, {...deleted, account: b.accountId, epoch: b.epoch})).outcome).toBe('created');
    });
  });

  it('names the outcomes in the function\'s comment: created, replayed, reused, unavailable and denied', async () => {
    const {rows: found} = await db.query(`select obj_description(p.oid, 'pg_proc') as comment from pg_proc p where p.proname = 'create_project_request' and p.pronamespace = 'api'::regnamespace`);
    const comment = String(found[0].comment);
    for (const outcome of ['created', 'replayed', 'reused', 'unavailable', 'denied']) expect(comment, outcome).toContain(outcome);
  });

  it('answers `reused` for a command ID that a rename already used, and writes nothing', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await create(client, a);
      const command = randomUUID();
      expect((await rename(client, a, {projectId: made.project_id, title: 'Renamed', command})).outcome).toBe('renamed');
      const before = await counts(client, a.accountId);
      expect(await create(client, a, {command})).toEqual({outcome: 'reused', project_id: null, request_id: null});
      expect(await counts(client, a.accountId)).toEqual(before);
    });
  });

  it('keeps command IDs to the Account: another Account may use the same ID for a request of its own', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const command = randomUUID();
      const first = await create(client, a, {command});
      const second = await create(client, b, {command});
      expect([first.outcome, second.outcome]).toEqual(['created', 'created']);
      expect(second.project_id).not.toBe(first.project_id);
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1});
      expect(await counts(client, b.accountId)).toEqual({projects: 1, revisions: 1});
    });
  });

  it('answers `denied`, and writes nothing, to a disabled Account, a stale epoch, an epoch from the future, an unknown Account and a tombstoned Account', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const denied = {outcome: 'denied', project_id: null, request_id: null};
      // A stale epoch: the Account's epoch was raised after the request was authorized.
      expect((await api(client).raiseEpoch(a.accountId)).epoch).toBe(2);
      expect(await create(client, a, {epoch: 1})).toEqual(denied);
      expect(await create(client, a, {epoch: 99})).toEqual(denied);
      expect((await create(client, a, {epoch: 2})).outcome).toBe('created');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect(await create(client, a, {epoch: 3})).toEqual(denied);
      expect(await create(client, a, {epoch: 2})).toEqual(denied);
      // An Account that does not exist.
      expect(await create(client, {...a, accountId: randomUUID()}, {epoch: 1})).toEqual(denied);
      expect(await counts(client, a.accountId)).toEqual({projects: 1, revisions: 1});
      // A tombstoned Account.
      const b = await account(client);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['account', b.accountId])).outcome).toBe('recorded');
      expect(await create(client, b, {epoch: 2})).toEqual(denied);
      expect(await create(client, b, {epoch: 1})).toEqual(denied);
      expect(await counts(client, b.accountId)).toEqual({projects: 0, revisions: 0});
    });
  });

  it('checks the arguments first (a shape the application would never send is 22023, even for an Account without authority) and the authority before any lookup (a denied Account learns nothing of a command it sent)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sent = request(a, applied);
      expect((await create(client, a, sent)).outcome).toBe('created');
      const renamedCommand = randomUUID();
      const made = (await projectsOf(client, a.accountId))[0];
      expect((await rename(client, a, {projectId: made.id, title: 'Renamed', command: renamedCommand})).outcome).toBe('renamed');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      // Authority before the lookups: neither the replay of its own command nor the reuse of a rename's ID is answered to a disabled Account.
      expect((await create(client, a, {...sent, epoch: 2})).outcome).toBe('denied');
      expect((await create(client, a, {command: renamedCommand, epoch: 2})).outcome).toBe('denied');
      // The shape first: a disabled Account sending nonsense is told so, not `denied`.
      const nonsense = await createRaw(client, request(a, {title: '', epoch: 2}));
      expect(nonsense.ok).toBe(false);
      if (!nonsense.ok) expect(nonsense.code).toBe('22023');
      const ghost = await createRaw(client, request({...a, accountId: randomUUID()}, {scope: 'padded '}));
      expect(ghost.ok).toBe(false);
      if (!ghost.ok) expect(ghost.code).toBe('22023');
    });
  });

  const invalid: [string, Partial<Request>][] = [
    ['no Account', {account: null as unknown as string}],
    ['no epoch', {epoch: null}],
    ['an epoch of 0', {epoch: 0}],
    ['a negative epoch', {epoch: -1}],
    ['no command ID', {command: null}],
    ['no title', {title: null}],
    ['a blank title', {title: ''}],
    ['a padded title', {title: ' The altar'}],
    ['a title over 120 characters', {title: 'x'.repeat(121)}],
    ['a title with a control character', {title: 'The\u0007 altar'}],
    ['a title with a newline', {title: 'The\naltar'}],
    ['no mode', {mode: null}],
    ['an unknown mode', {mode: 'evidence'}],
    ['a subject that is not a slug', {subject: 'The Altar'}],
    ['a subject starting with a digit', {subject: '1altar'}],
    ['a subject of 64 characters', {subject: `a${'b'.repeat(63)}`}],
    ['a text request without a subject', {subject: null}],
    ['no scope', {scope: null}],
    ['a blank scope', {scope: ' '}],
    ['a padded scope', {scope: 'Scope '}],
    ['a scope over 300 characters', {scope: 'x'.repeat(301)}],
    ['a scope with a newline', {scope: 'two\nlines'}],
    ['a scope with a tab', {scope: 'two\tparts'}],
    ['no outcome', {outcome: null}],
    ['a blank outcome', {outcome: ''}],
    ['a padded outcome', {outcome: ' Outcome'}],
    ['an outcome over 300 characters', {outcome: 'x'.repeat(301)}],
    ['an outcome with a control character', {outcome: 'bell\u0007'}],
    ['no description', {description: null}],
    ['a blank description', {description: '  '}],
    ['a description with a newline around it', {description: '\nBuild the altar'}],
    ['a description over 2,000 characters', {description: 'x'.repeat(2001)}],
    ['a description with a carriage return', {description: 'two\r\nlines'}],
    ['a description with a bell', {description: 'Build\u0007'}],
    ['an empty wording', {wording: '', reason: 'no_quoted_text'}],
    ['a padded wording', {wording: ' Add "David"', reason: 'no_quoted_text'}],
    ['a wording over 300 characters', {wording: 'x'.repeat(301), reason: 'no_quoted_text'}],
    ['a wording with a bell', {wording: 'Add\u0007', reason: 'no_quoted_text'}],
    ['a text over 24 characters', {...applied, text: 'x'.repeat(25)}],
    ['a text with a tab', {...applied, text: 'Dav\tid'}],
    ['an empty text', {...applied, text: ''}],
    ['an unknown style', {...applied, style: 'engraved'}],
    ['an unknown reason', {...declined, reason: 'unsupported'}],
    ['no applied flag', {applied: null}],
    ['an applied wish without wording', {...applied, wording: null}],
    ['an applied wish without text', {...applied, text: null}],
    ['an applied wish without style', {...applied, style: null}],
    ['an applied wish with a reason', {...applied, reason: 'no_quoted_text'}],
    ['an applied wish in image_direct', {...applied, mode: 'image_direct'}],
    ['a wish that is not applied, with a text', {...declined, text: 'David'}],
    ['a wish that is not applied, with a style', {...declined, style: 'raised'}],
    ['a text without a wish', {text: 'David'}],
    ['a style without a wish', {style: 'raised'}],
    ['a wording that was not applied, and no reason', {wording: 'add something nice', reason: null}],
    ['a reason without a wording', {reason: 'no_quoted_text'}],
  ];
  it.each(invalid)('raises 22023 for %s, and writes nothing', async (_name, patch) => {
    await inTx(async (client) => {
      const a = await account(client);
      const result = await createRaw(client, request(a, patch));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('22023');
      expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0});
    });
  });

  // Text that draws nothing, and bidirectional controls (A3): refused by the function (22023) and by the table (23514), for every text field.
  const draws = {
    'only a zero-width space (U+200B)': '\u200b',
    'only a Braille blank (U+2800)': '\u2800',
    'only a Hangul filler (U+3164)': '\u3164',
    'only zero-width joiners and a no-break space': '\u200c\u200d\u00a0',
    'a bidi override (U+202E) between letters': 'ab\u202ecd',
    'a bidi embedding (U+202A) at the start': '\u202aabc',
    'a bidi isolate (U+2066) at the end': 'abc\u2066',
    'a bidi isolate pop (U+2069)': 'a\u2069b',
  } as const;
  const textFields = [
    // [name, how the function is sent the value, how the table is given it]
    ['description', (value: string) => ({description: value}), (value: string) => ({description: value})],
    ['scope', (value: string) => ({scope: value}), (value: string) => ({scope: value})],
    ['outcome', (value: string) => ({outcome: value}), (value: string) => ({outcome: value})],
    ['personalization wording', (value: string) => ({wording: value, text: null, style: null, applied: false, reason: 'no_quoted_text'}), (value: string) => ({personalization_wording: value, personalization_applied: false, personalization_reason: 'no_quoted_text'})],
    ['personalization text', (value: string) => ({...applied, text: value}), (value: string) => wishWithText(value)],
  ] as const;

  it.each(textFields.flatMap(([name, viaFunction, viaTable]) => Object.entries(draws).map(([what, value]) => [name, what, value, viaFunction, viaTable] as const)))(
    'refuses %s that is %s: 22023 from the function and 23514 from the table, and writes nothing',
    async (_name, _what, value, viaFunction, viaTable) => {
      await inTx(async (client) => {
        const a = await account(client);
        const function_ = await createRaw(client, request(a, viaFunction(value)));
        expect(function_.ok).toBe(false);
        if (!function_.ok) expect(function_.code).toBe('22023');
        expect(await counts(client, a.accountId)).toEqual({projects: 0, revisions: 0});
        const table = (await revise(client, a, viaTable(value))).result;
        expect(table.ok).toBe(false);
        if (!table.ok) expect(table.code).toBe('23514');
      });
    },
  );

  it('accepts a zero-width non-joiner (U+200C) and joiner (U+200D) between letters, in every text field, and gives them back unchanged (A3)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const persian = 'می\u200cخواهم';
      const hebrew = 'א\u200cב';
      const emoji = '👨\u200d👩\u200d👧';
      const sent = request(a, {description: `${persian} ${emoji} ${hebrew}`, scope: persian, outcome: emoji, wording: `Add "${hebrew}" raised`, text: hebrew, style: 'raised', applied: true, reason: null});
      const made = await create(client, a, sent);
      expect(made.outcome).toBe('created');
      expect(await read(client, a, made.project_id)).toMatchObject({
        outcome: 'found',
        description: `${persian} ${emoji} ${hebrew}`,
        scope: persian,
        intended_outcome: emoji,
        personalization_wording: `Add "${hebrew}" raised`,
        personalization_text: hebrew,
      });
      // The table takes them directly too, in each field.
      for (const column of ['description', 'scope', 'outcome']) expect((await revise(client, a, {[column]: persian})).result.ok, column).toBe(true);
      expect((await revise(client, a, {personalization_wording: persian, personalization_applied: false, personalization_reason: 'no_quoted_text'})).result.ok).toBe(true);
      expect((await revise(client, a, wishWithText(emoji))).result.ok).toBe(true);
      // A replay of it is still the original receipt.
      expect((await create(client, a, sent)).outcome).toBe('replayed');
    });
  });

  it('takes no wording as NULL only: an empty or zero-width-only wording is refused, and the revision then holds NULL (the application sends NULL for it)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      for (const wording of ['', ' ', '\u200b']) {
        const refused = await createRaw(client, request(a, {wording, reason: 'no_quoted_text'}));
        expect(refused.ok, JSON.stringify(wording)).toBe(false);
        if (!refused.ok) expect(refused.code).toBe('22023');
      }
      const made = await create(client, a, {wording: null});
      expect(made.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[0]).toMatchObject({wording: null, text: null, style: null, applied: false, reason: null});
    });
  });

  it('declines an image_direct wish only as not applied, with the no-surfaces reason: the function accepts that, refuses to apply it, and the table refuses it too (AC-4)', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const wish = {mode: 'image_direct', wording: 'Add "David" engraved on the base', text: null, style: null, applied: false, reason: 'image_direct_has_no_surfaces'} as const;
      const made = await create(client, a, wish);
      expect(made.outcome).toBe('created');
      expect((await revisionsOf(client, a.accountId))[0]).toMatchObject({mode: 'image_direct', wording: 'Add "David" engraved on the base', text: null, style: null, applied: false, reason: 'image_direct_has_no_surfaces'});
      const function_ = await createRaw(client, request(a, {...wish, text: 'David', style: 'recessed', applied: true, reason: null}));
      expect(function_.ok).toBe(false);
      if (!function_.ok) expect(function_.code).toBe('22023');
      const table = (
        await revise(client, a, {mode: 'image_direct', personalization_wording: 'Add "David"', personalization_text: 'David', personalization_style: 'recessed', personalization_applied: true})
      ).result;
      expect(table.ok).toBe(false);
      if (!table.ok) expect(table.code).toBe('23514');
      // One revision: the declined one. (The direct insert made a bare Project of its own before the table refused its revision.)
      expect(await counts(client, a.accountId)).toEqual({projects: 2, revisions: 1});
    });
  });

  it('never names the status handle, in a function or a type, and returns nothing of a Project but its IDs', async () => {
    const {rows: functions} = await db.query(
      `select p.proname as name, pg_get_functiondef(p.oid) as definition from pg_proc p
        where p.pronamespace in ('api'::regnamespace, 'projects'::regnamespace) and p.proname in ('create_project_request', 'read_project_request', 'length_prefixed', 'refuse_revision_change', 'is_invisible', 'has_bidi_control')`,
    );
    expect(functions.map((entry) => entry.name).sort()).toEqual(['create_project_request', 'has_bidi_control', 'is_invisible', 'length_prefixed', 'read_project_request', 'refuse_revision_change']);
    for (const entry of functions) expect(entry.definition, entry.name).not.toMatch(/status_handle|handle/i);
    const {rows: types} = await db.query(
      `select t.typname, a.attname from pg_type t join pg_class c on c.oid = t.typrelid join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
        where t.typnamespace = 'api'::regnamespace and t.typname in ('request_creation', 'project_request_view') order by 1, 2`,
    );
    expect(types.filter((entry) => entry.typname === 'request_creation').map((entry) => entry.attname)).toEqual(['outcome', 'project_id', 'request_id']);
    expect(types.map((entry) => entry.attname).join()).not.toMatch(/handle/i);
  });

  it('is executable by the service role alone, as its owner with an empty search path; the digest helper and the two text checks by no one but the owner', async () => {
    const {rows: found} = await db.query(
      `select n.nspname as schema, p.proname as name, p.prosecdef as definer, p.proconfig as config,
              coalesce((select array_agg(case when a.grantee = 0 then 'public' else a.grantee::regrole::text end order by 1) from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner), '{}') as grantees
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('create_project_request', 'read_project_request', 'length_prefixed', 'refuse_revision_change', 'is_invisible', 'has_bidi_control') order by 1, 2`,
    );
    expect(found.map((entry) => `${entry.schema}.${entry.name}`)).toEqual([
      'api.create_project_request', 'api.read_project_request', 'projects.has_bidi_control', 'projects.is_invisible', 'projects.length_prefixed', 'projects.refuse_revision_change',
    ]);
    for (const entry of found) {
      expect(String(entry.config), entry.name).toContain('search_path=');
      if (entry.schema === 'api') {
        expect(entry.grantees, entry.name).toEqual(['service_role']);
        expect(entry.definer, entry.name).toBe(true);
      } else {
        expect(entry.grantees, entry.name).toEqual([]);
      }
    }
    await inTx(async (client) => {
      const who = await account(client);
      for (const role of ['anon', 'authenticated']) {
        for (const [sql, params] of [
          [createSql, valuesOf(request(who))],
          ['select * from api.read_project_request($1, 1, gen_random_uuid())', [who.accountId]],
        ] as const) {
          const result = await attempt(client, role, sql, [...params]);
          expect(result.ok, `${role}: ${sql.slice(0, 40)}`).toBe(false);
          if (!result.ok) expect(result.code).toBe('42501');
        }
      }
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const call of [`select projects.length_prefixed('x')`, `select projects.is_invisible('x')`, `select projects.has_bidi_control('x')`]) {
          const result = await attempt(client, role, call);
          expect(result.ok, `${role}: ${call}`).toBe(false);
          if (!result.ok) expect(result.code, `${role}: ${call}`).toBe('42501');
        }
      }
      expect(await counts(client, who.accountId)).toEqual({projects: 0, revisions: 0});
    });
  });

  it('is refused to a browser role over REST, with a permission error and no data, and answered to the service role', async () => {
    const a = await committedAccount();
    const call = (key: string, body: Record<string, unknown>) =>
      fetch(`${stack.apiUrl}/rest/v1/rpc/create_project_request`, {
        method: 'POST',
        headers: {apikey: stack.anonKey, authorization: `Bearer ${key}`, 'content-type': 'application/json', 'content-profile': 'api'},
        body: JSON.stringify(body),
      });
    const sent = request(a, applied);
    const body = {
      p_account_id: sent.account, p_epoch: sent.epoch, p_command_id: sent.command, p_title: sent.title, p_mode: sent.mode, p_subject_id: sent.subject, p_scope: sent.scope, p_outcome: sent.outcome,
      p_description: sent.description, p_personalization_wording: sent.wording, p_personalization_text: sent.text, p_personalization_style: sent.style, p_personalization_applied: sent.applied,
      p_personalization_reason: sent.reason,
    };
    for (const key of [stack.anonKey]) {
      const refused = await call(key, body);
      const text = await refused.text();
      expect(refused.status).toBeGreaterThanOrEqual(401);
      expect(refused.status).toBeLessThan(500);
      expect(JSON.parse(text).code).toBe('42501');
      expect(text).not.toContain(a.accountId);
    }
    expect(await counts(db, a.accountId)).toEqual({projects: 0, revisions: 0});
    const accepted = await call(stack.serviceKey, body);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({outcome: 'created'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the digest helper and the two text checks', () => {
  it('keeps projects.length_prefixed truly immutable and free of convert_to (A2): the length is octet_length in the UTF8 database', async () => {
    const {rows: found} = await db.query(
      `select p.provolatile as volatility, p.prosrc as source, pg_encoding_to_char(d.encoding) as encoding
         from pg_proc p, pg_database d where p.proname = 'length_prefixed' and p.pronamespace = 'projects'::regnamespace and d.datname = current_database()`,
    );
    expect(found).toHaveLength(1);
    expect(found[0].volatility).toBe('i');
    expect(found[0].source).not.toContain('convert_to');
    expect(found[0].source).toContain('octet_length(p_value)');
    expect(found[0].encoding).toBe('UTF8');
    // Its answer is the byte length for text in any script, a dash for none.
    const {rows: lengths} = await db.query(
      `select projects.length_prefixed('abc') as latin, projects.length_prefixed('שלום') as hebrew, projects.length_prefixed('👨\u200d👩\u200d👧') as emoji, projects.length_prefixed('') as empty, projects.length_prefixed(null) as absent`,
    );
    expect(lengths[0]).toEqual({latin: '3:abc', hebrew: `${Buffer.byteLength('שלום', 'utf8')}:שלום`, emoji: `${Buffer.byteLength('👨\u200d👩\u200d👧', 'utf8')}:👨\u200d👩\u200d👧`, empty: '0:', absent: '-'});
  });

  it('holds the SQL class of text that draws nothing equal to the JavaScript one over every code point (A3)', async () => {
    // lib/request-intake.ts removes \p{Cc}\p{Cf}\p{Z} and four fill characters; Postgres has no Unicode properties, so the migration writes the same class out.
    const draws = /^[\p{Cc}\p{Cf}\p{Z}\u2800\u3164\u115f\u1160]$/u;
    const expected: number[] = [];
    for (let point = 1; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      if (draws.test(String.fromCodePoint(point))) expected.push(point);
    }
    const {rows: found} = await db.query(`select cp from generate_series(1, 1114111) cp where cp not between 55296 and 57343 and projects.is_invisible(chr(cp)) order by cp`);
    const actual = found.map((row) => Number(row.cp));
    expect(actual.length).toBeGreaterThan(200);
    expect(actual).toEqual(expected);
    // The empty text draws nothing either; U+0000 cannot be stored in a text at all.
    expect((await db.query(`select projects.is_invisible('') as empty, projects.is_invisible(null) as absent`)).rows[0]).toEqual({empty: true, absent: null});
  });

  it('is invisible only when the WHOLE text draws nothing: a joiner between letters is not, a joiner alone is', async () => {
    const {rows: found} = await db.query(
      `select projects.is_invisible('א' || chr(8204) || 'ב') as zwnj_between, projects.is_invisible('a' || chr(8205) || 'b') as zwj_between,
              projects.is_invisible(chr(8204)) as zwnj_alone, projects.is_invisible(chr(8205)) as zwj_alone, projects.is_invisible(chr(8203) || ' ' || chr(10240)) as mixed,
              projects.is_invisible(chr(8203) || 'x') as with_a_letter`,
    );
    expect(found[0]).toEqual({zwnj_between: false, zwj_between: false, zwnj_alone: true, zwj_alone: true, mixed: true, with_a_letter: false});
  });

  it('holds the bidirectional controls to exactly U+202A to U+202E and U+2066 to U+2069 over every code point, and U+200C and U+200D are not among them (A3)', async () => {
    const {rows: found} = await db.query(`select cp from generate_series(1, 1114111) cp where cp not between 55296 and 57343 and projects.has_bidi_control(chr(cp)) order by cp`);
    expect(found.map((row) => Number(row.cp))).toEqual([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);
    expect((await db.query(`select projects.has_bidi_control(chr(8204)) as zwnj, projects.has_bidi_control(chr(8205)) as zwj, projects.has_bidi_control(chr(8206)) as lrm, projects.has_bidi_control('abc') as plain`)).rows[0]).toEqual({
      zwnj: false,
      zwj: false,
      lrm: false,
      plain: false,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('api.read_project_request: the latest revision, or one answer for everything that is not the Account\'s', () => {
  it('answers the latest revision\'s fields for its owner, and the highest seq when there are successors', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const sent = request(a, {...applied, scope: 'First scope'});
      const made = await create(client, a, sent);
      const first = await read(client, a, made.project_id);
      expect(first).toEqual({
        outcome: 'found',
        request_id: made.request_id,
        project_id: made.project_id,
        seq: 1,
        mode: 'evidence_text',
        subject_id: 'middot-altar-ramp',
        scope: 'First scope',
        intended_outcome: sent.outcome,
        description: sent.description,
        personalization_wording: applied.wording,
        personalization_text: 'David',
        personalization_style: 'recessed',
        personalization_applied: true,
        personalization_reason: null,
        confirmed_at: (await revisionsOf(client, a.accountId))[0].confirmed_at,
        // Story 2.2: a confirmed revision says so and has no pictures. Story 2.3: and was not reviewed.
        confirmed: true,
        images: [],
        obstruction_confirmed: false,
        obstruction_confirmed_at: null,
        acknowledged: false,
        acknowledged_at: null,
      });
      // A successor (Stories 2.2, 2.3, 2.12, 2.13) is appended with seq + 1 and raises the Project's revision by one; the read answers the latest.
      await client.query('update projects.projects set revision = revision + 1, updated_at = clock_timestamp() where id = $1', [made.project_id]);
      const successor = await revise(client, a, {project_id: made.project_id, seq: 2, scope: 'Second scope', mode: 'evidence_images', subject_id: null, command_id: randomUUID()});
      expect(successor.result.ok).toBe(true);
      expect(await read(client, a, made.project_id)).toMatchObject({outcome: 'found', seq: 2, scope: 'Second scope', mode: 'evidence_images', subject_id: null, personalization_applied: false});
    });
  });

  it('answers `none` for a Project that has no revision', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const id = await project(client, a);
      expect(await read(client, a, id)).toEqual({outcome: 'none', ...nothing});
    });
  });

  it('answers `unavailable` with nothing in it, and the very same row, for another Account\'s Project, a deleted one, a tombstoned one and one that never existed', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const b = await account(client);
      const theirs = await create(client, b);
      const deleted = await create(client, a);
      await client.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [deleted.project_id]);
      const tombstoned = await create(client, a);
      expect((await asService(client, 'select outcome from api.record_tombstone($1, $2)', ['project', tombstoned.project_id])).outcome).toBe('recorded');
      // A tombstone with the Project still showing (no deleted_at): the read asks the tombstone itself.
      const hidden = await create(client, a);
      await client.query(`insert into lifecycle.tombstones (kind, target_id, status_handle, revision) select 'project', id, status_handle, revision from projects.projects where id = $1`, [hidden.project_id]);
      const answers = [
        await read(client, a, theirs.project_id),
        await read(client, a, deleted.project_id),
        await read(client, a, tombstoned.project_id),
        await read(client, a, hidden.project_id),
        await read(client, a, randomUUID()),
      ];
      for (const answer of answers) expect(answer).toEqual({outcome: 'unavailable', ...nothing});
      // The owner of the other one still reads it.
      expect((await read(client, b, theirs.project_id)).outcome).toBe('found');
    });
  });

  it('answers `denied` to a disabled Account, a stale epoch and an Account that does not exist, before it looks at the Project', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await create(client, a);
      expect((await api(client).raiseEpoch(a.accountId)).epoch).toBe(2);
      expect(await read(client, a, made.project_id, 1)).toEqual({outcome: 'denied', ...nothing});
      expect(await read(client, a, made.project_id, 99)).toEqual({outcome: 'denied', ...nothing});
      expect((await read(client, a, made.project_id, 2)).outcome).toBe('found');
      await client.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
      expect((await read(client, a, made.project_id, 3)).outcome).toBe('denied');
      // A denied request cannot tell a Project that exists from one that does not.
      expect(await read(client, a, made.project_id, 3)).toEqual(await read(client, a, randomUUID(), 3));
      expect(await read(client, {...a, accountId: randomUUID()}, made.project_id, 1)).toEqual({outcome: 'denied', ...nothing});
    });
  });

  it('raises 22023 for an argument that is missing or not an epoch', async () => {
    await inTx(async (client) => {
      const a = await account(client);
      const made = await create(client, a);
      for (const [name, params] of [
        ['no Account', [null, 1, made.project_id]],
        ['no epoch', [a.accountId, null, made.project_id]],
        ['an epoch of 0', [a.accountId, 0, made.project_id]],
        ['no Project', [a.accountId, 1, null]],
      ] as const) {
        const result = await attempt(client, 'service_role', 'select * from api.read_project_request($1, $2, $3)', [...params]);
        expect(result.ok, name).toBe(false);
        if (!result.ok) expect(result.code, name).toBe('22023');
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('two connections at once (real connections, committed data)', () => {
  const callOn = async (client: Client, r: Request) => (await client.query(createSql, valuesOf(r))).rows[0];

  it('is one Project and one revision, and one replay, when the same command arrives twice at once, over 8 rounds', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 8; round += 1) {
      const a = await committedAccount();
      const sent = request(a, applied);
      const answers = await Promise.all([one, two].map((client) => callOn(client, sent)));
      expect(answers.map((answer) => answer.outcome).sort(), `round ${round}`).toEqual(['created', 'replayed']);
      expect(answers[0].project_id, `round ${round}`).toBe(answers[1].project_id);
      expect(answers[0].request_id, `round ${round}`).toBe(answers[1].request_id);
      expect(await counts(db, a.accountId), `round ${round}`).toEqual({projects: 1, revisions: 1});
    }
  });

  it('is one creation and one refusal when the same command ID arrives at once for two different requests, and the second can never overwrite the first', async () => {
    const [one, two] = await Promise.all([connect(), connect()]);
    for (let round = 0; round < 4; round += 1) {
      const a = await committedAccount();
      const command = randomUUID();
      const answers = await Promise.all([callOn(one, request(a, {command, scope: 'One'})), callOn(two, request(a, {command, scope: 'Two'}))]);
      expect(answers.map((answer) => answer.outcome).sort(), `round ${round}`).toEqual(['created', 'reused']);
      expect(await counts(db, a.accountId), `round ${round}`).toEqual({projects: 1, revisions: 1});
    }
  });

  it('waits for the Account\'s disable and is then denied, and writes nothing, when the disable commits first', async () => {
    const a = await committedAccount();
    const disabler = await connect();
    const creator = await connect();
    const {rows: pid} = await creator.query('select pg_backend_pid() as pid');
    await disabler.query('begin');
    await disabler.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    const creating = creator.query(createSql, valuesOf(request(a)));
    let settled = false;
    creating.then(() => (settled = true), () => (settled = true));
    await untilBlocked(pid[0].pid);
    expect(settled).toBe(false);
    await disabler.query('commit');
    expect((await creating).rows[0]).toEqual({outcome: 'denied', project_id: null, request_id: null});
    expect(await counts(db, a.accountId)).toEqual({projects: 0, revisions: 0});
  });

  it('holds the Account FOR SHARE for the transaction, so a disable waits for a create that passed the check and the create commits; nothing is created after the disable', async () => {
    const a = await committedAccount();
    const creator = await connect();
    const disabler = await connect();
    const {rows: pid} = await disabler.query('select pg_backend_pid() as pid');
    await creator.query('begin');
    expect((await creator.query(createSql, valuesOf(request(a)))).rows[0].outcome).toBe('created');
    const disabling = disabler.query('select outcome from api.disable_account($1, $2)', ['user:00000000-0000-4000-8000-000000000001', a.accountId]);
    await untilBlocked(pid[0].pid);
    await creator.query('commit');
    expect((await disabling).rows[0].outcome).toBe('disabled');
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1});
    // After the disable, whatever the epoch, nothing more is created.
    const after = await Promise.all([callOn(creator, request(a, {epoch: 1})), callOn(creator, request(a, {epoch: 2}))]);
    expect(after.map((answer) => answer.outcome)).toEqual(['denied', 'denied']);
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the typed calls, over REST as the application makes them (committed data)', () => {
  /** What the application confirms: the request as `checkRequest` works it out from the fields, with the default registry. */
  function confirmed(patch: Partial<Parameters<typeof checkRequest>[0]> = {}) {
    const check = checkRequest(
      {
        mode: 'evidence_text',
        description: 'Please build the altar and ramp, and add "David" engraved on the base',
        subjectId: null,
        scope: 'The outer altar',
        outcome: 'A model I can print',
        wording: 'Add "David" engraved on the base',
        ...patch,
      },
      defaultDomainRegistry,
    );
    if (!check.ok) throw new Error(`The test request is not valid: ${JSON.stringify(check)}`);
    return check.request;
  }

  it('creates, replays and refuses a reused command, and reads the revision back, every answer checked', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const command = randomUUID();
    const request_ = confirmed();

    const created = await createProjectRequest(operation, {commandId: command, request: request_}, options);
    expect(created).toMatchObject({outcome: 'created'});
    if (created.outcome !== 'created') throw new Error('not created');
    expect(await createProjectRequest(operation, {commandId: command, request: request_}, options)).toEqual({...created, outcome: 'replayed'});
    expect(await createProjectRequest(operation, {commandId: command, request: confirmed({scope: 'Another scope'})}, options)).toEqual({outcome: 'reused'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1});

    // The Project is titled with the subject's display name, in the new stage, and the revision holds the edited values.
    const [stored] = await projectsOf(db, a.accountId);
    expect(stored).toMatchObject({id: created.projectId, title: 'The outer altar and ramp (Middot 3)', stage: 'request_confirmed', revision: 1});
    const found = await readProjectRequest(operation, created.projectId, options);
    expect(found).toMatchObject({
      outcome: 'found',
      request: {
        id: created.requestId,
        projectId: created.projectId,
        seq: 1,
        mode: 'evidence_text',
        subjectId: 'middot-altar-ramp',
        scope: 'The outer altar',
        outcome: 'A model I can print',
        description: request_.description,
        personalization: {wording: 'Add "David" engraved on the base', text: 'David', style: 'recessed', applied: true, reason: null},
      },
    });
    if (found.outcome === 'found') {
      const [revision] = await revisionsOf(db, a.accountId);
      expect(new Date(found.request.confirmedAt ?? '').getTime()).toBe(revision.confirmed_at.getTime());
    }
    // A rename may not reuse the command of a creation's receipt for this to matter, but a creation may not reuse a rename's.
    const renameCommand = randomUUID();
    expect(await renameProjectCommand(operation, {commandId: renameCommand, projectId: created.projectId, expectedRevision: 1, title: 'Renamed'}, options)).toMatchObject({outcome: 'renamed'});
    expect(await createProjectRequest(operation, {commandId: renameCommand, request: confirmed({scope: 'Third'})}, options)).toEqual({outcome: 'reused'});
  });

  it('answers `unavailable`, and nothing else, to a replay whose Project has since been deleted (A1), and a new command then makes a new Project', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const command = randomUUID();
    const created = await createProjectRequest(operation, {commandId: command, request: confirmed()}, options);
    if (created.outcome !== 'created') throw new Error('not created');
    expect(await createProjectRequest(operation, {commandId: command, request: confirmed()}, options)).toEqual({...created, outcome: 'replayed'});

    // The Project is deleted (the way Story 8.x will hide it: deleted_at set, the revision raised by one).
    await db.query('update projects.projects set deleted_at = now(), revision = revision + 1 where id = $1', [created.projectId]);
    expect(await createProjectRequest(operation, {commandId: command, request: confirmed()}, options)).toEqual({outcome: 'unavailable'});
    // Another payload under that command ID is still a reused one.
    expect(await createProjectRequest(operation, {commandId: command, request: confirmed({scope: 'Another scope'})}, options)).toEqual({outcome: 'reused'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 1});
    // The request is gone from the Project read too, so the two agree.
    expect(await readProjectRequest(operation, created.projectId, options)).toEqual({outcome: 'unavailable'});

    // A new command ID for the same words is a new request, and a new Project.
    const again = await createProjectRequest(operation, {commandId: randomUUID(), request: confirmed()}, options);
    expect(again).toMatchObject({outcome: 'created'});
    if (again.outcome === 'created') expect(again.projectId).not.toBe(created.projectId);
    expect(await counts(db, a.accountId)).toEqual({projects: 2, revisions: 2});
  });

  it('declines the wish of an image_direct request with the no-surfaces reason and records it not applied (AC-4), and a declined wish still confirms', async () => {
    const a = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const direct = await createProjectRequest(operation, {commandId: randomUUID(), request: confirmed({mode: 'image_direct', subjectId: 'middot-altar-ramp'})}, {env});
    expect(direct.outcome).toBe('created');
    const unsupported = await createProjectRequest(operation, {commandId: randomUUID(), request: confirmed({wording: 'add something nice'})}, {env});
    expect(unsupported.outcome).toBe('created');
    const stored = await revisionsOf(db, a.accountId);
    expect(stored.find((entry) => entry.mode === 'image_direct')).toMatchObject({wording: 'Add "David" engraved on the base', text: null, style: null, applied: false, reason: 'image_direct_has_no_surfaces'});
    expect(stored.find((entry) => entry.mode === 'evidence_text')).toMatchObject({wording: 'add something nice', text: null, style: null, applied: false, reason: 'no_quoted_text'});
  });

  it('reads none, unavailable and denied, and treats anything that is not a Project ID as unavailable without asking', async () => {
    const a = await committedAccount();
    const b = await committedAccount();
    const operation = {accountId: a.accountId, epoch: 1};
    const options = {env};
    const bare = await project(db, a, {title: 'No request'});
    const theirs = (await db.query(createSql, valuesOf(request(b)))).rows[0];
    expect(await readProjectRequest(operation, bare, options)).toEqual({outcome: 'none'});
    for (const target of [theirs.project_id, randomUUID(), 'not-an-id', '', undefined, 42]) expect(await readProjectRequest(operation, target, options), String(target)).toEqual({outcome: 'unavailable'});
    expect(await readProjectRequest({accountId: a.accountId, epoch: 7}, bare, options)).toEqual({outcome: 'denied'});
    expect(await createProjectRequest({accountId: a.accountId, epoch: 7}, {commandId: randomUUID(), request: confirmed()}, options)).toEqual({outcome: 'denied'});
    // After a disable nothing is created or read, whatever the epoch.
    await db.query(`update identity.accounts set status = 'disabled' where id = $1`, [a.accountId]);
    expect(await createProjectRequest({accountId: a.accountId, epoch: 2}, {commandId: randomUUID(), request: confirmed()}, options)).toEqual({outcome: 'denied'});
    expect(await readProjectRequest({accountId: a.accountId, epoch: 2}, bare, options)).toEqual({outcome: 'denied'});
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 0});
  });

  it('throws, and never answers an empty or an unavailable result, when the database cannot be reached or refuses the call', async () => {
    const a = await committedAccount();
    const id = await project(db, a);
    const operation = {accountId: a.accountId, epoch: 1};
    const unreachable = {env: {...env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1'}};
    await expect(createProjectRequest(operation, {commandId: randomUUID(), request: confirmed()}, unreachable)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: true, outcomeUnknown: true});
    await expect(readProjectRequest(operation, id, unreachable)).rejects.toBeInstanceOf(AccountsUnavailableError);
    // A key that may not execute the function: the database says no, and the answer is an error.
    const refused = {env: {...env, SUPABASE_SERVICE_ROLE_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY}};
    await expect(createProjectRequest(operation, {commandId: randomUUID(), request: confirmed()}, refused)).rejects.toMatchObject({name: 'AccountsUnavailableError', retryable: false, code: '42501'});
    await expect(readProjectRequest(operation, id, refused)).rejects.toBeInstanceOf(AccountsUnavailableError);
    // Arguments that are not shaped like arguments are refused before the database is asked.
    await expect(createProjectRequest(operation, {commandId: 'not-an-id', request: confirmed()}, {env})).rejects.toBeInstanceOf(TypeError);
    await expect(createProjectRequest({accountId: a.accountId, epoch: 0}, {commandId: randomUUID(), request: confirmed()}, {env})).rejects.toBeInstanceOf(TypeError);
    expect(await counts(db, a.accountId)).toEqual({projects: 1, revisions: 0});
  });
});

// ---------------------------------------------------------------------------------------------------
describe('the preflight carries the Story 2.1 table and functions', () => {
  const create_ = 'api.create_project_request(uuid,bigint,uuid,text,text,text,text,text,text,text,text,text,boolean,text)';
  const read_ = 'api.read_project_request(uuid,bigint,uuid)';
  const spaced = (signature: string) => signature.replace(/,/g, ', ');

  it('answers ok to the service role, and names the table, the block of this story and the two functions', async () => {
    await inTx(async (client) => {
      expect(await api(client).preflight()).toEqual({ok: true});
    });
    const definition = (await db.query(`select pg_get_functiondef('api.preflight()'::regprocedure) as text`)).rows[0].text as string;
    for (const needle of ['projects.request_revisions', 'q.personalization_applied', 'q.digest', 'q.confirmed_at', 'Story 2.1 migration', create_, read_, 'Story 1.13 migration', 'Story 1.12 migration', 'projects.project_commands']) {
      expect(definition, needle).toContain(needle);
    }
    // The service role can execute all thirty-eight api functions (Story 2.3 added the thirty-sixth, Story 2.12 the last two), these two among them; the bucket check is still the last of all.
    const check = definition.indexOf('where not has_function_privilege');
    const executable = definition.slice(definition.lastIndexOf('unnest(array[', check), check);
    // On purpose changed (Story 2.11): forty-seven since it added the six functions of the Job records (it was forty-one after the three functions of the usage limits).
    // On purpose changed (Story 2.6): fifty since it added the three functions of the cost reservations (it was forty-seven after the six functions of the Job records).
    expect(executable.match(/'api\.[a-z_]+\([^']*\)'/g)).toHaveLength(50);
    expect(executable).toContain(create_);
    expect(executable).toContain(read_);
    expect(definition.indexOf('Story 2.1 migration')).toBeLessThan(check);
    expect(definition.indexOf("b.id = 'private-files'")).toBeGreaterThan(definition.indexOf("has_table_privilege('auth.users', 'DELETE')"));
    for (const signature of [create_, read_]) {
      expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as can`, [signature])).rows[0].can, signature).toBe(true);
    }
  });

  it('fails, naming the table, when projects.request_revisions is missing', async () => {
    await inTx(async (client) => {
      await client.query('drop table projects.request_revisions cascade');
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain('request_revisions');
    });
  });

  it.each([create_, read_])('fails the build with one line naming %s when it is missing', async (signature) => {
    await inTx(async (client) => {
      await client.query(`drop function ${spaced(signature)} cascade`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('N3020');
        expect(result.message).toContain('Story 2.1 migration is not applied');
        expect(result.message).toContain(signature);
      }
    });
  });

  it.each([create_, read_])('fails, naming the function, when the service role cannot execute %s', async (signature) => {
    await inTx(async (client) => {
      await client.query(`revoke execute on function ${spaced(signature)} from service_role`);
      const result = await attempt(client, 'service_role', 'select * from api.preflight()');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('42501');
        expect(result.message).toContain(signature);
      }
    });
  });

  it('is not callable by a browser role', async () => {
    await inTx(async (client) => {
      for (const role of ['anon', 'authenticated']) {
        const result = await attempt(client, role, 'select * from api.preflight()');
        expect(result.ok, role).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------
describe('cleanliness: what a test commits is removed, revisions before Projects', () => {
  it('leaves no revision, Project, Workspace or Account behind after the cleanup helper has run for what this case committed', async () => {
    const user = await addUser(db);
    const {rows: made} = await db.query(`select identity.activate_account($1, $2, 'member', 'invitation') as id`, [user.id, user.subject]);
    const accountId = made[0].id as string;
    const {rows: workspace} = await db.query('select id from projects.workspaces where account_id = $1', [accountId]);
    const who: Fixture = {user, accountId, workspaceId: workspace[0].id as string, epoch: 1};
    try {
      const request_ = request(who, applied);
      expect((await db.query(createSql, valuesOf(request_))).rows[0].outcome).toBe('created');
      expect(await counts(db, accountId)).toEqual({projects: 1, revisions: 1});
      // The foreign keys restrict: without deleting the revision first, the Project cannot go.
      await expect(db.query('delete from projects.projects where account_id = $1', [accountId])).rejects.toMatchObject({code: '23503'});
    } finally {
      await cleanup(db, [user.id], []);
    }
    expect(await counts(db, accountId)).toEqual({projects: 0, revisions: 0});
    expect((await db.query('select count(*)::int as n from projects.workspaces where account_id = $1', [accountId])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int as n from identity.accounts where id = $1', [accountId])).rows[0].n).toBe(0);
    expect((await db.query('select count(*)::int as n from auth.users where id = $1', [user.id])).rows[0].n).toBe(0);
  });
});
