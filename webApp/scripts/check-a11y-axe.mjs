import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dir, '../dist-demo');
const axePath = path.resolve(dir, '../node_modules/axe-core/axe.min.js');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/**
 * Locate a Chromium binary cross-platform.
 *
 * The previous version only looked in the Windows ms-playwright layout
 * (`chrome-win64/chrome.exe`), so this audit could never run in CI and was
 * reachable only by a human on Windows who knew the path.
 */
function findChrome() {
  // Same precedence as scripts/test-pwa.mjs so both browser-driven suites
  // resolve the binary the same way (CI runners ship /usr/bin/google-chrome).
  const explicit = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`Browser path does not exist: ${explicit}`);
    return explicit;
  }

  // Playwright's own download locations, per platform.
  const layouts = {
    win32: ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe'],
    darwin: ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['chrome-linux/chrome', 'chrome-linux64/chrome'],
  }[process.platform] ?? ['chrome-linux/chrome'];

  const roots = [process.env.LOCALAPPDATA, process.env.APPDATA, process.env.HOME && path.join(process.env.HOME, '.cache')]
    .filter(Boolean)
    .map((r) => path.join(r, 'ms-playwright'));

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root).sort().reverse()) {
      if (!entry.startsWith('chromium-')) continue;
      for (const layout of layouts) {
        const exe = path.join(root, entry, layout);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }

  // System installs (CI images, distro packages).
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'No Chromium found. Set CHROME_PATH, or run `npx playwright install --with-deps chromium` (CI does).',
  );
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
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

const VIEWPORTS = [
  { name: '320px (min mobile)', width: 320, height: 568 },
  { name: '390px (standard mobile)', width: 390, height: 844 },
  { name: '768px (tablet)', width: 768, height: 1024 },
  { name: '1440px (desktop)', width: 1440, height: 900 },
];

const ACCENTS = [
  { n: 'Signal red', v: '#FF5F5F' },
  { n: 'Amber', v: '#F59E0B' },
  { n: 'Yellow', v: '#FACC15' },
  { n: 'Emerald', v: '#10B981' },
  { n: 'Teal', v: '#14B8A6' },
  { n: 'Cyan', v: '#00D1FF' },
  { n: 'Cobalt', v: '#3B82F6' },
  { n: 'Violet', v: '#8B5CF6' },
  { n: 'Magenta', v: '#EC4899' },
  { n: 'Zinc', v: '#E4E4E7' }
];

const VIEWS = [
  { name: 'track', nav: null, hash: '' },
  { name: 'history', nav: 'History', hash: '' },
  { name: 'settings', nav: 'Settings', hash: '' },
  { name: 'auth', nav: null, hash: '#auth' },
];

