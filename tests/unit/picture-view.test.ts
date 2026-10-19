import {describe, expect, it, vi} from 'vitest';
import {en} from '@/lib/i18n/en';
import {he} from '@/lib/i18n/he';
import {fileProblems, moveItem, removeItem, uploadProblems, type PictureItem, type PictureSet} from '@/lib/picture-set';
import {attemptDiscard, attemptSave, fileProblemKeys, saveIdle, saveKey, setProblemKeys, settleSave, uploadProblemKeys, type SaveAnswer, type SaveState} from '@/lib/picture-view';

// What the two picture Server Actions and the screen agree on (Story 2.2, lib/picture-view.ts): how a call that did not answer is read, the message of each
// problem and each refusal, and that discarding is silent.
const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('attemptSave', () => {
  it('returns what the action answered, and hands it the previous state and the form', async () => {
    const action = vi.fn(async (): Promise<SaveState> => ({outcome: 'reused'}));
    const form = new FormData();
    expect(await attemptSave(action, saveIdle, form)).toEqual({outcome: 'reused'});
    expect(action).toHaveBeenCalledWith(saveIdle, form);
  });

  it('reads a call that did not answer as "the pictures may have been saved", so the person is told to check My Projects first', async () => {
    const dropped = async (): Promise<SaveState> => {
      throw new TypeError('fetch failed');
    };
    expect(await attemptSave(dropped, saveIdle, new FormData())).toEqual({outcome: 'unavailable', unknown: true});
  });

  it('lets a redirect through for Next.js to follow', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {digest: 'NEXT_REDIRECT;push;/projects/x;307;'});
    await expect(attemptSave(async () => Promise.reject(redirect), saveIdle, new FormData())).rejects.toBe(redirect);
  });
});

describe('attemptDiscard', () => {
  it('sends the upload IDs, each as an uploadId field in order, and nothing else', async () => {
    const seen: FormData[] = [];
    await attemptDiscard(async (form) => void seen.push(form), [A, B]);
    expect(seen).toHaveLength(1);
    expect([...seen[0].entries()]).toEqual([['uploadId', A], ['uploadId', B]]);
  });

  it('sends nothing for no uploads', async () => {
    const action = vi.fn(async () => undefined);
    await attemptDiscard(action, []);
    expect(action).not.toHaveBeenCalled();
  });

  it('never rejects and says nothing when the call fails: the upload lapses on its own', async () => {
    await expect(attemptDiscard(async () => { throw new TypeError('fetch failed'); }, [A])).resolves.toBeUndefined();
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {digest: 'NEXT_REDIRECT;push;/login;307;'});
    await expect(attemptDiscard(async () => Promise.reject(redirect), [A])).resolves.toBeUndefined();
  });
});

describe('the message of each problem and refusal', () => {
  it('has one for every file problem, upload problem and set problem, each different, in both languages', () => {
    expect(Object.keys(fileProblemKeys)).toEqual([...fileProblems]);
    expect(Object.keys(uploadProblemKeys)).toEqual([...uploadProblems]);
    expect(Object.keys(setProblemKeys)).toEqual(['empty', 'busy', 'failed', 'expired']);
    const keys = [...Object.values(fileProblemKeys), ...Object.values(uploadProblemKeys), ...Object.values(setProblemKeys)];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(en[key], key).toBeTruthy();
      expect(he[key], key).toBeTruthy();
    }
  });

  it('has one for every answer of Save that did not go through, none for nothing yet', () => {
    const states: [SaveState, string | null][] = [
      [{outcome: 'idle'}, null],
      [{outcome: 'invalid'}, 'picture.save.invalid'],
      [{outcome: 'unknown_upload', position: 1}, 'picture.save.unknownUpload'],
      [{outcome: 'not_ready', position: 1}, 'picture.save.notReady'],
      [{outcome: 'expired_upload', position: 1}, 'picture.save.expiredUpload'],
      [{outcome: 'duplicate_image', position: 2}, 'picture.save.duplicateImage'],
      [{outcome: 'too_large'}, 'picture.save.tooLarge'],
      [{outcome: 'reused'}, 'picture.save.reused'],
      [{outcome: 'gone'}, 'picture.save.gone'],
      [{outcome: 'not_editable'}, 'picture.save.notEditable'],
      [{outcome: 'unavailable', unknown: false}, 'picture.save.unavailable'],
      [{outcome: 'unavailable', unknown: true}, 'picture.save.unknown'],
    ];
    for (const [state, key] of states) {
      expect(saveKey(state), JSON.stringify(state)).toBe(key);
      if (key) {
        expect(en[key as keyof typeof en], key).toBeTruthy();
        expect(he[key as keyof typeof he], key).toBeTruthy();
      }
    }
  });
});

