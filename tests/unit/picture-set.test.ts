import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {
  acceptAttribute,
  addFiles,
  discardable,
  displayName,
  emptySet,
  fileProblem,
  fileProblems,
  formatBytes,
  formatParams,
  isPictureType,
  maxPictureBytes,
  maxPictures,
  maxSetBytes,
  moveItem,
  orderedUploadIds,
  pictureTypes,
  removeItem,
  replaceItem,
  retryable,
  retryItem,
  savedSet,
  setProblem,
  settleHash,
  shortSha,
  totals,
  typeLabel,
  unsavedUploadIds,
  updateItem,
  uploadProblems,
  type ItemMaker,
  type PictureItem,
  type PictureSet,
  type SavedPicture,
} from '@/lib/picture-set';

// The pure model of the picture set (Story 2.2, lib/picture-set.ts): the limits, what a file may be, and how the set changes. No browser, no clock, no random
// source: the caller hands in how a key and a preview are made, so every answer here is the same on the server and in the browser.
const MiB = 1024 * 1024;

/** A File of this type and size (the bytes are not read by the set: only `type`, `size` and `name` are). */
const file = (name: string, type: string, size: number) => {
  const made = new File([new Uint8Array(Math.min(size, 8))], name, {type});
  Object.defineProperty(made, 'size', {value: size});
  return made;
};
const picture = (name = 'a.jpg', size = 1000) => file(name, 'image/jpeg', size);
const maker = (prefix = 'k'): ItemMaker & {made: string[]; previews: File[]} => {
  const made: string[] = [];
  const previews: File[] = [];
  return {
    made,
    previews,
    key: () => {
      made.push(`${prefix}${made.length + 1}`);
      return made[made.length - 1];
    },
    preview: (given) => {
      previews.push(given);
      return `blob:preview-${previews.length}`;
    },
  };
};
const sha = (character: string) => character.repeat(64);

