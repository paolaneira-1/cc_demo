/**
 * Subtext Demo — Automated Recording Script
 *
 * Drives Chrome with the Subtext extension loaded.
 * Uses a copy of Chrome Profile 18 (paula@spinlink.io) for authentic Gmail.
 * ffmpeg records the full screen separately (run record_demo.sh).
 *
 * Scenes:
 *   1. Gmail — performance review from manager (Jordan Ellis)
 *   2. Gmail — investor passing on the round (Alex Chen / Peak Ventures)
 *   3. DoorDash Greenhouse job posting — survival probability
 *
 * Chrome does NOT need to be closed — the script copies your profile to /tmp.
 */

const { chromium } = require('playwright');
const path = require('path');

const EXTENSION_PATH = path.resolve('/Users/paolaneira/Documents/thinking_machines/demo/subtext/extension');
const CHROME_USER_DATA = '/Users/paolaneira/Library/Application Support/Google/Chrome';
const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Search terms unique enough to find exactly one email in paula@spinlink.io.
// Update these if you change the email subject lines.
const GMAIL_SEARCH_PERF     = 'https://mail.google.com/mail/u/0/#search/subject%3A(H1+Feedback+Path+Forward)';
const GMAIL_SEARCH_INVESTOR = 'https://mail.google.com/mail/u/0/#search/subject%3A(Spinlink+Following+up)';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('Set ANTHROPIC_API_KEY env var before running.');
  process.exit(1);
}

const GREENHOUSE_DOORDASH = 'https://boards.greenhouse.io/doordashusa/jobs/6786292';

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


async function waitForSubtextButton(page, timeout = 8000) {
  try {
    await page.waitForSelector('#subtext-floating-btn, .subtext-site-btn', { timeout });
    return true;
  } catch {
    return false;
  }
}

// Open a Gmail search, click the first result, then trigger Subtext on it.
async function runGmailScene(page, label, searchUrl) {
  console.log(`\nSCENE: Gmail — ${label}`);

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(5000); // Gmail takes a moment to render search results

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

  await sleep(3000); // Wait for email thread to load fully

  const btnFound = await waitForSubtextButton(page, 12000);
  if (btnFound) {
    console.log('  Subtext button detected — clicking...');
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
}

async function run() {
  console.log('Launching Chrome on Profile 18 (paula@spinlink.io)...');
  console.log('NOTE: Chrome must be fully quit (Cmd+Q) before running.\n');

  const context = await chromium.launchPersistentContext(CHROME_USER_DATA, {
    headless: false,
    executablePath: CHROME_EXECUTABLE,
    args: [
      '--profile-directory=Profile 18',
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

  // Hold on results while voiceover finishes real-world use cases section
  console.log('  Holding on results for voiceover use-cases section...');
  await sleep(60000);

  // ----------------------------------------------------------------
  // Done
  // ----------------------------------------------------------------
  console.log('\nDemo sequence complete. Closing in 3s...');
  await sleep(3000);
  await context.close();

  console.log('Done.');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
