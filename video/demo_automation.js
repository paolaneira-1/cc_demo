/**
 * Subtext Demo — Automated Recording Script
 *
 * Copies Chrome Profile 18 (paula@spinlink.io) to /tmp, launches Chrome
 * directly via spawn (no --use-mock-keychain), then connects via CDP.
 * This preserves Gmail session auth — macOS Keychain works correctly.
 *
 * Scenes:
 *   1. Gmail — performance review from manager (Jordan Ellis)
 *   2. Gmail — investor passing on the round (Alex Chen / Peak Ventures)
 *   3. DoorDash Greenhouse job posting — survival probability
 *
 * IMPORTANT: Chrome must be fully quit (Cmd+Q) before running.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execSync, spawn } = require('child_process');

const EXTENSION_PATH = path.resolve('/Users/paolaneira/Documents/thinking_machines/demo/subtext/extension');
const CHROME_SRC_DATA  = '/Users/paolaneira/Library/Application Support/Google/Chrome';
const CHROME_SRC_PROFILE = 'Profile 18'; // paula@spinlink.io
const CHROME_TEMP_DATA = '/tmp/subtext-chrome-demo';
const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_URL = 'http://localhost:9222';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('Set ANTHROPIC_API_KEY env var before running.');
  process.exit(1);
}

const GMAIL_SEARCH_PERF     = 'https://mail.google.com/mail/u/0/#search/subject%3A(H1+Feedback+Path+Forward)';
const GMAIL_SEARCH_INVESTOR = 'https://mail.google.com/mail/u/0/#search/subject%3A(Spinlink+Following+up)';
const GREENHOUSE_DOORDASH   = 'https://boards.greenhouse.io/doordashusa/jobs/6786292';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Copy Profile 18 to a temp dir so Chrome allows remote debugging
// (Chrome blocks --remote-debugging-port on its default user data dir).
// Launching Chrome directly via spawn avoids --use-mock-keychain,
// so the real macOS Keychain decrypts the Gmail session cookies.
function copyProfileToTemp() {
  const src = `${CHROME_SRC_DATA}/${CHROME_SRC_PROFILE}`;
  const dst = `${CHROME_TEMP_DATA}/Default`;

  console.log(`Copying Chrome profile to ${CHROME_TEMP_DATA}...`);
  execSync(`rm -rf "${CHROME_TEMP_DATA}"`);
  execSync(`mkdir -p "${CHROME_TEMP_DATA}"`);

  const localState = `${CHROME_SRC_DATA}/Local State`;
  if (fs.existsSync(localState)) {
    execSync(`cp "${localState}" "${CHROME_TEMP_DATA}/Local State"`);
  }

  execSync(`cp -r "${src}" "${dst}"`);
  console.log('  Done.\n');
}

// Poll until Chrome's DevTools endpoint is ready.
function waitForDevTools(maxMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function attempt() {
      http.get(`${CDP_URL}/json/version`, res => {
        resolve();
      }).on('error', () => {
        if (Date.now() - start > maxMs) {
          reject(new Error('Chrome DevTools did not start in time'));
        } else {
          setTimeout(attempt, 500);
        }
      });
    }
    attempt();
  });
}

async function smoothScroll(page, distance, duration = 1200) {
  const steps = 30;
  const stepSize = distance / steps;
  const delay = duration / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(d => window.scrollBy(0, d), stepSize);
    await sleep(delay);
  }
}

async function selectTextAndTrigger(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error('Element not found: ' + selector);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel2 = window.getSelection();
    sel2.removeAllRanges();
    sel2.addRange(range);
  }, selector);

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up();
  await page.dispatchEvent('body', 'mouseup', {
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height / 2,
  });
}

async function waitForSubtextButton(page, timeout = 8000) {
  try {
    await page.waitForSelector('#subtext-floating-btn, .subtext-site-btn', { timeout });
    return true;
  } catch {
    return false;
  }
}

async function runGmailScene(page, label, searchUrl) {
  console.log(`\nSCENE: Gmail — ${label}`);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(5000);

  const emailRow = page.locator('tr.zA').first();
  try {
    await emailRow.waitFor({ timeout: 10000 });
    console.log('  Email found — clicking to open...');
    await emailRow.click();
  } catch (e) {
    console.warn('  Email row not found, trying alternative selector...');
    try {
      await page.locator('[role="main"] [role="row"]').first().click();
    } catch (e2) {
      console.error('  Could not find email. Check that it exists in paula@spinlink.io.');
    }
  }

  await sleep(3000);

  const btnFound = await waitForSubtextButton(page, 12000);
  if (btnFound) {
    console.log('  Subtext button detected — clicking...');
    const siteBtn = page.locator('.subtext-site-btn').first();
    await siteBtn.scrollIntoViewIfNeeded();
    await sleep(800);
    await siteBtn.click();
  } else {
    console.log('  Auto-detect button not found — selecting text manually...');
    await selectTextAndTrigger(page, '.a3s.aiL');
    await sleep(500);
    const floatBtn = await waitForSubtextButton(page, 5000);
    if (floatBtn) {
      await page.locator('#subtext-floating-btn').first().click();
    }
  }

  console.log('  Waiting for analysis... (~20s)');
  await sleep(22000);

  await smoothScroll(page, 400, 2500);
  await sleep(3000);
}

async function run() {
  copyProfileToTemp();

  console.log('Launching Chrome with remote debugging on port 9222...');
  const chromeProcess = spawn(CHROME_EXECUTABLE, [
    '--remote-debugging-port=9222',
    '--profile-directory=Default',
    `--user-data-dir=${CHROME_TEMP_DATA}`,
    `--disable-extensions-except=${EXTENSION_PATH}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--window-size=1280,900',
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });

  console.log(`  Chrome PID: ${chromeProcess.pid}`);

  console.log('Waiting for DevTools to be ready...');
  await waitForDevTools();
  await sleep(2000);

  console.log('Connecting via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  // Inject API key into Subtext extension via service worker
  console.log('Injecting API key into Subtext...');
  await sleep(3000); // give extension time to register service worker

  let worker = null;
  const existing = context.serviceWorkers();
  if (existing.length > 0) {
    worker = existing[0];
  } else {
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch {
      console.warn('  Service worker not detected — key may already be set in profile.');
      await sleep(2000);
      const ws = context.serviceWorkers();
      if (ws.length > 0) worker = ws[0];
    }
  }

  if (worker) {
    await worker.evaluate((key) => {
      chrome.storage.sync.set({ apiKey: key });
    }, ANTHROPIC_KEY);
    console.log('  API key set.');
  }

  await sleep(1000);

  const page = await context.newPage();

  // ----------------------------------------------------------------
  // SCENE 1: Performance review email from manager
  // ----------------------------------------------------------------
  await runGmailScene(page, 'performance review (Jordan Ellis)', GMAIL_SEARCH_PERF);

  // ----------------------------------------------------------------
  // SCENE 2: Investor passing on the round
  // ----------------------------------------------------------------
  await runGmailScene(page, 'investor pass (Alex Chen / Peak Ventures)', GMAIL_SEARCH_INVESTOR);

  // ----------------------------------------------------------------
  // SCENE 3: DoorDash Greenhouse job posting — survival probability
  // ----------------------------------------------------------------
  console.log('\nSCENE 3: DoorDash Greenhouse job posting...');
  await page.goto(GREENHOUSE_DOORDASH, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  await smoothScroll(page, 400, 2000);
  await sleep(1500);

  const btn3 = await waitForSubtextButton(page, 10000);
  if (btn3) {
    console.log('  Auto-detected Subtext button — clicking...');
    const siteBtn = page.locator('.subtext-site-btn').first();
    await siteBtn.scrollIntoViewIfNeeded();
    await sleep(800);
    await siteBtn.click();
  } else {
    console.log('  Selecting text manually...');
    const desc = page.locator('#content, .job-post, #app_body, .job-post-description').first();
    const descText = await desc.innerText().catch(() => '');
    if (descText.length > 100) {
      await page.evaluate((t) => {
        chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text: t });
      }, descText.slice(0, 1500));
    }
  }

  console.log('  Waiting for analysis... (~20s)');
  await sleep(22000);

  await smoothScroll(page, 500, 2500);

  console.log('  Holding on results for voiceover use-cases section...');
  await sleep(60000);

  // ----------------------------------------------------------------
  // Done
  // ----------------------------------------------------------------
  console.log('\nDemo sequence complete. Closing in 3s...');
  await sleep(3000);

  chromeProcess.kill();
  execSync(`rm -rf "${CHROME_TEMP_DATA}"`);
  console.log('Done. Temp profile cleaned up.');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