async function run() {
  console.log('--- Starting axe-core automated accessibility audit ---');
  if (!fs.existsSync(axePath)) {
    throw new Error(`axe-core script not found at ${axePath}`);
  }
  const axeSource = fs.readFileSync(axePath, 'utf8');

  const { server, url } = await startServer();
  const chromePath = findChrome();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  let totalAudits = 0;
  let totalViolations = 0;
  let contrastIssues = 0;
  // Assigned unconditionally below; the initial `false` was a dead store.
  let reflowViolation;
  const violationSummary = new Map();

  try {
    for (const view of VIEWS) {
      for (const vp of VIEWPORTS) {
        await page.setViewport({ width: vp.width, height: vp.height });
        await page.goto(`${url}/${view.hash}`, { waitUntil: 'networkidle0' });

        if (view.nav) {
          const btn = await page.waitForSelector(`button[aria-label="${view.nav}"]`, { timeout: 3000 });
          await btn.click();
          await new Promise((r) => setTimeout(r, 400));
        }

        if (view.name === 'auth') {
          await page.waitForSelector('form', { timeout: 5000 }).catch(() => {});
        } else {
          await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 600));

        // Run axe
        await page.evaluate(axeSource);
        const results = await page.evaluate(async () => {
          return await window.axe.run(document, {
            runOnly: {
              type: 'tag',
              values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
            },
          });
        });

        totalAudits++;
        const count = results.violations.length;
        if (count > 0) {
          totalViolations += count;
          console.log(`[FAIL] ${view.name} @ ${vp.name}: ${count} violations`);
          for (const v of results.violations) {
            const key = `[${v.impact?.toUpperCase() || 'INFO'}] ${v.id}: ${v.help}`;
            violationSummary.set(key, (violationSummary.get(key) || 0) + 1);
            console.log(`  -> ${key}`);
            for (const n of v.nodes) {
              console.log(`     Target: ${n.target.join(' ')}`);
              console.log(`     HTML: ${n.html.slice(0, 150)}`);
              console.log(`     Failure: ${n.failureSummary?.replace(/\n/g, ' ')}`);
            }
          }
        } else {
          console.log(`[PASS] ${view.name} @ ${vp.name}: 0 violations (${results.passes.length} rules passed)`);
        }
      }
    }

    // Color contrast audit across all 10 accents
    console.log('\n--- Auditing Color Contrast across all 10 Accent Swatches ---');
    await page.setViewport({ width: 390, height: 844 });
    for (const accent of ACCENTS) {
      await page.goto(`${url}/?accent=${encodeURIComponent(accent.v)}`, { waitUntil: 'networkidle0' });
      await page.evaluate(axeSource);
      const accentResults = await page.evaluate(async () => {
        return await window.axe.run(document, {
          runOnly: { type: 'rule', values: ['color-contrast'] },
        });
      });
      const violations = accentResults.violations.length;
      if (violations > 0) {
        contrastIssues += violations;
        totalViolations += violations;
        console.log(`[CONTRAST ISSUE] Accent ${accent.n} (${accent.v}): ${violations} violations`);
        for (const v of accentResults.violations) {
          for (const n of v.nodes) {
            console.log(`  -> ${n.target.join(' ')}: ${n.failureSummary?.replace(/\n/g, ' ')}`);
          }
        }
      } else {
        console.log(`[CONTRAST PASS] Accent ${accent.n} (${accent.v}): Pass (${accentResults.passes.length} contrast nodes cleared)`);
      }
    }

    // 200% Zoom Reflow Audit
    console.log('\n--- Auditing 200% Zoom Reflow (WCAG 1.4.10) ---');
    // At 200% zoom on a 1280px desktop, effective viewport is 640px without horizontal scroll
    await page.setViewport({ width: 640, height: 450, deviceScaleFactor: 2 });
    await page.goto(`${url}/`, { waitUntil: 'networkidle0' });
    reflowViolation = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`Reflow check (640px equivalent 200% desktop): ${reflowViolation ? 'FAIL (Horizontal scroll present)' : 'PASS (No horizontal scroll)'}`);

  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n========================================');
  console.log(`Audit Complete: ${totalAudits} view/viewport combinations tested`);
  console.log(`Total axe-core violations: ${totalViolations}`);
  if (totalViolations > 0) {
    console.log('Violations breakdown:');
    for (const [v, count] of violationSummary.entries()) {
      console.log(` - ${v} (occurred ${count} times)`);
    }
  } else {
    console.log('ALL views and viewports passed automated axe-core checks with 0 violations!');
  }
  console.log('========================================');

  // This script used to log violations and exit 0 regardless, which made it
  // useless as a CI gate. It now fails the run so accessibility regressions
  // (missing labels, contrast, reflow) block the PR that introduces them.
  if (totalViolations > 0 || reflowViolation) {
    console.error(
      `\nAccessibility audit FAILED: ${totalViolations} axe violation(s)`
        + `${contrastIssues ? ` (${contrastIssues} contrast)` : ''}`
        + `${reflowViolation ? ', horizontal scroll at 200% zoom' : ''}.`,
    );
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