/** A set of ready pictures, each with its own SHA-256, upload ID and size. */
function readySet(count: number, size = 1000): PictureSet {
  const make = maker();
  const added = addFiles(emptySet, Array.from({length: count}, (_, index) => picture(`p${index}.jpg`, size)), make);
  return added.set.map((item, index) => ({...item, state: 'ready' as const, sha256: sha(String.fromCharCode(97 + index)), uploadId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`}));
}
const keys = (set: PictureSet) => set.map((item) => item.key);

describe('the limits and the accepted types', () => {
  it('are 1 to 12 pictures, 12 MiB each and 60 MiB in all, JPEG, PNG and WebP', () => {
    expect(maxPictures).toBe(12);
    expect(maxPictureBytes).toBe(12 * MiB);
    expect(maxSetBytes).toBe(60 * MiB);
    expect([...pictureTypes]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(acceptAttribute).toBe('image/jpeg,image/png,image/webp');
    // The three formats are three placeholders, so each language writes its own list around them and the Hebrew catalog holds no Latin word.
    expect(formatParams).toEqual({jpeg: 'JPEG', png: 'PNG', webp: 'WebP'});
  });

  it('knows a picture type exactly, and writes it as a token', () => {
    for (const type of pictureTypes) expect(isPictureType(type)).toBe(true);
    for (const other of ['image/heic', 'image/heif', 'image/gif', 'image/JPEG', '', 'text/plain', null, undefined, 3]) expect(isPictureType(other), String(other)).toBe(false);
    expect(typeLabel('image/jpeg')).toBe('JPEG');
    expect(typeLabel('image/png')).toBe('PNG');
    expect(typeLabel('image/webp')).toBe('WebP');
  });

  it('writes a size the same way everywhere, and a digest short', () => {
    expect(formatBytes(12 * MiB)).toBe('12 MiB');
    expect(formatBytes(60 * MiB)).toBe('60 MiB');
    expect(formatBytes(1.5 * MiB)).toBe('1.5 MiB');
    expect(formatBytes(MiB)).toBe('1 MiB');
    expect(formatBytes(480 * 1024)).toBe('480 KiB');
    expect(formatBytes(1)).toBe('1 KiB');
    // On purpose changed (review patch B9): an empty file is `0 KiB`; `1 KiB` is the least only for a file that has bytes in it.
    expect(formatBytes(0)).toBe('0 KiB');
    expect(formatBytes(-5)).toBe('0 KiB');
    expect(formatBytes(Number.NaN)).toBe('0 KiB');
    expect(shortSha('0123456789abcdef'.repeat(4))).toBe('0123456789ab');
  });

  it('names every upload problem, and says which ones trying again can help', () => {
    // On purpose changed (review patch A1): `duplicate` is a ninth problem, the database's finding, from the leases, that two pictures are the same.
    expect([...uploadProblems]).toEqual(['content', 'type', 'changed', 'too_large', 'quota', 'reload', 'conflict', 'unavailable', 'network', 'rejected', 'duplicate']);
    // Not a file that is no picture of a kind the gateway takes (replace it), not a session that needs refreshing (loading the page again loses the files),
    // and not a picture that is the same as another (remove it).
    expect(uploadProblems.filter((problem) => retryable(problem))).toEqual(['changed', 'quota', 'conflict', 'unavailable', 'network', 'rejected']);
    expect(uploadProblems.filter((problem) => !retryable(problem))).toEqual(['content', 'type', 'too_large', 'reload', 'duplicate']);
  });

  it('has no run-time import: nothing but types', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../lib/picture-set.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect([...source.matchAll(/^\s*import\b.*$/gm)]).toEqual([]);
    expect(source).not.toMatch(/\brequire\(|\bimport\(|\bprocess\b|\bDate\b|Math\.random|crypto\.|\bfetch\(|\bwindow\b|\bdocument\b|\bURL\.createObjectURL\b/);
  });
});

describe('formatBytes at the edges of a unit (review patch B9)', () => {
  it('promotes to the next unit when rounding reaches it, so a size never reads as 1024 KiB', () => {
    expect(formatBytes(MiB - 1)).toBe('1 MiB');
    expect(formatBytes(MiB)).toBe('1 MiB');
    expect(formatBytes(MiB - 512)).toBe('1 MiB');
    expect(formatBytes(1023 * 1024)).toBe('1023 KiB');
    for (const bytes of [MiB - 1, MiB - 100, MiB - 512, MiB - 513]) expect(formatBytes(bytes), String(bytes)).not.toMatch(/^1024 KiB/);
  });

  it('writes a whole number of MiB without a decimal and anything else with one', () => {
    expect(formatBytes(12 * MiB)).toBe('12 MiB');
    expect(formatBytes(12 * MiB + 1)).toBe('12 MiB');
    expect(formatBytes(12 * MiB - 1)).toBe('12 MiB');
    expect(formatBytes(12.04 * MiB)).toBe('12 MiB');
    expect(formatBytes(12.05 * MiB + 1)).toBe('12.1 MiB');
    expect(formatBytes(1.5 * MiB)).toBe('1.5 MiB');
    expect(formatBytes(11.96 * MiB)).toBe('12 MiB');
    for (const bytes of [12 * MiB, 12 * MiB + 1, 12 * MiB - 1, 1.5 * MiB, 7 * MiB]) expect(formatBytes(bytes), String(bytes)).not.toMatch(/\.0 /);
  });

  it('says 1 KiB for any file that has bytes in it and 0 KiB for an empty one', () => {
    expect(formatBytes(1)).toBe('1 KiB');
    expect(formatBytes(512)).toBe('1 KiB');
    expect(formatBytes(1023)).toBe('1 KiB');
    expect(formatBytes(1024)).toBe('1 KiB');
    expect(formatBytes(1536)).toBe('2 KiB');
    expect(formatBytes(0)).toBe('0 KiB');
  });

  it('never lets a size below a limit read as the limit: 60 MiB of 60 MiB is only ever said of a full set', () => {
    expect(formatBytes(maxSetBytes - 1)).toBe('60 MiB');
    expect(formatBytes(maxSetBytes - 1, maxSetBytes)).toBe('59.9 MiB');
    expect(formatBytes(maxSetBytes, maxSetBytes)).toBe('60 MiB');
    expect(formatBytes(maxSetBytes - MiB, maxSetBytes)).toBe('59 MiB');
    expect(formatBytes(maxSetBytes - 0.04 * MiB, maxSetBytes)).toBe('59.9 MiB');
    // The same for one picture's limit, and nothing changes for a size that is not near the limit.
    expect(formatBytes(maxPictureBytes - 1, maxPictureBytes)).toBe('11.9 MiB');
    expect(formatBytes(maxPictureBytes, maxPictureBytes)).toBe('12 MiB');
    expect(formatBytes(5 * MiB, maxSetBytes)).toBe('5 MiB');
    expect(formatBytes(480 * 1024, maxSetBytes)).toBe('480 KiB');
    // A limit in KiB is not rewritten in MiB (it would read 0 MiB): the rule is for sizes written in MiB.
    expect(formatBytes(1000, 1024)).toBe('1 KiB');
    expect(formatBytes(1024, 1024)).toBe('1 KiB');
    // The totals line: "60 MiB of 60 MiB" appears only when the set is full.
    const line = (bytes: number) => `${formatBytes(bytes, maxSetBytes)} of ${formatBytes(maxSetBytes)}`;
    expect(line(maxSetBytes)).toBe('60 MiB of 60 MiB');
    expect(line(maxSetBytes - 1)).toBe('59.9 MiB of 60 MiB');
  });
});

describe('displayName (review patch B8)', () => {
  it('leaves a normal name as it is, in any script', () => {
    for (const name of ['IMG_0001.jpg', 'front view (2).png', 'תמונה של המזבח.png', 'عرض أمامي.webp', 'photo-é.jpeg', 'a  b.png']) expect(displayName(name), name).toBe(name);
  });

  it('removes control characters: a new line, a tab, NUL, DEL and the C1 controls', () => {
    expect(displayName('a\nb\tc\u0000d\u007fe\u0085f.png')).toBe('abcdef.png');
    expect(displayName('\u0001\u0002.png')).toBe('.png');
  });

  it('removes every bidirectional control U+202A to U+202E and U+2066 to U+2069, so a name cannot reorder the sentence around it', () => {
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
      const control = String.fromCodePoint(code);
      expect(displayName(`a${control}b${control}.png`), code.toString(16)).toBe('ab.png');
    }
    // The classic: a name that makes `exe.png` read as `gnp.exe`.
    expect(displayName('photo‮gnp.exe')).toBe('photognp.exe');
  });

  it('trims the white space around what is left', () => {
    expect(displayName('  ‮ name.png \n')).toBe('name.png');
    expect(displayName('')).toBe('');
  });

  it('is applied to the names of the files that were not added, and of a picture settled as a duplicate or unreadable', () => {
    const dirty = (name: string, type = 'text/plain') => file(name, type, 10);
    const added = addFiles(emptySet, [dirty('not‮ a picture\n.txt')], maker());
    expect(added.problems).toEqual([{name: 'not a picture.txt', problem: 'type'}]);
    const held = addFiles(readySet(1), [file('copy⁦‮.jpg', 'image/jpeg', 1000)], maker('n')).set;
    expect(settleHash(held, held[1].key, {sha256: held[0].sha256 as string}).name).toBe('copy.jpg');
    expect(settleHash(held, held[1].key, {unreadable: true}).name).toBe('copy.jpg');
  });
});

describe('fileProblem names the first problem a file has', () => {
  it('names a type that is not JPEG, PNG or WebP, HEIC and HEIF included', () => {
    for (const type of ['text/plain', 'image/heic', 'image/heif', 'image/gif', 'application/pdf', '']) {
      expect(fileProblem({type, size: 1000}, emptySet), type).toBe('type');
    }
    // The browser's own spelling in capitals is read as the type it is.
    expect(fileProblem({type: 'IMAGE/PNG', size: 1000}, emptySet)).toBeNull();
    for (const type of pictureTypes) expect(fileProblem({type, size: 1000}, emptySet), type).toBeNull();
  });

  it('names a file with no bytes, and one over 12 MiB; 1 byte and 12 MiB exactly are fine', () => {
    expect(fileProblem({type: 'image/png', size: 0}, emptySet)).toBe('empty');
    expect(fileProblem({type: 'image/png', size: 1}, emptySet)).toBeNull();
    expect(fileProblem({type: 'image/png', size: 12 * MiB}, emptySet)).toBeNull();
    expect(fileProblem({type: 'image/png', size: 12 * MiB + 1}, emptySet)).toBe('too_large');
  });

  it('puts the type first, then empty, then too large', () => {
    expect(fileProblem({type: 'text/plain', size: 0}, emptySet)).toBe('type');
    expect(fileProblem({type: 'image/heic', size: 13 * MiB}, emptySet)).toBe('type');
    expect(fileProblem({type: 'image/png', size: 0}, readySet(12))).toBe('empty');
    expect(fileProblem({type: 'image/png', size: 13 * MiB}, readySet(12))).toBe('too_large');
  });

  it('allows 12 pictures and names the 13th', () => {
    expect(fileProblem({type: 'image/png', size: 100}, readySet(11))).toBeNull();
    expect(fileProblem({type: 'image/png', size: 100}, readySet(12))).toBe('too_many');
  });

  it('allows a set of 60 MiB exactly and names the byte that passes it', () => {
    const held = readySet(4, 12 * MiB);
    expect(totals(held).bytes).toBe(48 * MiB);
    expect(fileProblem({type: 'image/png', size: 12 * MiB}, held)).toBeNull();
    const nearly = readySet(5, 12 * MiB);
    expect(totals(nearly).bytes).toBe(60 * MiB);
    expect(fileProblem({type: 'image/png', size: 1}, nearly)).toBe('set_too_large');
    const one = readySet(4, 12 * MiB);
    expect(fileProblem({type: 'image/png', size: 12 * MiB + 1}, one)).toBe('too_large');
    const fiftyNine = [...readySet(4, 12 * MiB), ...readySet(1, 12 * MiB - 1)];
    expect(fileProblem({type: 'image/png', size: 1}, fiftyNine)).toBeNull();
    expect(fileProblem({type: 'image/png', size: 2}, fiftyNine)).toBe('set_too_large');
  });

  it('names a picture whose SHA-256 is already in the set, once it is known', () => {
    const held = readySet(2);
    expect(fileProblem({type: 'image/png', size: 100, sha256: held[1].sha256}, held)).toBe('duplicate');
    expect(fileProblem({type: 'image/png', size: 100, sha256: sha('f')}, held)).toBeNull();
    // Without a digest there is nothing to compare yet; with none (null) neither.
    expect(fileProblem({type: 'image/png', size: 100}, held)).toBeNull();
    expect(fileProblem({type: 'image/png', size: 100, sha256: null}, held)).toBeNull();
  });

  it('names a file the browser could not read', () => {
    expect(fileProblem({type: 'image/png', size: 100, unreadable: true}, emptySet)).toBe('unreadable');
    expect(fileProblem({type: 'image/png', size: 100, unreadable: false}, emptySet)).toBeNull();
  });

  it('knows seven problems and no others', () => {
    expect([...fileProblems]).toEqual(['type', 'empty', 'too_large', 'too_many', 'set_too_large', 'duplicate', 'unreadable']);
  });

  it('takes a File as it is', () => {
    expect(fileProblem(picture('x.jpg', 5), emptySet)).toBeNull();
    expect(fileProblem(file('x.heic', 'image/heic', 5), emptySet)).toBe('type');
    expect(fileProblem(file('x.png', 'image/png', 0), emptySet)).toBe('empty');
  });
});

describe('addFiles', () => {
  it('adds the files in the order given, each at the end, as checking items that hold their file, size and preview', () => {
    const make = maker();
    const first = picture('one.jpg', 10);
    const second = file('two.png', 'image/png', 20);
    const third = file('three.webp', 'image/webp', 30);
    const result = addFiles(emptySet, [first, second, third], make);
    expect(result.problems).toEqual([]);
    expect(result.added).toHaveLength(3);
    expect(result.set).toEqual(result.added);
    expect(result.set.map((item) => [item.key, item.state, item.length, item.contentType, item.file, item.previewUrl])).toEqual([
      ['k1', 'checking', 10, 'image/jpeg', first, 'blob:preview-1'],
      ['k2', 'checking', 20, 'image/png', second, 'blob:preview-2'],
      ['k3', 'checking', 30, 'image/webp', third, 'blob:preview-3'],
    ]);
    for (const item of result.set) {
      expect(item).toMatchObject({progress: 0, sha256: null, uploadId: null, saved: false, expiresAt: null, available: true, problem: null});
    }
    expect(make.previews).toEqual([first, second, third]);
  });

  it('adds to the end of a set that is there, and does not change it', () => {
    const held = readySet(2);
    const before = [...held];
    const result = addFiles(held, [picture()], maker('n'));
    expect(result.set).toHaveLength(3);
    expect(result.set.slice(0, 2)).toEqual(before);
    expect(held).toEqual(before);
  });

  it('adds a file with no preview maker without one', () => {
    const result = addFiles(emptySet, [picture()], {key: () => 'only'});
    expect(result.set[0].previewUrl).toBeNull();
  });

  it('does not add a bad file, names it by its own name, and keeps the others', () => {
    const text = file('notes.txt', 'text/plain', 12);
    const heic = file('IMG_0001.HEIC', 'image/heic', 3 * MiB);
    const heif = file('IMG_0002.heif', 'image/heif', 3 * MiB);
    const empty = file('empty.png', 'image/png', 0);
    const big = file('big.jpg', 'image/jpeg', 12 * MiB + 1);
    const good = picture('good.jpg', 500);
    const make = maker();
    const result = addFiles(emptySet, [text, heic, good, heif, empty, big], make);
    expect(result.problems).toEqual([
      {name: 'notes.txt', problem: 'type'},
      {name: 'IMG_0001.HEIC', problem: 'type'},
      {name: 'IMG_0002.heif', problem: 'type'},
      {name: 'empty.png', problem: 'empty'},
      {name: 'big.jpg', problem: 'too_large'},
    ]);
    expect(result.added.map((item) => item.file)).toEqual([good]);
    // Nothing was made for a file that was not added: no key and no preview.
    expect(make.made).toEqual(['k1']);
    expect(make.previews).toEqual([good]);
  });

  it('names the 13th picture too many, and keeps the 12 before it', () => {
    const files = Array.from({length: 13}, (_, index) => picture(`p${index}.jpg`, 100));
    const result = addFiles(emptySet, files, maker());
    expect(result.set).toHaveLength(12);
    expect(result.problems).toEqual([{name: 'p12.jpg', problem: 'too_many'}]);
  });

  it('checks each file against the growing set: the one that would pass 60 MiB is refused, a smaller one after it is not', () => {
    const files = [
      file('a.jpg', 'image/jpeg', 12 * MiB),
      file('b.jpg', 'image/jpeg', 12 * MiB),
      file('c.jpg', 'image/jpeg', 12 * MiB),
      file('d.jpg', 'image/jpeg', 12 * MiB),
      file('e.jpg', 'image/jpeg', 12 * MiB),
      file('f.jpg', 'image/jpeg', 1),
      file('g.jpg', 'image/jpeg', 10),
    ];
    const result = addFiles(emptySet, files, maker());
    expect(result.set.map((item) => item.length)).toEqual([12 * MiB, 12 * MiB, 12 * MiB, 12 * MiB, 12 * MiB]);
    expect(result.problems).toEqual([
      {name: 'f.jpg', problem: 'set_too_large'},
      {name: 'g.jpg', problem: 'set_too_large'},
    ]);
    const smaller = addFiles(emptySet, [file('a.jpg', 'image/jpeg', 12 * MiB), file('b.jpg', 'image/jpeg', 12 * MiB), file('c.jpg', 'image/jpeg', 12 * MiB), file('d.jpg', 'image/jpeg', 12 * MiB), file('e.jpg', 'image/jpeg', 11 * MiB), file('f.jpg', 'image/jpeg', MiB), file('g.jpg', 'image/jpeg', 1)], maker());
    expect(smaller.set).toHaveLength(6);
    expect(smaller.problems).toEqual([{name: 'g.jpg', problem: 'set_too_large'}]);
  });

  it('adds nothing for no files', () => {
    const held = readySet(1);
    expect(addFiles(held, [], maker())).toEqual({set: held, added: [], problems: []});
  });
});

describe('replaceItem', () => {
  it('puts the new file in the same position as a checking item, and returns the picture that left', () => {
    const held = readySet(3);
    const make = maker('n');
    const replacement = file('new.png', 'image/png', 77);
    const result = replaceItem(held, held[1].key, replacement, make);
    expect(result.problem).toBeNull();
    expect(result.replaced).toBe(held[1]);
    expect(result.added).toMatchObject({key: 'n1', state: 'checking', length: 77, contentType: 'image/png', file: replacement, uploadId: null, sha256: null, saved: false});
    expect(result.set).toHaveLength(3);
    expect(result.set[0]).toBe(held[0]);
    expect(result.set[1]).toBe(result.added);
    expect(result.set[2]).toBe(held[2]);
    expect(held[1].state).toBe('ready');
  });

  it('checks the new file against the set without the picture it replaces: 12 pictures can swap one, and the byte counted is the new one', () => {
    const full = readySet(12, 100);
    expect(replaceItem(full, full[11].key, picture('swap.jpg', 100), maker()).problem).toBeNull();
    const heavy = readySet(5, 12 * MiB);
    expect(replaceItem(heavy, heavy[0].key, file('same.jpg', 'image/jpeg', 12 * MiB), maker()).problem).toBeNull();
    const light = [...readySet(4, 12 * MiB), ...readySet(1, 1)].map((item, index) => ({...item, key: `x${index}`}));
    expect(replaceItem(light, 'x4', file('big.jpg', 'image/jpeg', 12 * MiB), maker()).problem).toBeNull();
    expect(replaceItem(light, 'x0', file('big.jpg', 'image/jpeg', 12 * MiB + 1), maker()).problem).toBe('too_large');
  });

  it('changes nothing for a file with a problem, and names it', () => {
    const held = readySet(2);
    for (const [given, problem] of [
      [file('x.txt', 'text/plain', 5), 'type'],
      [file('x.png', 'image/png', 0), 'empty'],
      [file('x.png', 'image/png', 13 * MiB), 'too_large'],
    ] as const) {
      const result = replaceItem(held, held[0].key, given, maker());
      expect(result).toEqual({set: held, added: null, replaced: null, problem});
      expect(result.set).toBe(held);
    }
  });

  it('changes nothing for a key that is not in the set', () => {
    const held = readySet(2);
    expect(replaceItem(held, 'nope', picture(), maker())).toEqual({set: held, added: null, replaced: null, problem: null});
  });
});

describe('removeItem', () => {
  it('takes a picture out, keeps the others in order and returns the picture that left', () => {
    const held = readySet(3);
    const result = removeItem(held, held[1].key);
    expect(keys(result.set)).toEqual([held[0].key, held[2].key]);
    expect(result.removed).toBe(held[1]);
    expect(held).toHaveLength(3);
  });

  it('removes the last picture to leave the empty set, and answers nothing for a key that is not there', () => {
    const held = readySet(1);
    expect(removeItem(held, held[0].key).set).toEqual([]);
    expect(removeItem(held, 'nope')).toEqual({set: held, removed: null});
  });
});

describe('moveItem', () => {
  it('moves a picture one place earlier or later and renumbers the others', () => {
    const held = readySet(4);
    const [a, b, c, d] = keys(held);
    expect(keys(moveItem(held, c, 'earlier'))).toEqual([a, c, b, d]);
    expect(keys(moveItem(held, b, 'later'))).toEqual([a, c, b, d]);
    expect(keys(moveItem(held, d, 'earlier'))).toEqual([a, b, d, c]);
    expect(keys(held)).toEqual([a, b, c, d]);
  });

  it('cannot move the first earlier or the last later, and a key that is not there moves nothing', () => {
    const held = readySet(3);
    expect(moveItem(held, held[0].key, 'earlier')).toBe(held);
    expect(moveItem(held, held[2].key, 'later')).toBe(held);
    expect(moveItem(held, 'nope', 'later')).toBe(held);
    expect(moveItem([], 'nope', 'earlier')).toEqual([]);
    const single = readySet(1);
    expect(moveItem(single, single[0].key, 'earlier')).toBe(single);
    expect(moveItem(single, single[0].key, 'later')).toBe(single);
  });

  it('keeps every other field of the picture it moves', () => {
    const held = readySet(2);
    const moved = moveItem(held, held[1].key, 'earlier');
    expect(moved[0]).toBe(held[1]);
    expect(moved[1]).toBe(held[0]);
  });
});

describe('updateItem', () => {
  it('changes some fields of one item and leaves the others as they are', () => {
    const held = readySet(2);
    const next = updateItem(held, held[1].key, {state: 'failed', problem: 'network', progress: 0.5});
    expect(next[0]).toBe(held[0]);
    expect(next[1]).toMatchObject({state: 'failed', problem: 'network', progress: 0.5, key: held[1].key, uploadId: held[1].uploadId});
    expect(held[1].state).toBe('ready');
  });

  it('returns the set as it was for a key that is not in it', () => {
    const held = readySet(1);
    expect(updateItem(held, 'nope', {state: 'failed'})).toBe(held);
  });
});

describe('settleHash', () => {
  it('records the digest and keeps the item where it is, still checking', () => {
    const held = addFiles(readySet(2), [picture('new.jpg')], maker('n')).set;
    const key = held[2].key;
    const result = settleHash(held, key, {sha256: sha('z')});
    expect(result.problem).toBeNull();
    expect(result.removed).toBeNull();
    expect(result.name).toBeNull();
    expect(result.set[2]).toMatchObject({key, sha256: sha('z'), state: 'checking'});
    expect(result.set).toHaveLength(3);
  });

  it('removes a picture whose digest is another picture\'s as a duplicate, naming the file, and keeps the other one', () => {
    const held = addFiles(readySet(2), [picture('copy.jpg')], maker('n')).set;
    const copy = held[2];
    const result = settleHash(held, copy.key, {sha256: held[1].sha256 as string});
    expect(result.problem).toBe('duplicate');
    expect(result.removed).toBe(copy);
    expect(result.name).toBe('copy.jpg');
    expect(keys(result.set)).toEqual([held[0].key, held[1].key]);
  });

  it('removes a picture that could not be read, as unreadable', () => {
    const held = addFiles(emptySet, [picture('gone.jpg')], maker()).set;
    const result = settleHash(held, held[0].key, {unreadable: true});
    expect(result.problem).toBe('unreadable');
    expect(result.name).toBe('gone.jpg');
    expect(result.set).toEqual([]);
  });

  it('does not take a picture for its own duplicate, and does nothing for a key that is gone', () => {
    const held = addFiles(emptySet, [picture('a.jpg')], maker()).set;
    expect(settleHash(held, held[0].key, {sha256: sha('a')}).problem).toBeNull();
    // On purpose changed (review patch B4): the answer also says whether a picture kept aside was put back (`restored`), false here.
    expect(settleHash(held, 'nope', {sha256: sha('a')})).toEqual({set: held, problem: null, removed: null, restored: false, name: null});
  });

  it('finds the duplicate among two pictures that are being checked at the same time, in the order they settle', () => {
    const held = addFiles(emptySet, [picture('a.jpg'), picture('b.jpg')], maker()).set;
    const first = settleHash(held, held[0].key, {sha256: sha('c')});
    expect(first.problem).toBeNull();
    const second = settleHash(first.set, held[1].key, {sha256: sha('c')});
    expect(second.problem).toBe('duplicate');
    expect(keys(second.set)).toEqual([held[0].key]);
  });

  describe('with a picture kept aside to restore (review patch B4: a replacement that is refused puts the original back)', () => {
    /** Three ready pictures; the middle one is replaced by a new item that is being checked, and the original is the one kept aside. */
    function replacing() {
      const base = readySet(3);
      const outcome = replaceItem(base, base[1].key, picture('replacement.jpg'), maker('r'));
      return {base, original: base[1], held: outcome.set, key: (outcome.added as PictureItem).key};
    }

    it('puts the original back in the very slot when the replacement is the same picture as another, naming the problem', () => {
      const {base, original, held, key} = replacing();
      const result = settleHash(held, key, {sha256: base[2].sha256 as string}, original);
      expect(result.problem).toBe('duplicate');
      expect(result.restored).toBe(true);
      expect(result.name).toBe('replacement.jpg');
      expect(result.removed).toBe(held[1]);
      expect(result.set).toHaveLength(3);
      expect(keys(result.set)).toEqual(keys(base));
      expect(result.set[1]).toBe(original);
      expect(result.set[1]).toMatchObject({state: 'ready', uploadId: original.uploadId, sha256: original.sha256});
    });

    it('puts the original back when the replacement cannot be read', () => {
      const {base, original, held, key} = replacing();
      const result = settleHash(held, key, {unreadable: true}, original);
      expect(result.problem).toBe('unreadable');
      expect(result.restored).toBe(true);
      expect(keys(result.set)).toEqual(keys(base));
      expect(result.set[1]).toBe(original);
    });

    it('puts a saved picture that has no file back too, with the saved set\'s length and order unchanged', () => {
      const saved = savedSet(
        [1, 2, 3].map((position) => ({position, uploadId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`, sha256: sha(String(position)), length: 100, contentType: 'image/png' as const, expiresAt: null, available: true})),
        (given) => `saved-${given.position}`,
      );
      const outcome = replaceItem(saved, 'saved-1', picture('new.jpg'), maker('r'));
      const result = settleHash(outcome.set, (outcome.added as PictureItem).key, {sha256: sha('3')}, saved[0]);
      expect(result.restored).toBe(true);
      expect(keys(result.set)).toEqual(['saved-1', 'saved-2', 'saved-3']);
      expect(result.set[0]).toBe(saved[0]);
      expect(result.set[0].file).toBeNull();
    });

    it('keeps the replacement in the slot, with its digest and not restored, when it has no problem', () => {
      const {base, original, held, key} = replacing();
      const result = settleHash(held, key, {sha256: sha('z')}, original);
      expect(result.problem).toBeNull();
      expect(result.restored).toBe(false);
      expect(result.removed).toBeNull();
      expect(result.set).toHaveLength(3);
      expect(result.set[1]).toMatchObject({key, sha256: sha('z'), state: 'checking'});
      expect(result.set[0]).toBe(base[0]);
      expect(result.set[2]).toBe(base[2]);
    });

    it('is the same digest as the original itself, not a duplicate: the original is not in the set while it is aside', () => {
      const {original, held, key} = replacing();
      const result = settleHash(held, key, {sha256: original.sha256 as string}, original);
      expect(result.problem).toBeNull();
      expect(result.restored).toBe(false);
    });

    it('without a picture to restore removes a refused item as before, and says it was not restored', () => {
      const {held, key, base} = replacing();
      const result = settleHash(held, key, {sha256: base[2].sha256 as string});
      expect(result.problem).toBe('duplicate');
      expect(result.restored).toBe(false);
      expect(result.set).toHaveLength(2);
      expect(keys(result.set)).toEqual([base[0].key, base[2].key]);
    });

    it('does nothing for a key that is gone, whatever it was asked to restore', () => {
      const {base, original, held} = replacing();
      expect(settleHash(held, 'nope', {unreadable: true}, original)).toEqual({set: held, problem: null, removed: null, restored: false, name: null});
      expect(base).toHaveLength(3);
    });
  });
});

