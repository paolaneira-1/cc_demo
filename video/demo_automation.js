/**
 * Subtext Demo — Automated Recording Script
 *
 * Drives Chrome with the Subtext extension loaded.
 * ffmpeg records the full screen separately (run record_demo.sh).
 *
 * Scenes:
 *   1. Investor email (local HTML) — BS score + archetype
 *   2. DoorDash Greenhouse posting — survival probability
 *   3. Honeycomb Greenhouse posting — auto-detected button
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXTENSION_PATH = path.resolve('/Users/paolaneira/Documents/thinking_machines/demo/subtext/extension');
// Served via local HTTP server started by record_demo.sh (avoids file:// extension restrictions)
const EMAIL_PAGE = 'http://localhost:8765/investor_email.html';

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
  // Select text inside element and fire mouseup to trigger content script
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

  // Fire mouseup near center of element to trigger content script
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

async function run() {
  console.log('Launching Chrome with Subtext extension...');

  const userDataDir = '/tmp/subtext-demo-profile';
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--window-size=1280,900',
      '--window-position=0,0',
    ],
    viewport: { width: 1280, height: 900 },
  });

  // Inject API key into extension storage via service worker
  console.log('Injecting API key into extension...');

  // Wait for the extension service worker to register (up to 10s)
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
    // Fallback: navigate to a blank page and set storage via content script message
    console.log('  No service worker found - trying options page fallback...');
    const tmpPage = await context.newPage();
    await tmpPage.goto('about:blank');
    // Try to get extension ID from chrome://extensions
    const extIdPage = await context.newPage();
    let extId = '';
    try {
      await extIdPage.goto('chrome://extensions', { timeout: 5000 });
      extId = await extIdPage.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        return manager?.shadowRoot?.querySelector('extensions-item')?.getAttribute('id') || '';
      });
    } catch (e) {}
    await extIdPage.close();

    if (extId) {
      const optPage = await context.newPage();
      await optPage.goto(`chrome-extension://${extId}/options/index.html`);
      await optPage.evaluate((key) => {
        chrome.storage.sync.set({ apiKey: key });
      }, ANTHROPIC_KEY);
      await optPage.close();
      console.log(`  API key set via options page (ext: ${extId}).`);
    } else {
      console.error('  Could not inject API key - set it manually in the extension.');
    }
    await tmpPage.close();
  }

  await sleep(1000);

  // ----------------------------------------------------------------
  // SCENE 1: Investor email
  // ----------------------------------------------------------------
  console.log('\nSCENE 1: Investor email...');
  const page = await context.newPage();
  await page.goto(EMAIL_PAGE, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  // Open side panel
  await page.evaluate(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
  }).catch(() => {});
  await sleep(1500);

  // Select the email body text
  await selectTextAndTrigger(page, '#email-body');
  await sleep(1000);

  const btn1 = await waitForSubtextButton(page);
  if (btn1) {
    console.log('  Subtext button appeared - clicking...');
    const button = page.locator('#subtext-floating-btn').first();
    await button.click();
  } else {
    // Fallback: send message directly
    console.log('  Button not found - sending directly...');
    const text = await page.locator('#email-body').innerText();
    await page.evaluate((t) => {
      chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text: t });
    }, text);
  }

  console.log('  Waiting for analysis... (~20s)');
  await sleep(22000); // wait for Claude to respond

  // Scroll through results slowly
  await smoothScroll(page, 600, 3000);
  await sleep(3000);

  // ----------------------------------------------------------------
  // SCENE 2: DoorDash Greenhouse posting
  // ----------------------------------------------------------------
  console.log('\nSCENE 2: DoorDash Greenhouse job posting...');
  await page.goto(GREENHOUSE_1, { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  // Scroll down to job description
  await smoothScroll(page, 400, 2000);
  await sleep(1500);

  // Wait for auto-detected Subtext button (content script detects Greenhouse)
  const btn2 = await waitForSubtextButton(page, 10000);
  if (btn2) {
    console.log('  Auto-detected Subtext button found - clicking...');
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
    console.log('  Auto-detected Subtext button found - clicking...');
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
  console.log('Done.');
}

async function getExtensionId(context) {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  const id = await page.evaluate(() => {
    return document.querySelector('extensions-manager')
      ?.shadowRoot?.querySelector('extensions-item')
      ?.getAttribute('id') || '';
  });
  await page.close();
  return id;
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
