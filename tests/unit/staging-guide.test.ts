import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

// docs/staging.md is the one written procedure for pushing the migrations and the Auth settings to staging by hand, which
// stays the first-time procedure and the fallback now that Story 1.9 does it from CI (the staging workflow). These tests
// keep it honest: it names every migration (so a story that adds one cannot forget to add it to the procedure), in order;
// it is a procedure Josh can follow in PowerShell on Windows; it holds no secret; and only the two workflows named in it
// (tests/unit/workflows.test.ts holds them to it) apply anything to a hosted project.
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const guide = read('docs/staging.md');
const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();

/** The fenced code blocks of a Markdown file, with the language each declares. */
function fences(text: string) {
  return [...text.matchAll(/^([ \t]*)```(\w*)\n([\s\S]*?)^[ \t]*```/gm)].map((match) => {
    // A block inside a list item is indented by the item; the commands in it are not.
    const indent = match[1].length;
    const body = match[3].split('\n').map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length))).join('\n');
    return {language: match[2], body};
  });
}

describe('docs/staging.md names every migration', () => {
  it('finds the migrations it is meant to name', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(7);
    expect(migrations).toContain('20261011140000_account_preferences.sql');
  });

  it.each(migrations)('names %s', (name) => {
    expect(guide, `${name} is missing from docs/staging.md: add a row to the table of migrations`).toContain(`\`${name}\``);
  });

  it('lists them in the order they are applied, once each in the table', () => {
    const table = guide.slice(guide.indexOf('| Migration |'));
    const rows = [...table.matchAll(/^\| `(\d{14}_[a-z0-9_]+\.sql)` \|/gm)].map((match) => match[1]);
    expect(rows).toEqual(migrations);
  });

  it('says what each one adds and what it means for the deploy: no empty cell', () => {
    const table = guide.slice(guide.indexOf('| Migration |'));
    for (const row of table.split('\n').filter((line) => /^\| `\d{14}_/.test(line))) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
      expect(cells, row).toHaveLength(3);
      for (const cell of cells) expect(cell.length, row).toBeGreaterThan(10);
    }
  });
});

describe('docs/staging.md is a procedure for PowerShell on Windows', () => {
  const blocks = fences(guide);

  it('has commands to follow', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(8);
  });

  it('puts every command in a powershell block: no sh, bash or unlabelled block', () => {
    expect(blocks.filter((block) => block.language !== 'powershell').map((block) => block.language || '(none)')).toEqual([]);
  });

  it('uses no bash: no export, no && or ||, no backslash line continuation, no sudo, no heredoc, no shell variable syntax for the environment', () => {
    for (const {body} of blocks) {
      for (const line of body.split('\n')) {
        expect(line, line).not.toMatch(/^\s*export\s/);
        expect(line, line).not.toMatch(/&&|\|\|/);
        expect(line, line).not.toMatch(/\\\s*$/);
        expect(line, line).not.toMatch(/\bsudo\b|<<\s*['"]?EOF|\$\{[A-Za-z_]+\}|^\s*source\s|\bchmod\b|\bexport\b/);
        expect(line, line).not.toMatch(/\bSUPABASE_[A-Z_]+=/);
      }
    }
  });

  it('lets the CLI keep the access token: it signs in with `supabase login` and never puts a token in a variable, a file or a command line', () => {
    const text = blocks.map((block) => block.body).join('\n');
    expect(text).toMatch(/^supabase login$/m);
    expect(text).not.toMatch(/SUPABASE_ACCESS_TOKEN|--token|sbp_/);
    expect(guide).not.toMatch(/\$env:SUPABASE_ACCESS_TOKEN/);
  });

  it('reads every secret hidden: Read-Host with -AsSecureString, converted in the session, and never typed in a command line', () => {
    const secret = /TOKEN|PASSWORD|SECRET|KEY/i;
    const secretReads = blocks.flatMap((block) => block.body.split('\n')).filter((line) => /Read-Host/.test(line) && secret.test(line));
    // The database password and the Google client secret are the two values that must go in an environment variable.
    expect(secretReads.length).toBeGreaterThanOrEqual(2);
    for (const line of secretReads) expect(line, line).toMatch(/^\$secure\w* = Read-Host '[^']+' -AsSecureString$/);
    // ... and the variable gets the converted value, from the secure string that was read.
    for (const {body} of blocks) {
      for (const line of body.split('\n').filter((candidate) => /\$env:\w*(?:TOKEN|PASSWORD|SECRET|KEY)\w*\s*=/.test(candidate))) {
        expect(line, line).toMatch(/= \[System\.Net\.NetworkCredential\]::new\('', \$secure\w*\)\.Password$/);
      }
      expect(body).not.toMatch(/--password|\s-p\s|--db-url|postgres(?:ql)?:\/\//i);
    }
    // A plain Read-Host (which shows what is typed, and keeps it in the scrollback) is allowed for what is not secret only.
    for (const line of blocks.flatMap((block) => block.body.split('\n')).filter((candidate) => /Read-Host/.test(candidate) && !/-AsSecureString/.test(candidate))) {
      expect(line, line).not.toMatch(secret);
    }
  });

  it('removes every secret it set from the window at the end, the secure strings included, and the scratch copy', () => {
    const cleanup = guide.slice(guide.indexOf('## When you are done'));
    const text = blocks.map((block) => block.body).join('\n');
    const assigned = [...text.matchAll(/^\$env:(\w+)\s*=/gm)].map((match) => match[1]);
    expect(assigned.sort()).toEqual(['SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID', 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET', 'SUPABASE_DB_PASSWORD']);
    for (const name of assigned) expect(cleanup, name).toContain(`Env:${name}`);
    const secureNames = [...text.matchAll(/^(\$secure\w*) = Read-Host/gm)].map((match) => match[1]);
    expect(secureNames.length).toBe(2);
    for (const name of secureNames) expect(cleanup, name).toContain(`${name}.Dispose()`);
    expect(cleanup).toContain('Remove-Item -Recurse -Force $work');
    expect(cleanup).toContain('supabase logout');
  });

  it('does the whole procedure in one window, says so, and says what to do if it was closed', () => {
    expect(guide).toContain('**Do the whole procedure in ONE PowerShell window.**');
    expect(guide).toMatch(/lives? only in the window that set them/);
    expect(guide).toMatch(/re-create the scratch copy/);
  });

  it('runs the commands that exist: every npm script and every script file it names is in the repository', () => {
    const pkg = JSON.parse(read('package.json')) as {scripts: Record<string, string>};
    for (const {body} of blocks) {
      for (const match of body.matchAll(/npm run ([\w:-]+)/g)) expect(pkg.scripts, match[1]).toHaveProperty(match[1]);
      for (const match of body.matchAll(/\b(scripts\/[\w./-]+\.mjs)\b/g)) expect(existsSync(resolve(root, match[1])), match[1]).toBe(true);
    }
    expect(existsSync(resolve(root, '.env.staging.example'))).toBe(true);
    expect(guide).toContain('.env.staging.example');
  });

  it('only uses Supabase CLI commands and flags that exist in the version CI pins', () => {
    const workflow = read('.github/workflows/ci.yml');
    expect(workflow).toMatch(/version: 2\.120\.0/);
    expect(guide).toContain('2.120.0');
    const used = new Set(blocks.flatMap((block) => [...block.body.matchAll(/^\s*supabase ([a-z]+(?: [a-z]+)?)/gm)].map((match) => match[1])));
    expect([...used].sort()).toEqual(['config diff', 'config push', 'db push', 'link', 'login', 'logout', 'migration list']);
    const supabaseLines = blocks.flatMap((block) => block.body.split('\n')).filter((line) => /^\s*supabase /.test(line));
    const flags = new Set(supabaseLines.flatMap((line) => [...line.matchAll(/(--[a-z-]+)/g)].map((match) => match[1])));
    expect([...flags].sort()).toEqual(['--dry-run', '--exit-code', '--linked', '--project-ref', '--workdir']);
  });

  it('only warns against the commands that would damage a hosted project: they appear nowhere as an instruction', () => {
    for (const {body} of blocks) {
      expect(body).not.toMatch(/db reset|--include-seed|--include-roles|--yes|\bdb remote\b|migration repair/);
    }
    // ... and the warning is there, in words.
    expect(guide).toMatch(/\*\*Never\*\* run `supabase db reset --linked`/);
    expect(guide).toMatch(/never pass `--include-seed` or `--include-roles`/);
  });

  it('pushes the Auth settings from a scratch copy with the hosted addresses, never the repository\'s loopback file', () => {
    const text = blocks.map((block) => block.body).join('\n');
    expect(text).toMatch(/supabase config diff --workdir \$work --project-ref \$ref/);
    expect(text).toMatch(/supabase config push --workdir \$work --project-ref \$ref/);
    expect(text).not.toMatch(/supabase config push\s*$/m);
    expect(guide).toContain('Do not push the file as it is');
    // The file it copies really holds the loopback addresses the guide warns about.
    const config = read('supabase/config.toml');
    expect(config).toMatch(/site_url = "http:\/\/127\.0\.0\.1/);
    expect(config).toMatch(/additional_redirect_urls/);
  });

  it('migrates, configures, checks the push took, checks the database, seeds and only then deploys, and configures after the migration that creates the hook', () => {
    // (The check needs the `api` schema exposed, which the config push does, so it comes after it. Seeding comes last
    // before the deploy: a migrated and configured but unseeded deployment passes the preflight and locks everyone out.)
    const order = [
      'supabase link',
      'supabase db push --linked --dry-run',
      'supabase db push --linked\n',
      'supabase config push',
      'supabase config diff --workdir $work --project-ref $ref --exit-code',
      'check-env.mjs --live',
      'seed-accounts.mjs preauthorize --confirm staging',
      'git push origin main:staging',
    ].map((needle) => guide.indexOf(needle));
    expect(order.every((index) => index >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('says that migrations and settings are not enough: an unseeded deployment passes the preflight and locks everyone out, the Administrator included', () => {
    expect(guide).toContain('**Migrations and settings are not enough.**');
    expect(guide).toMatch(/passes the preflight and then locks everyone out, the Administrator included/);
    expect(guide).toMatch(/A pass does not mean the deployment can be used/);
    expect(guide).toContain('## 5. Seed the accounts');
    // It points at where the seeding is described, and its commands are the ones the seed script has.
    expect(guide).toContain('`docs/deployment-setup.md` (Provisioning staging, step 5)');
    const seed = read('scripts/seed-accounts.mjs');
    for (const command of ['preauthorize', 'list']) expect(seed, command).toContain(`seed-accounts.mjs ${command}`);
    expect(seed).toContain('--confirm');
    const commands = blocks.flatMap((block) => block.body.split('\n')).filter((line) => /seed-accounts\.mjs/.test(line));
    expect(commands.length).toBeGreaterThanOrEqual(2);
    for (const line of commands) expect(line, line).toMatch(/^node --env-file=\.env\.staging scripts\/seed-accounts\.mjs (?:preauthorize|list) --confirm staging$/);
  });

  it('asks again, after the push, whether anything is left to change, and expects none (exit code 0)', () => {
    const afterPush = guide.slice(guide.indexOf('supabase config push --workdir'));
    expect(afterPush.indexOf('--exit-code')).toBeGreaterThan(-1);
    expect(afterPush).toMatch(/\$LASTEXITCODE/);
    expect(afterPush).toMatch(/must show \*\*no differences\*\*/);
    expect(afterPush).toMatch(/exit code 0; 2 means a difference is left/);
  });

  it('keeps the scratch copy until the end, so a setting pushed by mistake can be fixed in it, and says how to make it again', () => {
    expect(guide).toContain('**Keep the scratch copy until the end of the procedure**');
    // It is removed once, in the last section, and not before.
    const removals = [...guide.matchAll(/Remove-Item -Recurse -Force \$work$/gm)].map((match) => match.index!);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toBeGreaterThan(guide.indexOf('## When you are done'));
    const recovery = guide.slice(guide.indexOf('## If something goes wrong'), guide.indexOf('## When you are done'));
    expect(recovery).toMatch(/scratch copy from step 3 is still there until you clean up/);
    expect(recovery).toMatch(/repeat "Before you start", step 2, and step 3 from the top to make the copy again/);
  });

  describe('the scratch copy is all the push needs', () => {
    // config.toml names no file but the seed. A path added to it (an email template, a function, an SQL file) is a file
    // the scratch copy would need, and the guide would have to say so: this fails until it does.
    const config = read('supabase/config.toml');
    const code = config.split('\n').filter((line) => !/^\s*#/.test(line));

    it('names no other file than the seed\'s, which only `db reset` and `db push --include-seed` read', () => {
      const references = code.filter((line) => /\b(?:\w+_)?(?:path|paths|file|files|template|templates|entrypoint|import_map)\s*=|"\.{1,2}\/|\.sql"|\.html"|\.ts"|\.js"/i.test(line));
      expect(references.map((line) => line.trim())).toEqual(['sql_paths = ["./seed.sql"]']);
    });

    it('says so, in the guide, and says which line it is', () => {
      expect(guide).toContain('**The copy is `config.toml` alone, and that is enough.**');
      expect(guide).toContain('`[db.seed] sql_paths = ["./seed.sql"]`');
      expect(guide).toMatch(/copy that file into the scratch folder at the same relative path/);
    });
  });
});

describe('docs/staging.md holds no secret and sends nothing anywhere', () => {
  it('has no key, token, password or connection string in it', () => {
    expect(guide).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}|\bsbp_[A-Za-z0-9]{10,}|\bsb_(?:secret|publishable)_|\bsk_(?:live|test)_|-----BEGIN|AKIA[0-9A-Z]{12,}/);
    // Nothing long that mixes letters and digits, as a key does. A migration's file name is long and has digits and
    // letters (and a future one will be longer), and is no secret: names that the migrations directory really holds
    // are taken out before the scan, and nothing else is.
    let scanned = guide;
    for (const name of migrations) scanned = scanned.split(name).join('<migration>');
    expect(scanned).not.toMatch(/(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[a-z])[A-Za-z0-9+/=_-]{40,}/);
    expect(guide).not.toMatch(/postgres(?:ql)?:\/\/\S+:\S+@/i);
    // The project reference is a placeholder, not a real one.
    expect(guide).toContain("$ref = 'the-20-letter-staging-project-reference'");
  });

  it('keeps its own scan honest: a long migration name is no secret, and a long key is', () => {
    const scan = (text: string, names: string[]) => {
      let scanned = text;
      for (const name of names) scanned = scanned.split(name).join('<migration>');
      return /(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[a-z])[A-Za-z0-9+/=_-]{40,}/.test(scanned);
    };
    const future = '20270101120000_a_much_longer_name_for_a_future_migration_that_adds_things.sql';
    expect(future.length).toBeGreaterThan(40);
    expect(scan(`| \`${future}\` |`, [future])).toBe(false);
    expect(scan(`| \`${future}\` |`, [])).toBe(true);
    expect(scan('key 4f9aB1c2D3e4F5a6B7c8D9e0F1a2B3c4D5e6F7a8B9c0 here', [future])).toBe(true);
    // The table-row pattern takes digits in a name, so such a migration is found, not skipped.
    const row = `| \`${future}\` | what | notes |`;
    expect(/^\| `(\d{14}_[a-z0-9_]+\.sql)` \|/.test(row)).toBe(true);
    expect(/^\| `(\d{14}_[a-z0-9_]+\.sql)` \|/.test('| `20270101120000_adds_v2_tables.sql` |')).toBe(true);
  });

  // (This pinned "Only two workflows apply anything to a hosted project", which was not true: workers.yml pushes an image, and the seed and
  // `scripts/schedules.mjs apply` are commands a person runs that change a hosted database and QStash. The sentence is now the true list.)
  it('says which workflows touch a hosted service, which change a database, and which commands a person runs that change one', () => {
    expect(guide).toContain('**Three workflows touch a hosted service, and only two of them change a database.**');
    expect(guide).not.toContain('**Only two workflows apply anything to a hosted project.**');
    expect(guide).not.toContain('Nothing in this repository applies anything to a hosted project');
    for (const file of ['staging.yml', 'production-migrate.yml', 'workers.yml']) {
      expect(guide, file).toContain(`\`.github/workflows/${file}\``);
      expect(existsSync(resolve(root, '.github/workflows', file)), file).toBe(true);
    }
    expect(guide).toMatch(/workers\.yml` pushes worker images to GitHub Container Registry[^.]*and deploys nothing/);
    expect(guide).toMatch(/only commands that \*\*you\*\* run change a hosted service: the seed \(`scripts\/seed-accounts\.mjs`[^)]*\), `scripts\/schedules\.mjs apply` \(which creates, corrects, resumes and deletes QStash schedules/);
    // The README says the same list.
    const readme = read('README.md');
    expect(readme).toContain('`.github/workflows/workers.yml`, pushes worker images to GitHub Container Registry and deploys nothing');
    expect(readme).toContain('only the first two change a database');
    expect(readme).not.toContain('those two workflows are the only things that apply anything to a hosted project');
  });

  it('says what GitHub does with pushes that arrive while a run is going: one run waits, the newest wins, and nothing is lost because db push is cumulative', () => {
    expect(guide).toContain('`cancel-in-progress: false`');
    expect(guide).toMatch(/GitHub keeps at most ONE run waiting in a group/);
    expect(guide).toMatch(/`supabase db push` is cumulative/);
    expect(guide).not.toContain('Two pushes in a row run one after the other');
    expect(read('.github/workflows/staging.yml')).not.toContain('Two pushes in a row run one after the other');
  });

  it('states the order the route checks in (the body is read before the signature, so an oversize body is a 400 even when unsigned) and that every non-2xx answer is retried', () => {
    expect(guide).toMatch(/a signature header being present \(401: a call with none is refused before its body is read\)/);
    expect(guide).toMatch(/is a \*\*400 even though no signature was checked\*\*/);
    expect(guide).toMatch(/QStash retries every answer outside 200 to 299, a 4xx included/);
    expect(guide).toContain('Upstash-NonRetryable-Error: true');
  });

  it('prints what check 2 claims it shows: the commands dump the headers, and only the route\'s own 401 is said to carry cache-control (Next.js\'s 405 does not)', () => {
    const check = guide.slice(guide.indexOf('2. **The schedules.**'), guide.indexOf('3. **The purge.**'));
    expect(check).toContain('--dump-header -');
    expect(check).not.toContain('%{http_code}');
    expect(check).toMatch(/unsigned `POST` must answer \*\*401\*\* with `cache-control: no-store`/);
    expect(check).toMatch(/`GET` \*\*405\*\*[\s\S]*?carries no `cache-control` header/);
  });

  it('treats STAGING_SITE_URL the same way everywhere: not secret in nature, stored as a secret of the staging environment, read as secrets.STAGING_SITE_URL', () => {
    expect(guide).toMatch(/`STAGING_SITE_URL` \([^)]*It is not secret in nature, and it is stored as a secret of the environment like every other input of the workflow/);
    expect(read('docs/secrets.md')).toMatch(/`STAGING_SITE_URL` \(Story 1\.9: [^)]*it is stored as a secret of the `staging` GitHub environment only so that the workflow reads every input the same way\)/);
    const item = (JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; howto: string[]; secrets: string[]}[]}).items.find((entry) => entry.id === 'vercel-deploy-hook');
    expect(item?.secrets).toContain('STAGING_SITE_URL');
    expect(item?.howto.join('\n')).toMatch(/not secret in nature; it is stored as a secret of the environment like every other input of the staging workflow/);
    expect(read('.github/workflows/staging.yml')).toContain('STAGING_SITE_URL: ${{ secrets.STAGING_SITE_URL }}');
    expect(read('.github/workflows/staging.yml')).not.toMatch(/vars\.STAGING_SITE_URL/);
  });

  it('keeps seeding with the person, whatever the pipeline does: no workflow seeds anything', () => {
    expect(guide).toMatch(/\*\*seeding is always yours\*\*: no workflow seeds anything/);
  });

  it('documents the pipeline, the schedules command, the worker images and the hosted checks of Story 1.9', () => {
    for (const heading of ['## The staging pipeline (Story 1.9)', '## Schedules (Story 1.9)', '## Worker images (Story 1.9)', '## Verifying the pipeline, the schedules and the purge (Story 1.9)']) {
      expect(guide, heading).toContain(heading);
    }
    // The secrets and variables the staging workflow reads are named, by name only.
    for (const name of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_REF', 'STAGING_SITE_URL', 'VERCEL_STAGING_DEPLOY_HOOK', 'GHCR_TOKEN']) expect(guide, name).toContain(`\`${name}\``);
    // The QStash names are never set in a preview; the schedule command is run by a person, never by CI.
    expect(guide).toMatch(/and \*\*never in a preview\*\*/);
    expect(guide).toMatch(/CI never does, because it holds no QStash token/);
    // The Railway deploy is the item that stopped to ask: a documented manual step, not a call.
    expect(guide).toMatch(/\*\*The deploy to Railway is a manual step\.\*\*/);
    expect(guide).toMatch(/documents no call that points an existing service at an image digest with a project token/);
    // The ledger items that record the hosted checks exist.
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string}[]};
    for (const id of ['vercel-deploy-hook', 'hosted-pipeline-check', 'hosted-schedules-check']) {
      expect(ledger.items.map((item) => item.id), id).toContain(id);
      expect(guide, id).toContain(`\`${id}\``);
    }
  });
});

describe('the staging guide is reachable from where a person looks for it', () => {
  it('is linked from docs/deployment-setup.md, docs/auth-setup.md and the README (the repository check, in tests/unit/repository-contract.test.ts, follows the links)', () => {
    expect(read('docs/deployment-setup.md')).toMatch(/\]\(staging\.md\)/);
    expect(read('docs/auth-setup.md')).toMatch(/\]\(staging\.md\)/);
    expect(read('README.md')).toMatch(/\]\(docs\/staging\.md\)/);
  });

  it('points at Story 1.4 ledger items that exist, so the prerequisites it names are the ones the ledger tracks', () => {
    const ledger = JSON.parse(read('provisioning/ledger.json')) as {items: {id: string; due: string}[]};
    const due = ledger.items.filter((item) => item.due === '1-4').map((item) => item.id).sort();
    expect(due.length).toBeGreaterThanOrEqual(4);
    for (const id of due) expect(guide, id).toContain(`\`${id}\``);
    expect(guide).toContain('--story 1-4 --env staging');
  });
});