describe('totals, orderedUploadIds and setProblem', () => {
  it('counts the pictures, their bytes, and how many are ready, pending and failed', () => {
    const held = readySet(4, 100);
    const mixed = updateItem(updateItem(updateItem(held, held[1].key, {state: 'uploading'}), held[2].key, {state: 'failed', problem: 'network'}), held[3].key, {state: 'checking'});
    expect(totals(mixed)).toEqual({count: 4, bytes: 400, ready: 1, pending: 2, failed: 1});
    expect(totals([])).toEqual({count: 0, bytes: 0, ready: 0, pending: 0, failed: 0});
  });

  it('lists the upload IDs of the ready pictures, in order', () => {
    const held = readySet(3);
    expect(orderedUploadIds(held)).toEqual(held.map((item) => item.uploadId));
    const moved = moveItem(held, held[2].key, 'earlier');
    expect(orderedUploadIds(moved)).toEqual([held[0].uploadId, held[2].uploadId, held[1].uploadId]);
    expect(orderedUploadIds(updateItem(held, held[1].key, {state: 'uploading'}))).toEqual([held[0].uploadId, held[2].uploadId]);
    expect(orderedUploadIds(updateItem(held, held[0].key, {uploadId: null}))).toEqual([held[1].uploadId, held[2].uploadId]);
    expect(orderedUploadIds([])).toEqual([]);
  });

  it('says what stops a set from being saved', () => {
    const held = readySet(2);
    expect(setProblem([])).toBe('empty');
    expect(setProblem(held)).toBeNull();
    expect(setProblem(updateItem(held, held[0].key, {state: 'checking'}))).toBe('busy');
    expect(setProblem(updateItem(held, held[0].key, {state: 'uploading'}))).toBe('busy');
    expect(setProblem(updateItem(held, held[0].key, {state: 'failed', problem: 'network'}))).toBe('failed');
    // A failure is named before a picture that is still going.
    const both = updateItem(updateItem(held, held[0].key, {state: 'failed', problem: 'network'}), held[1].key, {state: 'uploading'});
    expect(setProblem(both)).toBe('failed');
    expect(setProblem(updateItem(held, held[0].key, {saved: true, available: false}))).toBe('expired');
    expect(setProblem(updateItem(held, held[0].key, {saved: true, available: true}))).toBeNull();
    // A picture added this session whose copy is somehow gone is not "expired": only a saved one is.
    expect(setProblem(updateItem(held, held[0].key, {saved: false, available: false}))).toBeNull();
  });
});

