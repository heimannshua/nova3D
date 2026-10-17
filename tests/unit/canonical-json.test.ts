import {describe, expect, it} from 'vitest';
import {canonicalBytes, canonicalize, maxCanonicalDepth} from '../../lib/canonical-json';

// Story 1.12. RFC 8785 (JSON Canonicalization Scheme). Every vector below is copied from the RFC (https://www.rfc-editor.org/rfc/rfc8785.txt),
// not written from memory: section 3.2.2 and 3.2.3 (the sample object and its canonical form), 3.2.3 (the property-sorting data), 3.2.4 (the
// UTF-8 bytes), Appendix B (Table 1, the number serialization samples) and Appendix E (subtype handling).

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
const fromIeee = (bits: string) => new DataView(Uint8Array.from(bits.match(/../g)!.map((pair) => parseInt(pair, 16))).buffer).getFloat64(0);

describe('RFC 8785 section 3.2.2 and 3.2.3: the sample object', () => {
  // The input exactly as the RFC prints it (JSON text with its escapes), parsed.
  const sample = JSON.parse(String.raw`{
    "numbers": [333333333.33333329, 1E30, 4.50,
                2e-3, 0.000000000000000000000000001],
    "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
    "literals": [null, true, false]
  }`);

  it('serializes to the RFC\'s canonical form: members sorted, numbers and strings normalized, no whitespace', () => {
    expect(canonicalize(sample)).toBe(String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`);
  });

  it('encodes to the UTF-8 bytes of section 3.2.4', () => {
    const expected = `7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72
     75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a
     5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31
     65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37
     5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30
     30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d`
      .replace(/\s+/g, ' ')
      .trim();
    expect(hex(canonicalBytes(sample))).toBe(expected);
  });

  it('is not what JSON.stringify gives for the same data (the members keep the order they were parsed in)', () => {
    expect(JSON.stringify(sample)).not.toBe(canonicalize(sample));
    expect(JSON.stringify(sample).startsWith('{"numbers"')).toBe(true);
  });
});

describe('RFC 8785 section 3.2.3: sorting property names as UTF-16 code units', () => {
  const data = JSON.parse(String.raw`{
    "\u20ac": "Euro Sign",
    "\r": "Carriage Return",
    "\ufb33": "Hebrew Letter Dalet With Dagesh",
    "1": "One",
    "\ud83d\ude00": "Emoji: Grinning Face",
    "\u0080": "Control",
    "\u00f6": "Latin Small Letter O With Diaeresis"
  }`) as Record<string, string>;

  it('orders the members the way the RFC lists them', () => {
    // The values in the order they stand in the serialized text (parsing it again would put the integer-like name first).
    const order = [...canonicalize(data).matchAll(/:"([^"]*)"/g)].map((match) => match[1]);
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ]);
  });

  it('puts the surrogate pair (U+D83D) before U+FB33, which UTF-8 or code point order would not', () => {
    const text = canonicalize(data);
    expect(text.indexOf('Emoji')).toBeLessThan(text.indexOf('Hebrew'));
  });

  it('sorts recursively, and keeps array order while sorting the objects inside arrays', () => {
    expect(canonicalize({b: {z: 1, a: 2}, a: [{y: 1, x: 2}, 3, [{d: 4, c: 5}]]})).toBe('{"a":[{"x":2,"y":1},3,[{"c":5,"d":4}]],"b":{"a":2,"z":1}}');
  });

  it('sorts a shorter name before a longer one that starts with it, and the empty name first', () => {
    expect(canonicalize({ab: 1, aa: 2, a: 3, '': 4})).toBe('{"":4,"a":3,"aa":2,"ab":1}');
  });

  it('sorts integer-like names as text, not as numbers', () => {
    expect(canonicalize({10: 'a', 9: 'b', 1: 'c'})).toBe('{"1":"c","10":"a","9":"b"}');
  });
});

describe('RFC 8785 Appendix B: number serialization (Table 1)', () => {
  const samples: [string, string][] = [
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ];

  it.each(samples)('IEEE 754 %s is %s', (bits, json) => {
    expect(canonicalize(fromIeee(bits))).toBe(json);
    expect(canonicalize([fromIeee(bits)])).toBe(`[${json}]`);
  });

  it.each([
    ['7fffffffffffffff', 'NaN'],
    ['7ff0000000000000', 'Infinity'],
    ['fff0000000000000', '-Infinity'],
  ])('refuses %s (%s): values out of range are not permitted in JSON', (bits) => {
    expect(() => canonicalize(fromIeee(bits))).toThrow(TypeError);
    expect(() => canonicalize({value: fromIeee(bits)})).toThrow(TypeError);
  });
});

describe('RFC 8785 Appendix E: strings are kept as they are', () => {
  it('serializes the object of the appendix without touching its strings', () => {
    expect(canonicalize({time: '2019-01-28T07:45:10Z', big: '055', val: 3.5})).toBe('{"big":"055","time":"2019-01-28T07:45:10Z","val":3.5}');
  });

  it('does not normalize Unicode: a decomposed and a composed letter stay different strings', () => {
    expect(canonicalize('é')).not.toBe(canonicalize('é'));
    expect(canonicalize('é')).toBe('"é"');
  });
});

describe('strings (section 3.2.2.2)', () => {
  it('escapes the control characters, the quote and the backslash, in lower case, and nothing else', () => {
    const controls = Array.from({length: 0x20}, (_unused, code) => String.fromCharCode(code)).join('');
    expect(canonicalize(controls)).toBe(
      '"\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\b\\t\\n\\u000b\\f\\r\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f"',
    );
    expect(canonicalize('"\\/\u007f  ')).toBe('"\\"\\\\/\u007f  "');
  });

  it('writes a well-formed surrogate pair as it is', () => {
    expect(canonicalize('😀')).toBe('"😀"');
    expect([...canonicalBytes('😀')]).toEqual([0x22, 0xf0, 0x9f, 0x98, 0x80, 0x22]);
  });

  it('refuses a lone surrogate, in a value, in a name, and in an array, rather than writing an escape or a replacement character', () => {
    for (const lone of ['\ud800', '\udead', 'a\ud83d', '\ude00b', '\ud83dx\ude00']) {
      expect(() => canonicalize(lone), lone).toThrow(TypeError);
      expect(() => canonicalBytes(lone), lone).toThrow(TypeError);
      expect(() => canonicalize({[lone]: 1}), lone).toThrow(TypeError);
      expect(() => canonicalize({a: [lone]}), lone).toThrow(TypeError);
    }
  });
});

describe('what JSON cannot hold is refused, never skipped', () => {
  it('writes the literals and the empty containers', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(false)).toBe('false');
    expect(canonicalize([])).toBe('[]');
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([[], {}])).toBe('[[],{}]');
  });

  it('refuses undefined (as a value, a member and an array element), functions, symbols and bigints', () => {
    for (const bad of [undefined, () => 1, Symbol("x"), BigInt(10)]) {
      expect(() => canonicalize(bad)).toThrow(TypeError);
      expect(() => canonicalize({a: bad})).toThrow(TypeError);
      expect(() => canonicalize([bad])).toThrow(TypeError);
    }
    expect(() => canonicalize([1, , 3])).toThrow(TypeError);
  });

  it('refuses objects that are not plain: dates, maps, sets, class instances', () => {
    class Thing {
      a = 1;
    }
    for (const bad of [new Date(0), new Map(), new Set(), new Thing(), /x/, new Uint8Array(2), Object.create({inherited: 1}) as object]) {
      expect(() => canonicalize(bad), String(bad)).toThrow(TypeError);
    }
    expect(canonicalize(Object.assign(Object.create(null) as object, {b: 1, a: 2}))).toBe('{"a":2,"b":1}');
  });

  it('refuses a cycle and anything nested past the limit', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalize(loop)).toThrow(TypeError);
    let deep: unknown = 1;
    for (let level = 0; level < maxCanonicalDepth + 2; level += 1) deep = [deep];
    expect(() => canonicalize(deep)).toThrow(TypeError);
    let ok: unknown = 1;
    for (let level = 0; level < maxCanonicalDepth; level += 1) ok = [ok];
    expect(canonicalize(ok)).toBe(`${'['.repeat(maxCanonicalDepth)}1${']'.repeat(maxCanonicalDepth)}`);
  });
});

describe('the manifest body of Story 1.12', () => {
  it('has one serialization however its members were written, and so one SHA-256 root', () => {
    const body = {id: '0f5c0b86-2c1b-4d3f-9a58-6c7d8e9f0a1b', scope: 'acct', activity: 'upload:none', kind: 'file', digest: 'ab'.repeat(32), length: 12, serialization: 1, children: []};
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(canonicalize(reordered)).toBe(canonicalize(body));
    expect(canonicalize(body)).toBe(
      `{"activity":"upload:none","children":[],"digest":"${'ab'.repeat(32)}","id":"0f5c0b86-2c1b-4d3f-9a58-6c7d8e9f0a1b","kind":"file","length":12,"scope":"acct","serialization":1}`,
    );
  });
});
