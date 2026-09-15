import assert from 'node:assert/strict';
import {getAllowedDevOrigins} from '../lib/dev-origins.ts';

assert.deepEqual(getAllowedDevOrigins('localhost,127.0.0.1,10.103.0.9'), ['localhost', '127.0.0.1', '10.103.0.9']);
assert.deepEqual(getAllowedDevOrigins(' 127.0.0.1, 10.103.0.9, 127.0.0.1 '), ['127.0.0.1', '10.103.0.9']);
assert.deepEqual(getAllowedDevOrigins(''), ['localhost', '127.0.0.1', '10.103.0.9']);
console.log('Development origin tests passed.');