describe('savedSet and discardable', () => {
  const saved = (position: number, patch: Partial<SavedPicture> = {}): SavedPicture => ({
    position,
    uploadId: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
    sha256: sha(String(position)),
    length: 1000 * position,
    contentType: 'image/png',
    expiresAt: '2026-10-19T12:00:00.000Z',
    available: true,
    ...patch,
  });

  it('is the revision\'s pictures in position order, each ready and saved, with no preview and no file', () => {
    const set = savedSet([saved(3), saved(1), saved(2, {available: false, expiresAt: null})], (picture) => `saved-${picture.position}`);
    expect(set.map((item) => item.key)).toEqual(['saved-1', 'saved-2', 'saved-3']);
    expect(set[0]).toEqual<PictureItem>({
      key: 'saved-1',
      state: 'ready',
      progress: 1,
      sha256: sha('1'),
      length: 1000,
      contentType: 'image/png',
      uploadId: '00000000-0000-4000-8000-000000000001',
      previewUrl: null,
      file: null,
      saved: true,
      expiresAt: '2026-10-19T12:00:00.000Z',
      available: true,
      problem: null,
    });
    expect(set[1]).toMatchObject({available: false, expiresAt: null});
    expect(setProblem(set)).toBe('expired');
    expect(orderedUploadIds(set)).toEqual(set.map((item) => item.uploadId));
  });

  it('carries a picture the revision pins as kept (Story 2.12), and adds nothing to one that is not: a kept picture is still saved, ready and available, and is never discarded by this screen', () => {
    const set = savedSet([saved(1, {kept: true}), saved(2), saved(3, {kept: false})], (picture) => `saved-${picture.position}`);
    expect(set[0]).toMatchObject({saved: true, state: 'ready', available: true, kept: true});
    expect(set[1]).not.toHaveProperty('kept');
    expect(set[2]).not.toHaveProperty('kept');
    for (const item of set) expect(discardable(item)).toBeNull();
  });

  it('does not change the list it is given', () => {
    const given = [saved(2), saved(1)];
    savedSet(given, () => 'k');
    expect(given.map((picture) => picture.position)).toEqual([2, 1]);
  });

  it('discards the upload of a picture staged here and never saved, and never a saved one or one with no upload', () => {
    const held = readySet(2);
    expect(discardable(held[0])).toBe(held[0].uploadId);
    expect(discardable({...held[0], saved: true})).toBeNull();
    expect(discardable({...held[0], uploadId: null})).toBeNull();
  });
});

