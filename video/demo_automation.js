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
const CHROME_SRC_PROFILE = 'Default'; // paula@spinlink.io (unmanaged profile)
const CHROME_TEMP_DATA = '/tmp/subtext-chrome-demo';
const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP_URL = 'http://localhost:9222';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_KEY) {
  console.error('Set ANTHROPIC_API_KEY env var before running.');
  process.exit(1);
}

const GMAIL_SEARCH_PERF     = 'https://mail.google.com/mail/u/0/#search/subject%3A(H1+Feedback+Path+Forward)';
const GMAIL_SEARCH_INVESTOR = 'https://mail.google.com/mail/u/0/#search/subject%3A(ACME+Inc+Following+up)';
const JOB_POSTING_URL = 'https://job-boards.greenhouse.io/doordashusa/jobs/6786292';

const DEMO_KEY_PATH = path.join(EXTENSION_PATH, 'background', 'demo-key.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Timestamp logging — every log line prefixed with seconds since script start.
// After each run, read these to calibrate sleep values precisely.
// Recording starts 2s before this script (ffmpeg sleep in record_demo.sh),
// so video_t = logged_t + 2s.
const SCRIPT_START = Date.now();
function ts(label) {
  const secs = ((Date.now() - SCRIPT_START) / 1000).toFixed(1);
  console.log(`[t=${secs}s / video~t=${(parseFloat(secs)+2).toFixed(1)}s] ${label}`);
}

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

  // Delete session restore files so Chrome starts clean instead of
  // reopening tabs from the previous session.
  for (const f of ['Current Session', 'Current Tabs', 'Last Session', 'Last Tabs']) {
    try { fs.unlinkSync(`${dst}/${f}`); } catch {}
  }

  // Pre-block Gmail's protocol handler registration request so Chrome never
  // shows the "mail.google.com wants to Open email links" popup during recording.
  const prefsPath = `${dst}/Preferences`;
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    prefs.profile = prefs.profile || {};
    prefs.profile.content_settings = prefs.profile.content_settings || {};
    prefs.profile.content_settings.exceptions = prefs.profile.content_settings.exceptions || {};
    prefs.profile.content_settings.exceptions.protocol_handlers =
      prefs.profile.content_settings.exceptions.protocol_handlers || {};
    prefs.profile.content_settings.exceptions.protocol_handlers['https://mail.google.com,*'] = { setting: 2 };
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    console.log('  Protocol handler dialog suppressed.');
  } catch (e) {
    console.warn('  Could not patch Preferences (non-fatal):', e.message);
  }

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

// Scroll the Subtext side panel down to reveal more analysis content.
async function scrollSidePanel(context, amount = 350) {
  const extId = 'fignfifoniblkonapihmkfakmlgkbkcf';
  const panelPages = context.pages().filter(p =>
    p.url().startsWith(`chrome-extension://${extId}`) && p.url().includes('sidepanel')
  );
  if (panelPages.length > 0) {
    await panelPages[0].evaluate((amt) => window.scrollBy({ top: amt, behavior: 'smooth' }), amount);
    return true;
  }
  return false;
}

async function waitForSubtextButton(page, timeout = 8000) {
  try {
    await page.waitForSelector('#subtext-floating-btn, .subtext-site-btn', { timeout });
    return true;
  } catch {
    return false;
  }
}

