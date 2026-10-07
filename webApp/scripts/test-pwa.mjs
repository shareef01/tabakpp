// Production service-worker regression for #80. Uses real app/SW builds, not demo mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tabakpp-pwa-'));
const evidence = { builds: {}, scenarios: [], documents: [], workerErrors: [], consoleErrors: [], warnings: [], caches: {} };
const output = process.env.PWA_TEST_REPORT || path.join(temporary, 'results.json');
const sessions = new WeakMap();
const fixtureDiagnostic = '[firebase] App Check site key missing in production. Configure the site key and follow SETUP_GUIDE.md before enabling enforcement.';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let directory;
let online = true;
let documentResponses = 0;
const server = http.createServer((request, response) => {
  // CDP offline alone can vary between page and SW targets. No server response
  // can succeed during offline scenarios, even if a worker bypasses emulation.
  if (!online) return request.socket.destroy();
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let file = path.resolve(directory, `.${pathname}`);
  if (!file.startsWith(`${directory}${path.sep}`) && file !== directory) {
    response.writeHead(403); return response.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(directory, 'index.html');
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  response.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate');
  if (path.extname(file) === '.html') documentResponses++;
  fs.createReadStream(file).pipe(response);
});

function executable() {
  const candidates = [process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean)) {
    const cache = path.join(base, 'ms-playwright');
    if (fs.existsSync(cache)) for (const folder of fs.readdirSync(cache).sort().reverse()) {
      if (folder.startsWith('chromium-')) candidates.push(path.join(cache, folder, 'chrome-win64', 'chrome.exe'));
    }
  }
  const found = candidates.find(candidate => candidate && fs.existsSync(candidate));
  assert(found, 'Chromium required: set PUPPETEER_EXECUTABLE_PATH');
  return found;
}