describe('retryItem (review patch B5: a file the gateway found changed is hashed again before it is sent)', () => {
  /** A picture that failed with this problem, with the digest the browser computed before sending it. */
  function failedSet(problem: (typeof uploadProblems)[number], withFile = true) {
    const held = readySet(3);
    const failing = {...held[1], state: 'failed' as const, progress: 0.4, problem, uploadId: null, file: withFile ? picture('b.jpg') : null};
    return {before: [held[0], failing, held[2]] as PictureSet, key: failing.key, digest: failing.sha256};
  }

  it('resets the digest after `changed` (a checksum or length mismatch), so the file is read and hashed again', () => {
    const {before, key} = failedSet('changed');
    const after = retryItem(before, key);
    expect(after[1]).toMatchObject({key, state: 'checking', progress: 0, problem: null, sha256: null});
    expect(after[1].file).toBe(before[1].file);
  });

  it('keeps the digest after every other problem: the file was read and hashed, and only the sending failed', () => {
    for (const problem of uploadProblems.filter((one) => one !== 'changed')) {
      const {before, key, digest} = failedSet(problem);
      const after = retryItem(before, key);
      expect(after[1], problem).toMatchObject({state: 'checking', progress: 0, problem: null, sha256: digest});
    }
  });

  it('changes nothing else in the set, and not the set it is given', () => {
    const {before, key} = failedSet('changed');
    const copy = JSON.stringify(before.map((item) => ({...item, file: null})));
    const after = retryItem(before, key);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    expect(after).toHaveLength(3);
    expect(JSON.stringify(before.map((item) => ({...item, file: null})))).toBe(copy);
    expect(before[1]).toMatchObject({state: 'failed', problem: 'changed'});
  });

  it('is the set as it was for a key that is gone, a picture that has not failed, or one whose file is not here any more', () => {
    const {before, key} = failedSet('changed');
    expect(retryItem(before, 'nope')).toBe(before);
    expect(retryItem(before, before[0].key)).toBe(before);
    const noFile = failedSet('changed', false);
    expect(retryItem(noFile.before, noFile.key)).toBe(noFile.before);
    expect(key).toBeTruthy();
  });
});

