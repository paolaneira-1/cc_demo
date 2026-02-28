// Subtext - Content Script / Detector
// Detects selected text and site-specific corporate content

(function () {
  "use strict";

  // Guard against double-injection
  if (window.__subtextDetectorLoaded) return;
  window.__subtextDetectorLoaded = true;

  // ─── Constants ──────────────────────────────────────────────────────────────

  const MIN_SELECTION_LENGTH = 50;
  const BUTTON_ID = "subtext-floating-btn";
  const SITE_BUTTON_CLASS = "subtext-site-btn";

  // ─── State ──────────────────────────────────────────────────────────────────

  let currentButton = null;
  let selectionText = "";

  // ─── Floating Button Styles (injected once) ──────────────────────────────────

  function injectStyles() {
    if (document.getElementById("subtext-styles")) return;

    const style = document.createElement("style");
    style.id = "subtext-styles";
    style.textContent = `
      #subtext-floating-btn,
      .subtext-site-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 11px;
        background: #0f0f0f;
        color: #f5f0e8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.02em;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08);
        z-index: 2147483647;
        transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.15s ease;
        white-space: nowrap;
        user-select: none;
        -webkit-user-select: none;
      }
      #subtext-floating-btn {
        position: fixed;
      }
      .subtext-site-btn {
        position: relative;
        margin: 6px 0 0 0;
      }
      #subtext-floating-btn:hover,
      .subtext-site-btn:hover {
        background: #1a1a1a;
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.12);
      }
      #subtext-floating-btn:active,
      .subtext-site-btn:active {
        transform: translateY(0px);
      }
      #subtext-floating-btn .subtext-star,
      .subtext-site-btn .subtext-star {
        font-size: 10px;
        opacity: 0.9;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Floating Button ─────────────────────────────────────────────────────────

  function createFloatingButton(x, y) {
    removeFloatingButton();

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.innerHTML = '<span class="subtext-star">✦</span> Subtext';
    btn.setAttribute("aria-label", "Translate selected text with Subtext");

    // Position near selection — prefer showing above the selection end point
    // Clamp to viewport so button doesn't go offscreen
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const btnW = 120; // approximate
    const btnH = 34;

    let left = Math.min(x, viewportW - btnW - 12);
    let top = y - btnH - 10;

    // If too close to top, show below instead
    if (top < 8) top = y + 20;

    btn.style.left = Math.max(8, left) + "px";
    btn.style.top = Math.max(8, top) + "px";

    btn.addEventListener("click", handleButtonClick);
    // Prevent the document mousedown from removing the button when clicking it
    btn.addEventListener("mousedown", (e) => e.stopPropagation());

    document.body.appendChild(btn);
    currentButton = btn;
  }

  function removeFloatingButton() {
    if (currentButton) {
      currentButton.removeEventListener("click", handleButtonClick);
      currentButton.remove();
      currentButton = null;
    }
    const stale = document.getElementById(BUTTON_ID);
    if (stale) stale.remove();
  }

  function handleButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const textToAnalyze = selectionText.trim();
    if (!textToAnalyze || textToAnalyze.length < 10) return;

    removeFloatingButton();
    sendForAnalysis(textToAnalyze);
  }

  // ─── Send Text to Background ─────────────────────────────────────────────────

  function sendForAnalysis(text) {
    chrome.runtime.sendMessage({ type: "ANALYZE_TEXT", text }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Subtext] Could not contact background:", chrome.runtime.lastError.message);
        return;
      }
    });

    // Also request the side panel to open
    chrome.runtime.sendMessage({ type: "OPEN_PANEL" }, (response) => {
      if (chrome.runtime.lastError) {
        // Side panel messaging errors are non-fatal; background already handles it
      }
    });
  }

  // ─── Text Selection Detection ─────────────────────────────────────────────────

  document.addEventListener("mouseup", (e) => {
    // Don't trigger on our own button
    if (e.target && e.target.id === BUTTON_ID) return;
    if (e.target && e.target.classList.contains(SITE_BUTTON_CLASS)) return;

    // Small timeout so the browser finalizes the selection
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection) return;

      const text = selection.toString().trim();

      if (text.length >= MIN_SELECTION_LENGTH) {
        selectionText = text;
        // Position button near the mouse cursor (end of selection)
        createFloatingButton(e.clientX, e.clientY);
      } else {
        selectionText = "";
        removeFloatingButton();
      }
    }, 10);
  });

  // Remove button when clicking anywhere else (not on the button)
  document.addEventListener("mousedown", (e) => {
    if (e.target && e.target.id === BUTTON_ID) return;
    if (e.target && e.target.classList.contains(SITE_BUTTON_CLASS)) return;
    removeFloatingButton();
  });

  // Remove button on scroll (selection may shift)
  document.addEventListener("scroll", removeFloatingButton, { passive: true });

  // Remove button on keydown (user might be editing)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") removeFloatingButton();
  });

  // ─── Context Menu Click from Background ──────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CONTEXT_MENU_ANALYZE") {
      const text = (message.text || "").trim();
      if (text.length >= 10) {
        selectionText = text;
        sendForAnalysis(text);
      }
    }
  });

  // ─── Site-Specific Detection ──────────────────────────────────────────────────

  const hostname = window.location.hostname;

  // Run site detection after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runSiteDetection);
  } else {
    runSiteDetection();
  }

  // Re-run on navigation (SPAs)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    scheduleRedetection();
  };
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    scheduleRedetection();
  };
  window.addEventListener("popstate", scheduleRedetection);

  let redetectTimer = null;
  function scheduleRedetection() {
    clearTimeout(redetectTimer);
    redetectTimer = setTimeout(runSiteDetection, 1200);
  }

  function runSiteDetection() {
    // Remove any stale site buttons from previous detection
    document.querySelectorAll(`.${SITE_BUTTON_CLASS}`).forEach((el) => el.remove());

    if (isGmail()) {
      detectGmail();
    } else if (isLinkedIn()) {
      detectLinkedIn();
    } else if (isJobBoard()) {
      detectJobBoard();
    }
  }

  // ─── Host Detectors ───────────────────────────────────────────────────────────

  function isGmail() {
    return hostname === "mail.google.com";
  }

  function isLinkedIn() {
    return hostname.includes("linkedin.com");
  }

  function isJobBoard() {
    return (
      hostname.includes("greenhouse.io") ||
      hostname.includes("lever.co") ||
      hostname.includes("workable.com") ||
      hostname.includes("jobs.ashbyhq.com") ||
      hostname.includes("boards.greenhouse.io") ||
      hostname.includes("jobs.lever.co")
    );
  }

  // ─── Gmail Detection ─────────────────────────────────────────────────────────

  function detectGmail() {
    // Gmail uses dynamic classes; target by role/aria attributes
    const emailBodies = document.querySelectorAll('[data-message-id] .a3s.aiL, [data-legacy-message-id] .a3s');
    if (emailBodies.length === 0) {
      // Retry: Gmail loads email content dynamically
      observeMutations(".adn", detectGmail, 8000);
      return;
    }

    emailBodies.forEach((emailEl) => {
      // Avoid adding duplicate buttons
      if (emailEl.parentElement.querySelector(`.${SITE_BUTTON_CLASS}`)) return;

      const text = emailEl.innerText.trim();
      if (text.length < MIN_SELECTION_LENGTH) return;

      const btn = createSiteButton("Subtext this email");
      btn.dataset.subtextText = text;
      btn.addEventListener("click", handleSiteButtonClick);

      // Insert before the email body
      emailEl.parentElement.insertBefore(btn, emailEl);
    });
  }

  // ─── LinkedIn Detection ──────────────────────────────────────────────────────

  function detectLinkedIn() {
    // Feed posts
    const posts = document.querySelectorAll(
      '.feed-shared-update-v2__description, .feed-shared-text__text-view, ' +
      '.update-components-text, .attributed-text-segment-list__content'
    );

    posts.forEach((postEl) => {
      // Walk up to find the post container
      const container = postEl.closest('.feed-shared-update-v2') ||
                        postEl.closest('.occludable-update') ||
                        postEl.parentElement;

      if (!container) return;
      if (container.querySelector(`.${SITE_BUTTON_CLASS}`)) return;

      const text = postEl.innerText.trim();
      if (text.length < MIN_SELECTION_LENGTH) return;

      const btn = createSiteButton("Subtext this post");
      btn.dataset.subtextText = text;
      btn.addEventListener("click", handleSiteButtonClick);

      // Insert after the post text element
      postEl.insertAdjacentElement("afterend", btn);
    });

    // Job description page
    const jobDesc = document.querySelector('.jobs-description__content, .jobs-box__html-content');
    if (jobDesc && !jobDesc.parentElement.querySelector(`.${SITE_BUTTON_CLASS}`)) {
      const text = jobDesc.innerText.trim();
      if (text.length >= MIN_SELECTION_LENGTH) {
        const btn = createSiteButton("Subtext this job posting");
        btn.dataset.subtextText = text;
        btn.addEventListener("click", handleSiteButtonClick);
        jobDesc.insertAdjacentElement("afterend", btn);
      }
    }

    // If nothing found yet, observe for dynamic content
    if (posts.length === 0 && !document.querySelector(`.${SITE_BUTTON_CLASS}`)) {
      observeMutations(".scaffold-layout__main, main", detectLinkedIn, 10000);
    }
  }

  // ─── Job Board Detection ─────────────────────────────────────────────────────

  function detectJobBoard() {
    const selectors = [
      // Greenhouse
      "#content .job-post, #app_body, .job-post-description",
      // Lever
      ".section-wrapper, .posting-description, .main-content",
      // Workable
      ".job-description, [class*='job-description'], [data-ui='job-description']",
      // Ashby
      ".ashby-job-posting-brief-description, [class*='jobPostingDescription']",
    ];

    let found = false;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && !el.parentElement.querySelector(`.${SITE_BUTTON_CLASS}`)) {
        const text = el.innerText.trim();
        if (text.length >= MIN_SELECTION_LENGTH) {
          const btn = createSiteButton("Subtext this job posting");
          btn.dataset.subtextText = text;
          btn.addEventListener("click", handleSiteButtonClick);
          el.insertAdjacentElement("afterend", btn);
          found = true;
          break;
        }
      }
    }

    if (!found) {
      observeMutations("main, #app, #content, body", detectJobBoard, 8000);
    }
  }

  // ─── Site Button Helpers ─────────────────────────────────────────────────────

  function createSiteButton(label) {
    const btn = document.createElement("button");
    btn.className = SITE_BUTTON_CLASS;
    btn.innerHTML = `<span class="subtext-star">✦</span> ${label}`;
    btn.setAttribute("aria-label", label);
    return btn;
  }

  function handleSiteButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const text = (e.currentTarget.dataset.subtextText || "").trim();
    if (!text || text.length < 10) return;

    sendForAnalysis(text);
  }

  // ─── Mutation Observer Helper ─────────────────────────────────────────────────

  /**
   * Observe a container for DOM changes and re-run the detector callback.
   * Auto-disconnects after maxWait ms to avoid leaks.
   */
  function observeMutations(containerSelector, callback, maxWait = 8000) {
    const container = document.querySelector(containerSelector) || document.body;
    let disconnected = false;

    const observer = new MutationObserver(() => {
      if (disconnected) return;
      // Debounce: wait a tick before re-running
      clearTimeout(observer._debounce);
      observer._debounce = setTimeout(() => {
        if (!disconnected) callback();
      }, 400);
    });

    observer.observe(container, { childList: true, subtree: true });

    // Auto-disconnect after maxWait
    setTimeout(() => {
      disconnected = true;
      observer.disconnect();
    }, maxWait);
  }

  // ─── Bootstrap ───────────────────────────────────────────────────────────────

  injectStyles();

})();
