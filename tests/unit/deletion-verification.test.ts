import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

// docs/deletion-verification.md is the auditable deletion-verification procedure that PRD D-3 requires before deletion work begins (Story 1.8,
// AC-4). These tests keep it honest: it names every store a private copy can live in, and for each says how absence is proven, who runs the
// proof, when, and where the evidence is kept; it holds the time limits and the order; it points at files that exist; and it holds nothing
// that looks like a secret or like private data.
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const guide = read('docs/deletion-verification.md');

/** The text under a `### ` heading, up to the next heading of the same or a higher level. */
function section(title: string): string {
  const start = guide.indexOf(`\n### ${title}\n`);
  expect(start, `a "### ${title}" section`).toBeGreaterThan(-1);
  const rest = guide.slice(start + 1);
  const end = rest.slice(4).search(/^#{1,3} /m);
  return end === -1 ? rest : rest.slice(0, end + 4);
}

// The stores PRD D-3 and AD-15 name: database, Storage and object stores, backups, notifications, logs, and the outside providers.
const stores = ['Database', 'Storage and object stores', 'Backups', 'Notifications', 'Logs', 'Outside providers'] as const;
const fields = ['Proof of absence', 'Run by', 'When', 'Evidence kept'] as const;

describe('docs/deletion-verification.md names every store', () => {
  it.each(stores)('has a section for %s', (store) => {
    expect(section(store).length).toBeGreaterThan(100);
  });

  it.each(stores.flatMap((store) => fields.map((field) => [store, field] as const)))('says, for %s, the %s', (store, field) => {
    const match = new RegExp(`^- \\*\\*${field}:\\*\\* (.+)$`, 'm').exec(section(store));
    expect(match, `${store}: "- **${field}:** ..."`).not.toBeNull();
    expect(match![1].length, `${store}: ${field}`).toBeGreaterThan(30);
  });

  it('names who runs each proof: the verifier, the system actor that does the checking, and the Administrator, who signs off', () => {
    for (const store of stores) expect(section(store), store).toMatch(/Administrator|verifier/);
    expect(guide).toMatch(/"The verifier" is the system actor of the deletion verification job/);
    expect(guide).toMatch(/"the Administrator" is Josh/);
  });

  it('covers what AD-15\'s manifest covers: database records, images, model artifacts, exports, staging, notifications, usage, payments, credit entries, traces and backups', () => {
    for (const word of ['database records', 'images', 'model artifacts', 'exports', 'staging', 'notifications', 'usage associations', 'payment requests', 'payments and credit entries', 'local operational traces', 'backups']) {
      expect(guide, word).toContain(word);
    }
  });

  it('says every outside provider that can hold private data, and what is disclosed for the ones whose retention cannot satisfy FR-30', () => {
    const providers = section('Outside providers');
    for (const provider of ['Supabase', 'Backblaze', 'Vercel', 'Railway', 'Upstash', 'Resend', 'Stripe', 'Google']) expect(providers, provider).toContain(provider);
    expect(providers).toMatch(/disclosed before the provider first receives private Project data/);
    expect(providers).toMatch(/disclosed before the first payment/);
  });
});

describe('docs/deletion-verification.md holds the order, the limits and the exception', () => {
  it('puts the tombstone and the hide first, then revoke and cancel, then purge, and proves absence after the purge', () => {
    expect(guide).toMatch(/tombstone and hide first/);
    expect(guide).toMatch(/revoke access, cancel Jobs and late writes, \*\*then\*\* purge/);
    expect(guide).toMatch(/every proof below is run after the purge/i);
  });

  it('holds the limits of R-9: active copies within 24 hours, controlled backups within 30 days of the deletion, never extended by a restore', () => {
    expect(guide).toMatch(/no more than 24 hours/);
    expect(guide).toMatch(/within 30 days/);
    expect(guide).toMatch(/never extended\*\* by a restore or a re-backup/);
  });

  it('judges absence from backups by manifests and listings, never by decrypting a dump, and proves the dump and mirror lifetimes (14 and 7 days)', () => {
    const backups = section('Backups');
    expect(backups).toMatch(/dumps are encrypted, so absence is judged from manifests and bucket listings/);
    expect(backups).toMatch(/fourteenth day/);
    expect(backups).toMatch(/seventh day/);
    expect(backups).toMatch(/day 30/);
  });

  it('keeps the anti-resurrection ledger as the one permitted remainder, holding opaque identities only', () => {
    expect(guide).toMatch(/anti-resurrection ledger/);
    expect(guide).toMatch(/opaque identities only/);
  });

  it('says the ledger also keeps the opaque change events keyed by Account ID, by the names the migration really gives them, and that none holds an address, a title, a code or a token', () => {
    const migration = read('supabase/migrations/20261013120000_tombstones_and_ledger.sql');
    const types = [...migration.matchAll(/'type', '([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect(types).toEqual(['account_authority', 'invitation_consumed', 'invitation_revoked', 'preauthorization_consumed', 'recovery_redeemed', 'tombstone']);
    const row = /^\| The anti-resurrection ledger .*$/m.exec(guide)?.[0] ?? '';
    expect(row, 'the anti-resurrection row').not.toBe('');
    for (const type of types) expect(row, type).toContain(`\`${type}\``);
    expect(row).toMatch(/keyed by Account ID/);
    expect(row).toMatch(/None holds an address, a title, a code or a token, or a hash of one/);
    expect(row).toMatch(/opaque identities only/);
  });

  it('says the verification record is in the database and a restore can roll it back, that the ledger event is the durable record, and that the verifier re-proves absence after a restore', () => {
    const evidence = guide.slice(guide.indexOf('## Where the evidence is kept'), guide.indexOf('## Review and sign-off'));
    expect(evidence).toMatch(/\*\*a restore can roll it back\*\*/);
    expect(evidence).toMatch(/\*\*the ledger event is the durable record of a deletion\*\*/);
    expect(evidence).toMatch(/after a restore the verifier proves absence again/);
    expect(evidence).toContain('Story 8.4');
    expect(section('Database')).toMatch(/after every restore/);
  });

  it('has a monthly canary that proves a deletion reaches the database, Storage and the backups within 15 days, and a restore drill', () => {
    expect(guide).toMatch(/monthly canary/);
    expect(guide).toMatch(/database, Storage and the backups within 15 days/);
    expect(guide).toMatch(/restore drill/);
  });

  it('says what happens when a proof fails: the target stays tombstoned, the deletion is not complete, an alarm is raised', () => {
    expect(guide).toMatch(/stays tombstoned and hidden/);
    expect(guide).toMatch(/does not mark the deletion complete/);
    expect(guide).toMatch(/operational alarm/);
  });

  it('says where the evidence is kept, and that it holds no private content', () => {
    const evidence = guide.slice(guide.indexOf('## Where the evidence is kept'));
    expect(evidence).toMatch(/outside the repository/);
    expect(guide).toMatch(/Evidence never holds private content/);
  });

  it('is to be reviewed and signed off before any purge code ships, and records that it has not been yet', () => {
    expect(guide).toMatch(/no purge code ships until this document has been reviewed and signed off/);
    expect(guide).toMatch(/Stories 8\.1 to 8\.3/);
    expect(guide.slice(guide.indexOf('## Review and sign-off'))).toMatch(/pending/);
  });
});

describe('docs/deletion-verification.md is a document of this repository', () => {
  it('links only to files that exist', () => {
    const links = [...guide.matchAll(/\]\((?!https?:|#)([^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(resolve(root, 'docs', link)), link).toBe(true);
  });

  it('names the files and functions it relies on, and they exist', () => {
    for (const path of ['supabase/migrations/20261013120000_tombstones_and_ledger.sql', 'lib/lifecycle.ts', 'lib/ledger.ts', 'provisioning/ledger.json', 'tests/unit/mailer.test.ts', 'tests/unit/gate-structure.test.ts']) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
    }
    for (const needle of ['api.record_tombstone', 'lifecycle.tombstones', 'lifecycle.ledger_outbox', 'POST /api/status']) expect(guide, needle).toContain(needle);
  });

  it('holds no secret and no private data: no long hexadecimal string, no key, token or address, no Bearer credential', () => {
    expect(guide).not.toMatch(/[0-9a-f]{32,}/i);
    expect(guide).not.toMatch(/\bBearer\s+\S{8,}|sbp_|-----BEGIN|AGE-SECRET-KEY|age1[a-z0-9]{20,}/);
    expect(guide).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
  });

  it('is named by the pieces that depend on it: the authority contract, the README and the first-review item in the provisioning ledger', () => {
    expect(read('docs/authority-contract.md')).toContain('deletion-verification.md');
    expect(read('README.md')).toContain('docs/deletion-verification.md');
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; due: string; howto: string[]}[]};
    const item = ledger.items.find((entry) => entry.id === 'hosted-status-check');
    expect(item?.due).toBe('1-8');
    expect(item?.howto.join(' ')).toContain('docs/deletion-verification.md');
    expect(guide).toContain('hosted-status-check');
  });
});