describe('unsavedUploadIds (review patch B11: what a screen gives back when it goes)', () => {
  const ids = (set: PictureSet) => set.map((item) => item.uploadId as string);

  it('is the uploads of the pictures that are ready, in order', () => {
    const held = readySet(3);
    expect(unsavedUploadIds(held, [])).toEqual(ids(held));
  });

  it('leaves out the pictures of a saved revision: the screen did not stage them and never gives them back', () => {
    const held = readySet(3);
    const mixed = [held[0], {...held[1], saved: true}, held[2]];
    expect(unsavedUploadIds(mixed, [])).toEqual([ids(held)[0], ids(held)[2]]);
  });

  it('leaves out the uploads of the Save that was sent, whatever happens to it', () => {
    const held = readySet(3);
    expect(unsavedUploadIds(held, [ids(held)[1]])).toEqual([ids(held)[0], ids(held)[2]]);
    expect(unsavedUploadIds(held, ids(held))).toEqual([]);
  });

  it('leaves out pictures that are not ready: those on their way are given up by the abort, and a failed one staged nothing', () => {
    const held = readySet(4);
    const states = [held[0], {...held[1], state: 'uploading' as const}, {...held[2], state: 'failed' as const, problem: 'network' as const}, {...held[3], state: 'checking' as const}];
    expect(unsavedUploadIds(states, [])).toEqual([ids(held)[0]]);
  });

  it('names an upload once, even when the same picture is in the list twice (one kept aside and one in the set)', () => {
    const held = readySet(2);
    expect(unsavedUploadIds([held[0], held[1], held[0]], [])).toEqual(ids(held));
  });

  it('is nothing for no pictures, and for a ready picture that has no upload ID', () => {
    expect(unsavedUploadIds([], [])).toEqual([]);
    expect(unsavedUploadIds([{...readySet(1)[0], uploadId: null}], [])).toEqual([]);
  });
});
