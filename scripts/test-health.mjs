#!/usr/bin/env node
import {spawn} from 'node:child_process';

const port = process.env.PORT || '4174';
const server = spawn('npm', ['start', '--', '--hostname', '127.0.0.1', '--port', port], {stdio: 'ignore'});
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

try {
  let response;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response?.ok) throw new Error('health endpoint did not become ready');
  const payload = await response.json();
  for (const [key, expected] of Object.entries({ok: true, providerCall: false, appMode: 'mock', syntheticData: true})) {
    if (payload[key] !== expected) throw new Error(`health.${key} expected ${expected}, received ${payload[key]}`);
  }
  console.log('Health smoke test passed.');
} finally {
  stop();
}
