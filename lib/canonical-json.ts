// Story 1.12. JSON Canonicalization Scheme, RFC 8785: the one serialization of a manifest body (the SHA-256 of its bytes is the manifest's
// root, so two implementations of this must never disagree by a byte). tests/unit/canonical-json.test.ts holds the RFC's own vectors, read from
// the RFC and not from memory.
//
// This file has NO imports on purpose, so the file gateway (workers/files, which Node runs through type stripping), the application and the
// tests all read the one definition. Erasable TypeScript syntax only.
//
//   whitespace      none between tokens (RFC 8785 section 3.2.1).
//   literals        null, true, false.
//   strings         ECMAScript's JSON.stringify (section 3.2.2.2): U+0000 to U+001F as \b \t \n \f \r or lower-case \u00xx, `"` and `\` escaped,
//                   everything else as is. A lone surrogate is an ERROR here, because JSON.stringify would write it as an escape and a signature over
//                   that would not survive a round trip through another implementation.
//   numbers         ECMAScript's Number-to-string (section 3.2.2.3; the same function JSON.stringify uses, and the one V8 implements, including its
//                   shortest-round-trip and round-half-even rules). -0 is `0`. NaN and the infinities are ERRORS.
//   object members  sorted by property name as arrays of UTF-16 code units, which is what Array.prototype.sort does with no comparator
//                   (section 3.2.3), recursively; array order is kept.
//   encoding        UTF-8 (`canonicalBytes`).
//
// Only what JSON can hold is accepted: null, booleans, finite numbers, well-formed strings, arrays and plain objects. Anything else
// (`undefined`, a function, a symbol, a bigint, a Date, a Map, a class instance, a cycle) throws a TypeError rather than being skipped or turned
// into something else, so what is signed is exactly what the caller meant.

/** Nesting deeper than this is refused: it bounds the recursion and refuses a cycle. */
export const maxCanonicalDepth = 64;

function text(value: string): string {
  if (!value.isWellFormed()) throw new TypeError('canonical JSON cannot hold a lone surrogate');
  return JSON.stringify(value);
}

function serialize(value: unknown, depth: number): string {
  if (depth > maxCanonicalDepth) throw new TypeError('canonical JSON is nested too deeply');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonical JSON cannot hold NaN or an infinity');
      return JSON.stringify(value);
    case 'string':
      return text(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonical JSON cannot hold a ${typeof value}`);
  }
  if (Array.isArray(value)) {
    // A hole in an array is `undefined` to the iterator, and refused like any other undefined.
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) items.push(serialize(value[index], depth + 1));
    return `[${items.join(',')}]`;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonical JSON holds plain objects only');
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .map((name) => `${text(name)}:${serialize(record[name], depth + 1)}`);
  return `{${members.join(',')}}`;
}

/** The RFC 8785 serialization of a JSON value, as a string of UTF-16 code units. Throws a TypeError for anything JSON cannot hold. */
export function canonicalize(value: unknown): string {
  return serialize(value, 0);
}

/** The same, as the UTF-8 bytes that are hashed and signed (section 3.2.4). */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
