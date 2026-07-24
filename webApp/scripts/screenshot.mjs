// Captures PWA screenshots from the demo build (dist-demo/) for the README.
// Desktop viewport + red accent only (no phone frames / theme matrix).
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
const desktopDir = path.join(outDir, 'web', 'desktop', 'red');
const showcaseDir = path.join(outDir, 'showcase');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/** README product shots — red accent on a laptop-sized canvas. */
const RED = '#F43F5E';
const VIEW = { width: 1440, height: 900, deviceScaleFactor: 2 };

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
  fs.mkdirSync(desktopDir, { recursive: true });
  fs.mkdirSync(showcaseDir, { recursive: true });

  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: 'new',
    args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', `--window-size=${VIEW.width},${VIEW.height}`],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text()); });

    const accentQ = `?accent=${encodeURIComponent(RED)}`;
    console.log(`\ndesktop red (${RED}) @ ${VIEW.width}x${VIEW.height}`);

    for (const shot of SHOTS) {
      await page.setViewport(VIEW);
      const url = shot.hash ? `${base}/${accentQ}${shot.hash}` : `${base}/${accentQ}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await wait(1400);
      if (shot.nav) {
        const selector = `[aria-label="${shot.nav}"]`;
        await page.waitForSelector(selector, { timeout: 8000 });
        await page.$eval(selector, (el) => el.click());
        await wait(1600);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await wait(500);
      const file = `${shot.name}.png`;
      const dest = path.join(desktopDir, file);
      await page.screenshot({ path: dest, fullPage: false });
      fs.copyFileSync(dest, path.join(showcaseDir, `web-${shot.name}.png`));
      // Root aliases for simple embeds
      fs.copyFileSync(dest, path.join(outDir, file));
      console.log(`  captured ${file}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