describe('the messages that say what to do with a picture the database refused', () => {
  const wordsOf = (catalog: Record<string, unknown>, key: string) => String(catalog[key]);

  it('say "interrupted" nowhere: a picture that is not ready, expired or released is not one whose upload was interrupted (review patch C3)', () => {
    for (const key of ['picture.save.notReady', 'picture.upload.conflict', 'picture.save.expiredUpload', 'picture.save.duplicateImage', 'picture.upload.duplicate']) {
      expect(wordsOf(en, key), key).not.toMatch(/interrupt/i);
      expect(wordsOf(he, key), key).toBeTruthy();
      expect(wordsOf(he, key), key).not.toMatch(/הופסק/);
    }
  });

  it('name the picture by its place where the answer is about one, in both languages', () => {
    for (const key of ['picture.save.notReady', 'picture.save.expiredUpload', 'picture.save.duplicateImage', 'picture.save.unknownUpload']) {
      expect(wordsOf(en, key), key).toContain('{position}');
      expect(wordsOf(he, key), key).toContain('{position}');
    }
  });
});

// What the screen does with an answer to Save: a pure rule (review patch B3) ---------------------------------------------------------------
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = new File([new Uint8Array(4)], 'view.png', {type: 'image/png'});

/** A ready picture of the set: uploaded on this screen (it still has its file) or saved earlier (it has none). */
const ready = (n: number, local: boolean): PictureItem => ({
  key: `k${n}`,
  state: 'ready',
  progress: 1,
  sha256: String(n).repeat(64).slice(0, 64),
  length: 1000 + n,
  contentType: 'image/png',
  uploadId: id(n),
  previewUrl: local ? `blob:${n}` : null,
  file: local ? file : null,
  saved: !local,
  expiresAt: local ? null : '2026-10-20T10:00:00.000Z',
  available: true,
  problem: null,
});
const localSet = (): PictureSet => [ready(1, true), ready(2, true), ready(3, true)];
const savedOnly = (): PictureSet => [ready(1, false), ready(2, false), ready(3, false)];
const submittedOf = (set: PictureSet) => set.map((item) => item.uploadId as string);

