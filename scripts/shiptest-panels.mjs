// Ship-test driver (v1.0.52 panels): attaches to the ISOLATED dev instance
// over CDP, opens the TopBar dropdown, exercises Files + Git Tree panels, and
// saves screenshots. Run: node shiptest-panels.mjs   (deleted after the test)
import { chromium } from 'playwright-core';
import http from 'http';

const CDP = 'http://127.0.0.1:9224';
const OUT = process.env.SHIPTEST_OUT || '.';
const shot = (page, name) => page.screenshot({ path: `${OUT}/shiptest-${name}.png` });

// Wait for the CDP endpoint (Electron still booting) up to 90s.
async function waitForCdp() {
  for (let i = 0; i < 90; i += 1) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`${CDP}/json/version`, (res) => { res.resume(); resolve(res.statusCode === 200); });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('CDP endpoint never came up on 9224');
}

await waitForCdp();
const browser = await chromium.connectOverCDP(CDP);
const pages = browser.contexts().flatMap((c) => c.pages());
console.log('pages:', pages.map((p) => p.url()));

// The seeded profile auto-opens the project window (?project=...). Fall back
// to any page that has the TopBar dropdown.
let page = pages.find((p) => p.url().includes('project=')) || pages[0];
if (!page) throw new Error('no pages');
await page.waitForSelector('[aria-label="Terminal side panels"]', { timeout: 30000 });
await page.setViewportSize({ width: 1440, height: 900 });

// 1. Dropdown open state.
await page.click('[aria-label="Terminal side panels"]');
await page.waitForTimeout(300);
await shot(page, '1-dropdown');

// 2. Files panel: open, wait for listing.
await page.click('text=Files');
await page.waitForSelector('text=README.md', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
await shot(page, '2-files-list');

// 3. Navigate into electron/ and preview a file.
await page.click('button:has-text("electron")').catch(() => {});
await page.waitForTimeout(400);
await shot(page, '3-files-electron-dir');
await page.click('button:has-text("selector-parser.js")').catch(() => {});
await page.waitForTimeout(500);
await shot(page, '4-files-preview');

// 4. Switch to Git Tree via the dropdown.
await page.click('[aria-label="Terminal side panels"]');
await page.waitForTimeout(200);
await page.click('text=Git Tree');
await page.waitForSelector('text=Git Tree', { timeout: 10000 });
// Graph rows load async; give the IPC + SVG a beat.
await page.waitForTimeout(1200);
await shot(page, '5-gittree');

// 5. Verify the GitHub remote resolved (the owner/repo button).
const ghBtn = await page.locator('button:has-text("statusdigitalmarketing/dobius-plus")').count();
console.log('github link button present:', ghBtn > 0);

// 6. Close the panel via ✕ and confirm it animates away.
await page.click('[aria-label="Close Git Tree panel"]');
await page.waitForTimeout(500);
await shot(page, '6-closed');

console.log('SHIPTEST DONE');
await browser.close();
process.exit(0);