// Returns the active page after the scene (may differ from input if Gmail opened a new tab).
async function runGmailScene(context, page, label, searchUrl) {
  console.log(`\nSCENE: Gmail — ${label}`);

  await page.bringToFront();
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  const pagesBefore = context.pages().length;

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

  await sleep(1500);

  // Gmail sometimes opens emails in a new tab. Detect and switch to it.
  let activePage = page;
  const allPages = context.pages();
  if (allPages.length > pagesBefore) {
    const newPage = allPages[allPages.length - 1];
    if (newPage !== page) {
      activePage = newPage;
      console.log('  Gmail opened email in a new tab — switching to it.');
      await activePage.bringToFront();
      await activePage.waitForLoadState('domcontentloaded');
      await sleep(500);
    }
  }

  const btnFound = await waitForSubtextButton(activePage, 12000);
  if (btnFound) {
    console.log('  Subtext button detected — clicking...');
    const siteBtn = activePage.locator('.subtext-site-btn').first();
    await siteBtn.scrollIntoViewIfNeeded();
    await sleep(300);
    await siteBtn.click();
  } else {
    console.log('  Auto-detect button not found — selecting text manually...');
    try {
      await selectTextAndTrigger(activePage, '.a3s.aiL');
      await sleep(500);
      const floatBtn = await waitForSubtextButton(activePage, 5000);
      if (floatBtn) {
        await activePage.locator('#subtext-floating-btn').first().click();
      }
    } catch (e) {
      console.warn('  Text selection failed:', e.message.split('\n')[0]);
    }
  }

  console.log('  Waiting for analysis... (~38s)');
  await sleep(38000);

  await smoothScroll(activePage, 200, 1000);

  return activePage;
}

