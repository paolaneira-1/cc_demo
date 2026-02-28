/**
 * Subtext Demo — Automated Recording Script
 *
 * Drives Chrome with the Subtext extension loaded.
 * Uses a copy of Chrome Profile 18 (paula@spinlink.io) for authentic Gmail.
 * ffmpeg records the full screen separately (run record_demo.sh).
 *
 * Scenes:
 *   1. Real Gmail (paula@spinlink.io) — Marcus Holt investor email
 *   2. DoorDash Greenhouse posting — survival probability
 *   3. Honeycomb Greenhouse posting — auto-detected button
 *
 * Chrome does NOT need to be closed — the script copies your profile to /tmp.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const EXTENSION_PATH = path.resolve('/Users/paolaneira/Documents/thinking_machines/demo/subtext/extension');
const CHROME_SRC_DATA  = '/Users/paolaneira/Library/Application Support/Google/Chrome';
const CHROME_SRC_PROFILE = 'Profile 18'; // paula@spinlink.io
const CHROME_TEMP_DATA = '/tmp/subtext-chrome-demo';
const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GMAIL_SEARCH = 'https://mail.google.com/mail/u/0/#search/Luminary+rooting';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('Set ANTHROPIC_API_KEY env var before running.');
  process.exit(1);
}

const GREENHOUSE_1 = 'https://boards.greenhouse.io/doordashusa/jobs/6786292';
const GREENHOUSE_2 = 'https://boards.greenhouse.io/honeycomb/jobs/4916426008';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Copy Profile 18 into a fresh temp Chrome user-data-dir as "Default".
// This lets Chrome stay open while the demo runs — we never touch the real profile.
function copyProfileToTemp() {
  const src = `${CHROME_SRC_DATA}/${CHROME_SRC_PROFILE}`;
  const dst = `${CHROME_TEMP_DATA}/Default`;

  console.log(`Copying Chrome profile to ${CHROME_TEMP_DATA} ...`);
  execSync(`rm -rf "${CHROME_TEMP_DATA}"`);
  execSync(`mkdir -p "${CHROME_TEMP_DATA}"`);

  // "Local State" holds account info Chrome needs to recognise the profile
  const localState = `${CHROME_SRC_DATA}/Local State`;
  if (fs.existsSync(localState)) {
    execSync(`cp "${localState}" "${CHROME_TEMP_DATA}/Local State"`);
  }

  execSync(`cp -r "${src}" "${dst}"`);
  console.log('  Profile copy done.\n');
}

async function waitForSubtextButton(page, timeout = 8000) {
  try {
    await page.waitForSelector('#subtext-floating-btn, .subtext-site-btn', { timeout });
    return true;
  } catch {
    return false;
  }
}

async function run() {
  copyProfileToTemp();

  console.log('Launching Chrome with Subtext extension (Profile: paula@spinlink.io)...');

  const context = await chromium.launchPersistentContext(CHROME_TEMP_DATA, {
    headless: false,
    executablePath: CHROME_EXECUTABLE,
    args: [
      '--profile-directory=Default',
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--window-size=1280,900',
      '--window-position=0,0',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

  // Inject API key into Subtext extension via service worker
  console.log('Injecting API key into Subtext...');

  let worker = null;
  const existingWorkers = context.serviceWorkers();
  if (existingWorkers.length > 0) {
    worker = existingWorkers[0];
  } else {
    try {
      worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    } catch (e) {
      console.warn('  Service worker not detected, waiting 3s...');
      await sleep(3000);
      const ws = context.serviceWorkers();
      if (ws.length > 0) worker = ws[0];
    }
  }

  if (worker) {
    await worker.evaluate((key) => {
      chrome.storage.sync.set({ apiKey: key });
    }, ANTHROPIC_KEY);
    console.log('  API key set via service worker.');
  } else {
    console.error('  Could not inject API key. Set it manually in Subtext settings.');
  }

  await sleep(1000);

  // ----------------------------------------------------------------
  // SCENE 1: Real Gmail — Marcus Holt investor email
  // ----------------------------------------------------------------
  console.log('\nSCENE 1: Gmail — searching for Marcus Holt email...');
  const page = await context.newPage();

  await page.goto(GMAIL_SEARCH, { waitUntil: 'domcontentloaded' });
  await sleep(5000); // Gmail takes a moment to load search results

  // Click the first email in search results
  const emailRow = page.locator('tr.zA').first();
  try {
    await emailRow.waitFor({ timeout: 10000 });
    console.log('  Email found in Gmail — clicking to open...');
    await emailRow.click();
  } catch (e) {
    console.warn('  Email row not found, trying alternative selector...');
    try {
      await page.locator('[role="main"] [role="row"]').first().click();
    } catch (e2) {
      console.error('  Could not find email in Gmail. Is the Marcus email in paula@spinlink.io?');
    }
  }

  await sleep(3000); // Wait for email to open fully

  // Content script auto-detects Gmail and injects "Subtext this email" button
  const btn1 = await waitForSubtextButton(page, 12000);
  if (btn1) {
    console.log('  Subtext button detected on Gmail email — clicking...');
    const siteBtn = page.locator('.subtext-site-btn').first();
    await siteBtn.scrollIntoViewIfNeeded();
    await sleep(800);
    await siteBtn.click();
  } else {
    // Fallback: select email body text manually
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

  // ----------------------------------------------------------------
  // SCENE 2: DoorDash Greenhouse posting
  // ----------------------------------------------------------------
  console.log('\nSCENE 2: DoorDash Greenhouse job posting...');
  await page.goto(GREENHOUSE_1, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  await smoothScroll(page, 400, 2000);
  await sleep(1500);

  const btn2 = await waitForSubtextButton(page, 10000);
  if (btn2) {
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
  await sleep(4000);

  // ----------------------------------------------------------------
  // SCENE 3: Honeycomb Greenhouse posting
  // ----------------------------------------------------------------
  console.log('\nSCENE 3: Honeycomb Greenhouse job posting...');
  await page.goto(GREENHOUSE_2, { waitUntil: 'domcontentloaded' });
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
    const desc = page.locator('#content, .job-post, #app_body').first();
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

  // Hold on scene 3 results while voiceover finishes real-world use cases (~55s)
  console.log('  Holding on results for voiceover use-cases section...');
  await sleep(60000);

  // ----------------------------------------------------------------
  // Done
  // ----------------------------------------------------------------
  console.log('\nDemo sequence complete. Closing in 3s...');
  await sleep(3000);
  await context.close();

  // Clean up temp profile copy
  execSync(`rm -rf "${CHROME_TEMP_DATA}"`);
  console.log('Done. Temp profile cleaned up.');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
