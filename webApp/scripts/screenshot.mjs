// Captures PWA screenshots from the demo build (dist-demo/) using puppeteer-core
// driving the Chromium that Playwright already cached on this machine. No live
// Firebase, no network — the app renders the seeded demo state from src/demo/.
//
// Captures each primary screen across multiple accent themes for the README.
//
//   npm run build:demo && node scripts/screenshot.mjs
//
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dir, '../dist-demo');
const outDir = path.resolve(dir, '../../assets/screenshots');
const webOutDir = path.join(outDir, 'web');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/** Themes shown in the README gallery (subset of ACCENTS). */
const THEMES = [
  { slug: 'emerald', name: 'Emerald', hex: '#10B981' },
  { slug: 'cobalt', name: 'Cobalt', hex: '#3B82F6' },
  { slug: 'rose', name: 'Rose', hex: '#F43F5E' },
  { slug: 'violet', name: 'Violet', hex: '#8B5CF6' },
];

const SHOTS = [
  { name: 'auth', hash: '#auth' },
  { name: 'track', hash: '' },
  { name: 'history', hash: '', nav: 'History' },
  { name: 'settings', hash: '', nav: 'Settings' },
];

function findChrome() {
  const roots = [process.env.LOCALAPPDATA, process.env.APPDATA]
    .filter(Boolean)
    .map((r) => path.join(r, 'ms-playwright'));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('chromium-')) continue;
      const exe = path.join(root, entry, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No cached Chromium found under ms-playwright.');
}

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    let file = path.join(distDir, path.normalize(rel));
    if (!file.startsWith(distDir) || !fs.existsSync(file)) file = path.join(distDir, 'index.html');
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Missing dist-demo/index.html — run "npm run build:demo" first.');
  }
  fs.mkdirSync(webOutDir, { recursive: true });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text()); });
    await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

    for (const theme of THEMES) {
      const themeDir = path.join(webOutDir, theme.slug);
      fs.mkdirSync(themeDir, { recursive: true });
      console.log(`\ntheme ${theme.name} (${theme.hex})`);
      const accentQ = `?accent=${encodeURIComponent(theme.hex)}`;

      for (const shot of SHOTS) {
        await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
        const url = shot.hash
          ? `${base}/${accentQ}${shot.hash}`
          : `${base}/${accentQ}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(1400);
        if (shot.nav) {
          const selector = `[aria-label="${shot.nav}"]`;
          await page.waitForSelector(selector, { timeout: 8000 });
          await page.$eval(selector, (el) => el.click());
          await wait(1500);
        }
        const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        const height = Math.min(Math.max(contentHeight, 900), 1700);
        await page.setViewport({ width: 430, height, deviceScaleFactor: 2 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await wait(700);
        const themedOut = path.join(themeDir, `${shot.name}.png`);
        await page.screenshot({ path: themedOut });
        console.log(`  captured web/${theme.slug}/${shot.name}.png (${430}x${height})`);

        // Keep root-level emerald shots for backward-compatible README links.
        if (theme.slug === 'emerald') {
          fs.copyFileSync(themedOut, path.join(outDir, `${shot.name}.png`));
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