async function run() {
  // Write API key into extension directory so the service worker can fetch it.
  // This bypasses chrome.storage (not accessible via CDP) and the options page
  // (blocked by Workspace policy in the UI, unreachable via CDP navigation).
  fs.writeFileSync(DEMO_KEY_PATH, JSON.stringify({ apiKey: ANTHROPIC_KEY }));
  console.log('API key written to extension/background/demo-key.json');

  copyProfileToTemp();

  console.log('Launching Chrome with remote debugging on port 9222...');
  const chromeProcess = spawn(CHROME_EXECUTABLE, [
    '--remote-debugging-port=9222',
    '--profile-directory=Default',
    `--user-data-dir=${CHROME_TEMP_DATA}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--window-size=1280,900',
    '--window-position=0,0',
    '--no-first-run',
    '--no-default-browser-check',
  ], { stdio: 'ignore' });

  console.log(`  Chrome PID: ${chromeProcess.pid}`);

  console.log('Waiting for DevTools to be ready...');
  await waitForDevTools();
  await sleep(500);

  console.log('Connecting via CDP...');
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  // Dismiss "This profile will be managed" dialog if present.
  console.log('Checking for managed profile dialog...');
  await sleep(500);
  try {
    const pages = context.pages();
    for (const p of pages) {
      try {
        const btn = p.getByRole('button', { name: 'Continue' });
        await btn.waitFor({ timeout: 1500 });
        await btn.click();
        console.log('  Managed profile dialog dismissed.');
        await sleep(500);
        break;
      } catch { /* not on this page */ }
    }
  } catch (e) {
    console.log('  No managed profile dialog found — continuing.');
  }

  // Poll for extension service worker — 3s max (service worker may not be visible
  // via CDP on all profiles; scenes work regardless via demo-key.json).
  let workers = [];
  for (let i = 0; i < 3; i++) {
    workers = context.serviceWorkers();
    if (workers.length > 0) break;
    await sleep(500);
  }
  if (workers.length > 0) {
    const m = workers[0].url().match(/chrome-extension:\/\/([a-z0-9]+)\//);
    console.log(`Extension service worker detected (ext: ${m ? m[1] : 'unknown'}).`);
  }

  let page = await context.newPage();

  // ── SCENE 1: Go straight to the email — no inbox detour ─────────────────────
  // Chrome startup takes ~10s. We navigate directly to the search URL so the
  // email appears at ~0:13 (during the intro voiceover). Subtext is triggered
  // immediately so analysis runs while the intro plays — results are ready by
  // the time Beat 1 starts at ~0:38.
  ts('SCENE 1 start — navigating to performance review email');
  let scene1Page = page;
  await scene1Page.bringToFront();
  await scene1Page.goto(GMAIL_SEARCH_PERF, { waitUntil: 'domcontentloaded' });
  try {
    await scene1Page.locator('tr.zA').first().waitFor({ timeout: 10000 });
    console.log('  Email found — clicking immediately...');
    await scene1Page.locator('tr.zA').first().click();
  } catch {
    try { await scene1Page.locator('[role="main"] [role="row"]').first().click(); } catch {}
  }
  await sleep(300);
  {
    const all = context.pages();
    const newest = all[all.length - 1];
    if (newest !== scene1Page) {
      scene1Page = newest;
      await scene1Page.bringToFront();
      await scene1Page.waitForLoadState('domcontentloaded');
      await sleep(300);
    }
  }
  {
    const found = await waitForSubtextButton(scene1Page, 12000);
    if (found) {
      ts('Scene 1 Subtext triggered (analysis starts now)');
      await scene1Page.evaluate(() => {
        const btn = document.querySelector('.subtext-site-btn');
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    } else {
      console.warn('  Subtext button not found for scene 1.');
    }
  }

  // Analysis runs in background. Wait 22s — this covers the rest of the intro
  // voiceover (intro ends at ~37s, email opened at ~13s, so 37-13=24s needed).
  // Results arrive ~18s after click, so panel is populated before Beat 1 starts.
  console.log('  Holding during intro voiceover + analysis loading... (~22s)');
  await sleep(22000);
  await scrollSidePanel(context);

  // ── PRE-LOAD SCENE 2 in background (navigation only — NO Subtext trigger) ─────
  // CRITICAL: newPage() brings the new tab to foreground automatically.
  // Call scene1Page.bringToFront() immediately to push it back.
  // We pre-navigate so the email is ready when we switch — but analysis only fires
  // AFTER the switch so the shared side panel never shows the wrong scene's results.
  const scene2Page = await context.newPage();
  await scene1Page.bringToFront(); // push scene2Page to background
  const scene2Preloaded = (async () => {
    try {
      await scene2Page.goto(GMAIL_SEARCH_INVESTOR, { waitUntil: 'domcontentloaded' });
      await sleep(1000);
      await scene2Page.locator('tr.zA').first().waitFor({ timeout: 10000 });
      await scene2Page.locator('tr.zA').first().click();
      await sleep(1500); // let email body render
      console.log('  Scene 2 email pre-loaded (no analysis yet).');
    } catch (e) {
      console.warn('  Scene 2 pre-load error:', e.message.split('\n')[0]);
    }
  })();

  // Hold on scene 1 through Beat 1. Subtext clicked at ~t=14s. Already waited
  // 22s → now at t=36s. Beat 1 ends at t=52.1s (silence-detected) → need ~15s more (+ 1s smoothScroll).
  // Targeting scene 2 switch at video_t≈49s (5s before Beat 2 narration at 54.3s).
  console.log('  Scrolling side panel...');
  await scrollSidePanel(context);
  console.log('  Holding on scene 1 through Beat 1... (~12s, targeting t=51.5s)');
  await sleep(12000);
  await smoothScroll(scene1Page, 200, 1000);

  // ── SCENE 2: Switch then trigger Subtext ─────────────────────────────────────
  // Beat 2: 63s → 94.63s (31.63s). Bridge: 94.63s → 97s. Stay until t=97.
  ts('SCENE 2 start — switching to investor email (Beat 2)');
  await scene2Preloaded; // ensure email is open before switching
  await scene2Page.bringToFront();

  // Trigger Subtext NOW — analysis runs while voiceover sets context for Beat 2.
  // Analysis takes ~18s, completing at ~t=83s. Beat 2 has 31s so last 13s show results.
  {
    const found = await waitForSubtextButton(scene2Page, 8000);
    if (found) {
      await scene2Page.evaluate(() => {
        const btn = document.querySelector('.subtext-site-btn');
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      ts('Scene 2 Subtext triggered (analysis starts now, expect results in ~18s)');
    } else {
      // Fallback: text selection
      try {
        await selectTextAndTrigger(scene2Page, '.a3s.aiL');
        await sleep(300);
        const floatBtn = await waitForSubtextButton(scene2Page, 3000);
        if (floatBtn) await scene2Page.locator('#subtext-floating-btn').first().click();
      } catch (e) { console.warn('  Scene 2 fallback failed:', e.message.split('\n')[0]); }
    }
  }
  await sleep(500);
  await scrollSidePanel(context);

  // ── PRE-LOAD SCENE 3 in background (navigation only — NO Subtext trigger) ─────
  const scene3Page = await context.newPage();
  await scene2Page.bringToFront(); // keep scene 2 visible
  const scene3Preloaded = (async () => {
    try {
      await scene3Page.goto(JOB_POSTING_URL, { waitUntil: 'domcontentloaded' });
      await sleep(2000); // let React hydrate
      console.log('  Scene 3 DoorDash pre-loaded (no analysis yet).');
    } catch (e) {
      console.warn('  Scene 3 pre-load error:', e.message.split('\n')[0]);
    }
  })();

  // Hold scene 2 through Beat 2.
  // Silence-detected:
  //   inline break (before bridge) = 87.5s, bridge ends = 93.3s, Beat 3 = 94.9s.
  // Switch at t≈86s (during the inline break) so:
  //   - viewer sees DoorDash as "Point it at any job posting" plays (89-93s) ✓
  //   - Subtext triggers at 86s → results at ~104s → 3.9s before outro "72 percent" at 107.9s ✓
  // Hold = 86 - 49 = 37s. Minus ~1.5s overhead (scroll) = 35.5s → sleep(35500).
  console.log('  Showing scene 2... (~35.5s through Beat 2, targeting scene 3 at t≈86s)');
  await sleep(35500);
  await smoothScroll(scene2Page, 200, 1000);

  // ── SCENE 3: Switch then trigger Subtext ─────────────────────────────────────
  ts('SCENE 3 start — switching to DoorDash (Beat 3)');
  await scene3Preloaded; // ensure page is loaded before switching
  await scene3Page.bringToFront();

  // Trigger Subtext NOW — analysis streams in during Beat 3 + Outro (~58s to load and show).
  {
    const s3found = await waitForSubtextButton(scene3Page, 12000); // extra time for React hydration
    if (s3found) {
      await scene3Page.evaluate(() => {
        const btn = document.querySelector('.subtext-site-btn');
        if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      ts('Scene 3 Subtext triggered (analysis starts now)');
    } else {
      // Fallback: text selection
      try {
        await selectTextAndTrigger(scene3Page, 'main, article, [class*="content"], body');
        await sleep(500);
        const floatBtn = await waitForSubtextButton(scene3Page, 5000);
        if (floatBtn) {
          await scene3Page.evaluate(() => {
            const btn = document.getElementById('subtext-floating-btn');
            if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          });
        }
      } catch (e) { console.warn('  Scene 3 fallback failed:', e.message.split('\n')[0]); }
    }
  }
  await sleep(2000);
  await scrollSidePanel(context);
  // Beat 3 + Outro. Voiceover total = 169.27s. Scene 3 switch at ~t=86s.
  // Remaining = 169.27 - 86 = 83.27s. Minus ~4s overhead above = ~79s.
  // Add 5s buffer so recording outlasts voiceover for -shortest trim.
  console.log('  Showing DoorDash analysis... (Beat 3 + Outro = ~79s + 5s buffer)');
  await sleep(84000);
  page = scene3Page;


  // ----------------------------------------------------------------
  // Done
  // ----------------------------------------------------------------
  console.log('\nDemo sequence complete. Closing in 3s...');
  await sleep(3000);

  for (const p of context.pages()) { try { await p.close(); } catch {} }
  chromeProcess.kill();
  await sleep(2000); // give Chrome time to release file locks
  try {
    execSync(`rm -rf "${CHROME_TEMP_DATA}"`);
    console.log('Done. Temp profile cleaned up.');
  } catch {
    console.warn('Could not clean up temp profile — run: sudo rm -rf /tmp/subtext-chrome-demo');
  }

  try { fs.unlinkSync(DEMO_KEY_PATH); } catch {}
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