describe('settleSave: what a Save answer means for the screen', () => {
  describe('the command ID', () => {
    it('is forgotten for `reused` and `gone`, so the next Save of these pictures is a new command', () => {
      for (const answer of [{outcome: 'reused'}, {outcome: 'gone'}] as const) {
        const result = settleSave(answer, submittedOf(localSet()), localSet());
        expect(result.forgetCommand, answer.outcome).toBe(true);
        expect(result.failed, answer.outcome).toBe(true);
      }
    });

    it('is kept for every other answer, because a retry of the very same Save must carry the same command', () => {
      const answers: SaveAnswer[] = [
        {outcome: 'idle'},
        {outcome: 'invalid'},
        {outcome: 'not_ready', position: 1},
        {outcome: 'expired_upload', position: 1},
        {outcome: 'unknown_upload', position: 1},
        {outcome: 'duplicate_image', position: 2},
        {outcome: 'too_large'},
        {outcome: 'not_editable'},
        {outcome: 'unavailable', unknown: false},
        {outcome: 'unavailable', unknown: true},
        {outcome: 'created'},
        {outcome: 'revised'},
        {outcome: 'replayed'},
        {outcome: 'unchanged'},
      ];
      for (const answer of answers) expect(settleSave(answer, submittedOf(localSet()), localSet()).forgetCommand, JSON.stringify(answer)).toBe(false);
    });
  });

  describe('whether the answer is a failure to show', () => {
    it('is true for every refusal and for a service that did not answer, false for nothing yet and for the receipts that leave the screen', () => {
      const failures: SaveAnswer[] = [
        {outcome: 'invalid'},
        {outcome: 'not_ready', position: 1},
        {outcome: 'expired_upload', position: 1},
        {outcome: 'unknown_upload', position: 1},
        {outcome: 'duplicate_image', position: 2},
        {outcome: 'too_large'},
        {outcome: 'reused'},
        {outcome: 'gone'},
        {outcome: 'not_editable'},
        {outcome: 'unavailable', unknown: false},
        {outcome: 'unavailable', unknown: true},
      ];
      for (const answer of failures) expect(settleSave(answer, submittedOf(localSet()), localSet()).failed, JSON.stringify(answer)).toBe(true);
      for (const answer of [{outcome: 'idle'}, {outcome: 'created'}, {outcome: 'revised'}, {outcome: 'replayed'}, {outcome: 'unchanged'}] as SaveAnswer[]) {
        expect(settleSave(answer, submittedOf(localSet()), localSet()).failed, JSON.stringify(answer)).toBe(false);
      }
    });
  });

  describe('the picture an answer about a position is about', () => {
    it('marks a picture uploaded on this screen (it has its file) as failed with the problem `conflict` for not_ready, expired_upload and unknown_upload, so Retry uploads it again', () => {
      for (const outcome of ['not_ready', 'expired_upload', 'unknown_upload'] as const) {
        const before = localSet();
        const result = settleSave({outcome, position: 2}, submittedOf(before), before);
        expect(result.set[1], outcome).toMatchObject({key: 'k2', state: 'failed', problem: 'conflict', progress: 0});
        expect(result.set[1].file, outcome).toBe(file);
        expect(result.set[1].available, outcome).toBe(true);
        expect(result.set[0], outcome).toBe(before[0]);
        expect(result.set[2], outcome).toBe(before[2]);
      }
    });

    it('marks a saved picture that has no file here as no longer available (replace it), for the same three answers, and leaves its state alone', () => {
      for (const outcome of ['not_ready', 'expired_upload', 'unknown_upload'] as const) {
        const before = savedOnly();
        const result = settleSave({outcome, position: 3}, submittedOf(before), before);
        expect(result.set[2], outcome).toMatchObject({key: 'k3', available: false, state: 'ready', problem: null});
        expect(result.set[0], outcome).toBe(before[0]);
        expect(result.set[1], outcome).toBe(before[1]);
      }
    });

    it('marks the picture as a duplicate for duplicate_image, whether it has a file or not: remove it', () => {
      for (const before of [localSet(), savedOnly()]) {
        const result = settleSave({outcome: 'duplicate_image', position: 2}, submittedOf(before), before);
        expect(result.set[1]).toMatchObject({state: 'failed', problem: 'duplicate', progress: 0});
        expect(result.set[0]).toBe(before[0]);
        expect(result.set[2]).toBe(before[2]);
      }
    });

    it('marks nothing for an answer that is not about a picture', () => {
      const before = localSet();
      const answers: SaveAnswer[] = [
        {outcome: 'idle'},
        {outcome: 'invalid'},
        {outcome: 'too_large'},
        {outcome: 'reused'},
        {outcome: 'gone'},
        {outcome: 'not_editable'},
        {outcome: 'unavailable', unknown: false},
        {outcome: 'unavailable', unknown: true},
        {outcome: 'created'},
        {outcome: 'revised'},
        {outcome: 'replayed'},
        {outcome: 'unchanged'},
      ];
      for (const answer of answers) expect(settleSave(answer, submittedOf(before), before).set, JSON.stringify(answer)).toBe(before);
    });

    it('finds the picture by the uploads that were SUBMITTED, not by the live list, when the list has been reordered since', () => {
      const before = localSet();
      const submitted = submittedOf(before);
      // The person moved the third picture to the front after Save was pressed: position 1 of the answer is still upload 1, now second in the list.
      const live = moveItem(before, 'k3', 'earlier');
      const reordered = moveItem(live, 'k3', 'earlier');
      expect(reordered.map((item) => item.key)).toEqual(['k3', 'k1', 'k2']);
      const result = settleSave({outcome: 'not_ready', position: 1}, submitted, reordered);
      expect(result.set.map((item) => item.key)).toEqual(['k3', 'k1', 'k2']);
      expect(result.set.find((item) => item.key === 'k1')).toMatchObject({state: 'failed', problem: 'conflict'});
      expect(result.set.find((item) => item.key === 'k3')).toMatchObject({state: 'ready', problem: null});
    });

    it('finds the picture by the submitted uploads when a picture before it has been removed since, never the one that took its place in the list', () => {
      const before = localSet();
      const submitted = submittedOf(before);
      const live = removeItem(before, 'k1').set;
      // Position 2 of the answer is upload 2: the live list's second item is upload 3.
      const result = settleSave({outcome: 'expired_upload', position: 2}, submitted, live);
      expect(result.set.map((item) => [item.key, item.state])).toEqual([['k2', 'failed'], ['k3', 'ready']]);
    });

    it('marks nothing for a position whose upload is no longer in the set, or that was never submitted', () => {
      const before = localSet();
      const live = removeItem(before, 'k2').set;
      expect(settleSave({outcome: 'not_ready', position: 2}, submittedOf(before), live).set).toBe(live);
      expect(settleSave({outcome: 'duplicate_image', position: 4}, submittedOf(before), before).set).toBe(before);
      expect(settleSave({outcome: 'not_ready', position: 1}, [], before).set).toBe(before);
    });

    it('still forgets the command and reports the failure when the picture it is about is gone', () => {
      const before = localSet();
      const live = removeItem(before, 'k2').set;
      const result = settleSave({outcome: 'unknown_upload', position: 2}, submittedOf(before), live);
      expect(result).toEqual({set: live, forgetCommand: false, failed: true});
    });
  });

  it('never changes the set it is given', () => {
    const before = localSet();
    const frozen = JSON.stringify(before.map((item) => ({...item, file: null})));
    for (const outcome of ['not_ready', 'expired_upload', 'unknown_upload', 'duplicate_image'] as const) settleSave({outcome, position: 1}, submittedOf(before), before);
    expect(JSON.stringify(before.map((item) => ({...item, file: null})))).toBe(frozen);
    expect(before[0].state).toBe('ready');
  });
});
