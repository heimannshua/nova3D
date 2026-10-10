import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {envFilesLowestFirst, mergeServerEnv} from '../support/server-env';

// The browser tests hash invitation codes with the keys the server runs with, so they must read the env
// files exactly as `next start` does: .env.production.local, .env.local, .env.production, .env, the first
// to set a variable winning, and the process environment beating all of them.
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nova3d-env-'));
});
afterEach(() => {
  rmSync(directory, {recursive: true, force: true});
});
const write = (file: string, text: string) => writeFileSync(join(directory, file), text);

describe('mergeServerEnv', () => {
  it('reads the files in Next’s order, highest priority first: .env.production.local, .env.local, .env.production, .env', () => {
    expect(envFilesLowestFirst).toEqual(['.env', '.env.production', '.env.local', '.env.production.local']);
    write('.env', 'A=env\nB=env\nC=env\nD=env\nONLY_ENV=1\n');
    write('.env.production', 'A=production\nB=production\nC=production\nONLY_PRODUCTION=1\n');
    write('.env.local', 'A=local\nB=local\nONLY_LOCAL=1\n');
    write('.env.production.local', 'A=production-local\nONLY_PRODUCTION_LOCAL=1\n');
    expect(mergeServerEnv(directory, {})).toEqual({
      A: 'production-local',
      B: 'local',
      C: 'production',
      D: 'env',
      ONLY_ENV: '1',
      ONLY_PRODUCTION: '1',
      ONLY_LOCAL: '1',
      ONLY_PRODUCTION_LOCAL: '1',
    });
  });

  it('lets the process environment beat every file, as it does for the server', () => {
    write('.env.production.local', 'INVITATION_HASH_KEY=from-the-file\nOTHER=file\n');
    expect(mergeServerEnv(directory, {INVITATION_HASH_KEY: 'from-the-shell'})).toMatchObject({INVITATION_HASH_KEY: 'from-the-shell', OTHER: 'file'});
  });

  it('reads values the way Node’s --env-file does: export prefixes, quotes, trailing comments', () => {
    write('.env.local', 'export A=one\nB="two # not a comment" # a comment\nC=three # trailing\n# D=hidden\n\nE=\n');
    expect(mergeServerEnv(directory, {})).toEqual({A: 'one', B: 'two # not a comment', C: 'three', E: ''});
  });

  it('copes with files that do not exist, and ignores process variables that are undefined', () => {
    expect(mergeServerEnv(directory, {})).toEqual({});
    expect(mergeServerEnv(directory, {SET: 'yes', UNSET: undefined})).toEqual({SET: 'yes'});
  });
});