function build(label) {
  const destination = path.join(temporary, label);
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', destination, '--emptyOutDir'], {
    cwd: root, encoding: 'utf8', env: {
      ...process.env, VITE_BUILD_ID: label,
      // Non-secret client config exercises the real signed-out app. No Firebase
      // auth/data responses are mocked and no sign-in/data operation is attempted.
      VITE_FIREBASE_API_KEY: 'pwa-local-public-test-key', VITE_FIREBASE_AUTH_DOMAIN: 'demo-tabakpp-pwa.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'demo-tabakpp-pwa', VITE_FIREBASE_STORAGE_BUCKET: 'demo-tabakpp-pwa.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789', VITE_FIREBASE_APP_ID: '1:123456789:web:abcdef123456',
      VITE_FIREBASE_APPCHECK_SITE_KEY: '',
    },
  });
  fs.writeFileSync(path.join(temporary, `${label}.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(path.join(destination, 'index.html'), 'utf8');
  const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)[1];
  evidence.builds[label] = { directory: destination, entry };
  return destination;
}

async function caches(page, label) {
  const contents = await page.evaluate(async () => {
    const result = {};
    for (const name of await window.caches.keys()) result[name] = (await (await window.caches.open(name)).keys()).map(request => request.url);
    return result;
  });
  evidence.caches[label] = contents;
  assert(!Object.keys(contents).includes('tabak-pages'), 'no competing runtime HTML cache');
  const urls = Object.values(contents).flat();
  assert(urls.some(url => new URL(url).pathname.startsWith('/assets/')), 'static assets precached');
  assert(!urls.some(url => /heic2any|googleapis\.com|firebaseio\.com|firebaseapp\.com|gstatic\.com|google\.com/.test(url)), 'no HEIC/API/user-data caching');
  return urls;
}

async function pageFor(context) {
  const page = await context.newPage();
  page.on('pageerror', error => evidence.consoleErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    if (message.type() === 'warn') evidence.warnings.push(message.text());
  });
  // Cosmetic external fonts are fixture CSS, avoiding a dependency on public
  // Google Fonts connectivity. Firebase/backend availability is never mocked.
  await page.setRequestInterception(true);
  page.on('request', request => new URL(request.url()).hostname === 'fonts.googleapis.com'
    ? request.respond({ status: 200, contentType: 'text/css', body: '' }) : request.continue());
  const session = await page.createCDPSession();
  await session.send('Network.enable', { maxTotalBufferSize: 4 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024, enableDurableMessages: true });
  session.on('Network.responseReceived', event => {
    if (event.type === 'Document') evidence.documents.push({ requestId: event.requestId, url: event.response.url, worker: event.response.fromServiceWorker, status: event.response.status });
  });
  await session.send('ServiceWorker.enable');
  session.on('ServiceWorker.workerVersionUpdated', event => {
    evidence.workerVersions = event.versions;
  });
  session.on('ServiceWorker.workerErrorReported', event => evidence.workerErrors.push(event.errorMessage));
  sessions.set(page, session);
  return { page, session };
}

async function shell(page, base, route, label, offline = false) {
  const before = documentResponses;
  const firstDocument = evidence.documents.length;
  // Puppeteer's intercepted offline goto can return null for a SW response.
  // CDP must independently report a real document response; existing DOM is insufficient.
  await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const response = evidence.documents.slice(firstDocument).find(document => document.url === base + route);
  assert(response, 'actual HTML navigation response required');
  const body = await sessions.get(page).send('Network.getResponseBody', { requestId: response.requestId });
  const actual = body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body;
  assert(actual.includes(evidence.builds[label].entry), `${route} serves ${label} HTML`);
  await page.waitForSelector('input[type="email"]');
  await page.waitForFunction(expected => localStorage.getItem('tabak_build_id') === expected, {}, label);
  if (offline) {
    assert(response.worker, `${route} must be served by the controlling SW`);
    assert.equal(documentResponses, before, 'offline navigation cannot receive an HTTP document');
  }
  evidence.scenarios.push({ route, label, offline, serviceWorker: response.worker, status: response.status });
}

async function run() {
  for (const config of ['firebase.json', '../firebase.json']) {
    const hosting = JSON.parse(fs.readFileSync(path.resolve(root, config), 'utf8')).hosting;
    assert(hosting.rewrites.some(rule => rule.source === '**' && rule.destination === '/index.html'), 'test server matches actual SPA rewrites');
  }
  directory = build('pwa-regression-A');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: executable(), headless: true, args: ['--no-sandbox'] });
  evidence.browser = await browser.version();
  try {
    const context = await browser.createBrowserContext(); // Fresh SW/cache/IDB/local state.
    const { page } = await pageFor(context);
    await shell(page, base, '/', 'pwa-regression-A');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await caches(page, 'installed-A');
    online = false;
    await page.setOfflineMode(true);
    // History/settings were never visited online; these are real app paths.
    for (const route of ['/', '/index.html', '/history', '/settings']) await shell(page, base, route, 'pwa-regression-A', true);
    for (const route of ['/api/probe', '/__/auth/handler']) {
      await assert.rejects(page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 10000 }), /ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_EMPTY_RESPONSE/);
      evidence.scenarios.push({ route, excludedFromShell: true });
    }
    const offlineCount = documentResponses;
    online = true;
    await page.setOfflineMode(false);
    directory = build('pwa-regression-B');
    assert.notEqual(evidence.builds['pwa-regression-A'].entry, evidence.builds['pwa-regression-B'].entry);
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    // The A worker must prefer online B HTML even before we request a SW update.
    await shell(page, base, '/history?deployment=B', 'pwa-regression-B');
    assert(documentResponses > offlineCount, 'online deployment really reaches server');
    // The build-id effect sets localStorage immediately before its one-shot
    // reload. Let that navigation finish before asking the browser to update.
    await page.waitForNetworkIdle({ idleTime: 500 });
    await page.waitForSelector('input[type="email"]');
    // Use the real browser update API, then a normal online refresh. Chrome's
    // DevTools updateRegistration can stop a worker mid-activation; it is not
    // the app's update path. Never force skipWaiting/activation from the test.
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update()).catch(error => {
      // autoUpdate may reload the calling document as the new worker claims it.
      if (!error.message.includes('Execution context was destroyed')) throw error;
    });
    await page.waitForNetworkIdle({ idleTime: 500 });
    await page.waitForSelector('input[type="email"]');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(async entry => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration.active?.state !== 'activated' || registration.waiting) return false;
      for (const name of await window.caches.keys()) if (name.includes('precache')) {
        if (await (await window.caches.open(name)).match(entry)) return true;
      }
      return false;
    }, { timeout: 30000, polling: 100 }, evidence.builds['pwa-regression-B'].entry);
    await page.waitForNetworkIdle({ idleTime: 500 });
    await page.waitForSelector('input[type="email"]');
    assert(navigations <= 4, `no SW/build-identity reload loop (${navigations})`);
    const urls = await caches(page, 'activated-B');
    assert(!urls.some(url => new URL(url).pathname === evidence.builds['pwa-regression-A'].entry), 'old precache entry removed');
    assert.equal(urls.filter(url => new URL(url).pathname === '/offline-shell.html').length, 1, 'one revisioned shell snapshot, no duplicate page cache');
    online = false;
    await page.setOfflineMode(true);
    await shell(page, base, '/settings', 'pwa-regression-B', true);
    await context.close();
    online = true;
    const mobileContext = await browser.createBrowserContext();
    const { page: mobile } = await pageFor(mobileContext);
    await mobile.setViewport({ width: 390, height: 844 });
    await shell(mobile, base, '/', 'pwa-regression-B');
    await mobile.evaluate(() => navigator.serviceWorker.ready);
    await mobile.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    online = false;
    await mobile.setOfflineMode(true);
    await shell(mobile, base, '/settings', 'pwa-regression-B', true);
    await caches(mobile, 'mobile-B');
    // Wait for the real sign-in entrance animation before visual evidence.
    await mobile.waitForFunction(() => {
      let element = document.querySelector('input[type="email"]');
      if (!element) return false;
      for (; element; element = element.parentElement) {
        if (Number(getComputedStyle(element).opacity) < 0.99) return false;
      }
      return true;
    });
    await mobile.screenshot({ path: path.join(temporary, 'mobile-offline.png') });
    assert.deepEqual(evidence.workerErrors, [], 'no SW initialization/runtime errors');
    assert.deepEqual(evidence.consoleErrors.filter(error => error !== fixtureDiagnostic), [], 'no fatal browser errors');
    assert.deepEqual(evidence.warnings, []);
    console.log(`PWA regression passed: ${evidence.scenarios.length} scenarios; ${evidence.browser}`);
  } catch (error) {
    evidence.failureState = await Promise.all((await browser.pages()).map(page => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const cacheContents = {};
      for (const name of await caches.keys()) cacheContents[name] = (await (await caches.open(name)).keys()).map(request => request.url);
      return {
        url: location.href, build: localStorage.getItem('tabak_build_id'),
        controller: navigator.serviceWorker.controller?.scriptURL,
        active: registration?.active?.state, installing: registration?.installing?.state,
        waiting: registration?.waiting?.state, cacheContents,
      };
    }).catch(failure => ({ diagnosticError: failure.message }))));
    throw error;
  } finally { await browser.close(); }
}

try { await run(); } catch (error) {
  evidence.failure = error.stack;
  console.error(error);
  // Log full fixture-only evidence on CI failure, including worker lifecycle.
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
}
finally {
  server.closeAllConnections(); server.close();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.log(`PWA evidence: ${output}`);
  // Keep failed evidence; successful CI runs need only their explicit report.
  if (!process.exitCode && !process.env.PWA_TEST_KEEP_OUTPUT) {
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert(path.basename(resolved).startsWith('tabakpp-pwa-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
