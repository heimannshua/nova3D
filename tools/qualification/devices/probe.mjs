import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {dirname, join, normalize} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {homedir} from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const cacheRoot = process.env.NOVA3D_DEVICE_CACHE || join(homedir(), '.cache/nova3d-qualification-20260914/devices');
const {chromium} = await import(pathToFileURL(join(cacheRoot, 'node_modules/playwright/index.mjs')).href);
const fixtureRoot = join(here, 'fixture');
const chromePath = process.env.NOVA3D_CHROME || '/usr/bin/google-chrome';
const expectedArtifact = [...await readFile(join(fixtureRoot, 'artifact.bin'))];
const expectedVersions = {playwright: '1.63.0', three: '0.186.0', 'onnxruntime-web': '1.29.0'};
const packageVersions = {};
for (const [name, expected] of Object.entries(expectedVersions)) {
  const actual = JSON.parse(await readFile(join(cacheRoot, 'node_modules', name, 'package.json'), 'utf8')).version;
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, installed ${actual}`);
  packageVersions[name] = actual;
}

const concat = (...parts) => {
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
};
const utf8 = value => new TextEncoder().encode(value);
const varint = value => {
  const bytes = [];
  let n = BigInt(value);
  while (n > 127n) { bytes.push(Number((n & 127n) | 128n)); n >>= 7n; }
  bytes.push(Number(n));
  return Uint8Array.from(bytes);
};
const fieldVarint = (field, value) => concat(Uint8Array.from([(field << 3) | 0]), varint(value));
const fieldBytes = (field, bytes) => concat(Uint8Array.from([(field << 3) | 2]), varint(bytes.length), bytes);
const fieldString = (field, value) => fieldBytes(field, utf8(value));

// Tiny valid ONNX Identity graph: this verifies the pinned browser runtime can
// load and execute a model. It is intentionally not an image-to-3D model.
function identityModel() {
  const dimension = fieldVarint(1, 1);
  const shape = fieldBytes(1, dimension);
  const tensorType = concat(fieldVarint(1, 1), fieldBytes(2, shape)); // FLOAT
  const valueType = fieldBytes(1, tensorType); // TypeProto.tensor_type
  const valueInfo = name => concat(fieldString(1, name), fieldBytes(2, valueType));
  const node = concat(fieldString(1, 'input'), fieldString(2, 'output'), fieldString(4, 'Identity'));
  const graph = concat(fieldBytes(1, node), fieldString(2, 'nova3d_identity'), fieldBytes(11, valueInfo('input')), fieldBytes(12, valueInfo('output')));
  const opset = fieldVarint(2, 13);
  return concat(fieldVarint(1, 8), fieldString(2, 'nova3d-device-probe'), fieldBytes(7, graph), fieldBytes(8, opset));
}

function serve() {
  const model = identityModel();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/identity.onnx') {
        res.writeHead(200, {'content-type': 'application/octet-stream', 'content-length': model.length});
        res.end(model);
        return;
      }
      let relative = url.pathname === '/' ? '/index.html' : url.pathname;
      const root = relative.startsWith('/node_modules/') ? join(cacheRoot, 'node_modules') : fixtureRoot;
      if (relative.startsWith('/node_modules/')) relative = relative.slice('/node_modules'.length);
      const file = normalize(join(root, relative));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); res.end(); return; }
      const contentType = file.endsWith('.html') ? 'text/html; charset=utf-8' :
        (file.endsWith('.js') || file.endsWith('.mjs')) ? 'text/javascript; charset=utf-8' :
        file.endsWith('.wasm') ? 'application/wasm' :
        file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      res.writeHead(200, {'content-type': contentType, 'content-length': info.size, 'cache-control': 'no-store'});
      createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500);
      res.end(String(error));
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port})));
}

async function probePage(page, url, mode) {
  await page.goto(url, {waitUntil: 'load'});
  await page.waitForFunction(() => window.__probeReady === true);
  return page.evaluate(async ({mode, expectedArtifact}) => {
    const offlineMode = mode.includes('offline');
    const result = {mode, identity: {}, storage: {}, geometry: {}, onnx: {}, offline: {}};
    result.identity = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      crossOriginIsolated: self.crossOriginIsolated,
      secureContext: self.isSecureContext,
      viewport: {width: innerWidth, height: innerHeight, devicePixelRatio: devicePixelRatio},
      serviceWorker: 'serviceWorker' in navigator,
      indexedDB: 'indexedDB' in self,
      opfs: Boolean(navigator.storage?.getDirectory),
      worker: 'Worker' in self,
      webgpu: 'gpu' in navigator,
    };
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    result.identity.webgl2 = Boolean(gl);
    result.identity.webgl2Status = gl ? 'PASS' : 'UNSUPPORTED';
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      result.identity.webglRenderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      result.identity.webglVendor = debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      result.identity.webglVersion = gl.getParameter(gl.VERSION);
    }
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        result.identity.webgpuAdapter = adapter ? {name: adapter.name ?? null, features: [...adapter.features]} : null;
        result.identity.webgpuStatus = adapter ? 'PASS' : 'UNSUPPORTED';
      } catch (error) { result.identity.webgpuStatus = 'UNSUPPORTED'; result.identity.webgpuError = String(error); }
    } else result.identity.webgpuStatus = 'UNSUPPORTED';
    result.storage.indexedDB = await new Promise(resolve => {
      const matchesRecord = value => value?.kind === 'synthetic' && value?.bytes === 32 &&
        Array.isArray(value.data) && value.data.length === 32 && value.data.every(byte => byte === 7);
      const request = indexedDB.open('nova3d-device-probe', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('artifacts');
      request.onerror = () => resolve({pass: false, error: request.error?.message});
      request.onsuccess = () => {
        const db = request.result;
        if (offlineMode) {
          const readTx = db.transaction('artifacts', 'readonly');
          const read = readTx.objectStore('artifacts').get('fixture');
          read.onsuccess = () => resolve({pass: matchesRecord(read.result), preexisting: true, value: read.result ?? null});
          read.onerror = () => resolve({pass: false, preexisting: false, error: read.error?.message});
          return;
        }
        const tx = db.transaction('artifacts', 'readwrite');
        tx.objectStore('artifacts').put({kind: 'synthetic', bytes: 32, data: Array(32).fill(7)}, 'fixture');
        tx.oncomplete = () => {
          const readTx = db.transaction('artifacts', 'readonly');
          const read = readTx.objectStore('artifacts').get('fixture');
          read.onsuccess = () => resolve({pass: matchesRecord(read.result), value: read.result});
          read.onerror = () => resolve({pass: false, error: read.error?.message});
        };
        tx.onerror = () => resolve({pass: false, error: tx.error?.message});
      };
    });
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle('nova3d-synthetic-artifact.bin', {create: !offlineMode});
        if (!offlineMode) {
          const writable = await handle.createWritable();
          await writable.write(new Uint8Array(32).fill(7));
          await writable.close();
        }
        const file = await handle.getFile();
        const bytes = new Uint8Array(await file.arrayBuffer());
        result.storage.opfs = {pass: file.size === 32 && bytes.every(value => value === 7), preexisting: offlineMode, size: file.size};
      } catch (error) { result.storage.opfs = {pass: false, error: String(error)}; }
    } else result.storage.opfs = {pass: false, error: 'API unavailable'};
    result.storage.worker = await new Promise(resolve => {
      const worker = new Worker(URL.createObjectURL(new Blob(['self.onmessage = e => self.postMessage({echo: e.data});'], {type: 'text/javascript'})));
      const timer = setTimeout(() => { worker.terminate(); resolve({pass: false, error: 'timeout'}); }, 3000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve({pass: event.data.echo === 'worker-fixture', value: event.data}); };
      worker.postMessage('worker-fixture');
    });
    if (offlineMode) {
      result.geometry = {status: 'NOT RUN', reason: 'Three.js module was not cached for the offline persistence pass'};
      result.onnx = {status: 'NOT RUN', reason: 'ONNX Runtime Web and model assets were not cached for the offline persistence pass'};
    } else try {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const geometry = new THREE.BoxGeometry(2, 3, 4);
      geometry.userData = {semanticFeatureIds: ['fixture.box', 'fixture.base']};
      geometry.computeBoundingBox();
      result.geometry = {
        pass: geometry.getAttribute('position').count > 0 && geometry.boundingBox?.getSize(new THREE.Vector3()).toArray().join(',') === '2,3,4',
        positionCount: geometry.getAttribute('position').count,
        boundsMm: geometry.boundingBox?.getSize(new THREE.Vector3()).toArray(),
        semanticFeatureIds: geometry.userData.semanticFeatureIds,
        threeRevision: THREE.REVISION,
      };
      geometry.dispose();
    } catch (error) { result.geometry = {pass: false, error: String(error)}; }
    if (!offlineMode) try {
      const ort = await import('/node_modules/onnxruntime-web/dist/ort.wasm.mjs');
      ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
      const modelBytes = await (await fetch('/identity.onnx')).arrayBuffer();
      const session = await ort.InferenceSession.create(modelBytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'disabled'});
      const input = new ort.Tensor('float32', Float32Array.from([3.5]), [1]);
      const outputs = await session.run({input});
      const output = outputs.output;
      result.onnx = {pass: output?.data?.[0] === 3.5, executionProvider: 'wasm', input: 3.5, output: output?.data?.[0], runtime: ort.env.wasm.numThreads};
    } catch (error) { result.onnx = {pass: false, error: String(error)}; }
    if (mode.includes('offline')) {
      const response = await fetch('/artifact.bin');
      const bytes = new Uint8Array(await response.arrayBuffer());
      const cache = await caches.open('nova3d-device-probe-v1');
      const cached = await cache.match('/artifact.bin');
      const cachedBytes = cached ? new Uint8Array(await cached.arrayBuffer()) : new Uint8Array();
      const matches = actual => actual.length === expectedArtifact.length && actual.every((byte, index) => byte === expectedArtifact[index]);
      const sameLengthCorruption = bytes.slice();
      if (sameLengthCorruption.length) sameLengthCorruption[0] ^= 1;
      result.offline = {pass: response.ok && matches(bytes) && matches(cachedBytes) && !matches(sameLengthCorruption), exactBytesMatch: matches(bytes) && matches(cachedBytes), sameLengthCorruptionRejected: !matches(sameLengthCorruption), navigationPath: location.pathname, artifactBytes: bytes.length, cachedArtifact: Boolean(cached), controller: Boolean(navigator.serviceWorker.controller)};
    }
    return result;
  }, {mode, expectedArtifact});
}

const {server, port} = await serve();
let browser;
const base = `http://127.0.0.1:${port}`;
const report = {scope: 'Synthetic headless Linux primitives; G-5/G-8 BLOCKED; offline inference and layout acceptance NOT RUN', metadata: {node: process.version, chromePath, packageVersions, host: process.platform + ' ' + process.arch}, probes: []};
try {
  browser = await chromium.launch({headless: true, executablePath: chromePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-webgpu', '--use-angle=swiftshader']});
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, serviceWorkers: 'allow'});
  const page = await context.newPage();
  report.probes.push(await probePage(page, `${base}/index.html`, 'desktop-headless-linux'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({waitUntil: 'load'});
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  report.probes.push(await probePage(page, `${base}/index.html`, 'offline-after-service-worker'));
  await context.setOffline(false);
  await context.close();
  for (const emulation of [{name: 'viewport-393x852-api-emulation', width: 393, height: 852, dpr: 3}, {name: 'viewport-412x915-api-emulation', width: 412, height: 915, dpr: 2.625}]) {
    const emulated = await browser.newContext({viewport: {width: emulation.width, height: emulation.height}, deviceScaleFactor: emulation.dpr, isMobile: true, serviceWorkers: 'allow'});
    const emulatedPage = await emulated.newPage();
    report.probes.push(await probePage(emulatedPage, `${base}/index.html`, emulation.name));
    await emulated.close();
  }
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  server.close();
}
const failedAssertions = [];
for (const probe of report.probes) {
  const required = [
    ['WebGL2 context', probe.identity.webgl2 === true],
    ['IndexedDB persistence', probe.storage.indexedDB?.pass === true],
    ['OPFS persistence', probe.storage.opfs?.pass === true],
    ['Worker execution', probe.storage.worker?.pass === true],
  ];
  if (probe.mode.includes('offline')) {
    required.push(['offline Service Worker/cache artifact', probe.offline?.pass === true]);
    required.push(['offline Service Worker controller', probe.offline?.controller === true]);
  } else {
    required.push(['Three.js geometry fixture', probe.geometry?.pass === true]);
    required.push(['ONNX Runtime Web inference fixture', probe.onnx?.pass === true]);
  }
  for (const [name, pass] of required) if (!pass) failedAssertions.push({mode: probe.mode, assertion: name});
}
report.overallStatus = failedAssertions.length === 0 ? 'PASS' : 'FAIL';
report.failedAssertions = failedAssertions;
report.unsupportedCapabilities = report.probes.filter(probe => probe.identity.webgpuStatus === 'UNSUPPORTED').map(probe => ({mode: probe.mode, capability: 'WebGPU', status: 'UNSUPPORTED'}));
console.log(JSON.stringify(report, null, 2));
if (failedAssertions.length) process.exitCode = 1;
