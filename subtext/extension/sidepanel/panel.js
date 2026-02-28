/* ========================================
   SUBTEXT — Side Panel Logic
   ======================================== */

'use strict';

// ---- State ----
let isAnalyzing = false;
let streamBuffer = '';

// ---- DOM Refs ----
const pasteArea = document.getElementById('pasteArea');
const analyzeBtn = document.getElementById('analyzeBtn');
const loadingState = document.getElementById('loadingState');
const loadingSubtextEl = document.getElementById('loadingSubtext');
const results = document.getElementById('results');
const errorState = document.getElementById('errorState');
const errorText = document.getElementById('errorText');
const emptyState = document.getElementById('emptyState');

const categoryBadge = document.getElementById('categoryBadge');
const bsScoreNumber = document.getElementById('bsScoreNumber');
const bsScoreFill = document.getElementById('bsScoreFill');
const bsScoreCaption = document.getElementById('bsScoreCaption');
const oneLiner = document.getElementById('oneLiner');
const translationsList = document.getElementById('translationsList');
const archetypeCard = document.getElementById('archetypeCard');
const survivalContainer = document.getElementById('survivalContainer');
const cringeContainer = document.getElementById('cringeContainer');
const honestRewrite = document.getElementById('honestRewrite');
const chaoticReply = document.getElementById('chaoticReply');
const copyReplyBtn = document.getElementById('copyReplyBtn');
const resetBtn = document.getElementById('resetBtn');
const errorResetBtn = document.getElementById('errorResetBtn');

// ---- Archetype data (maps string name → description + traits) ----
const ARCHETYPE_DATA = {
  'The Reframe': {
    description: 'Bad news buried in aspirational language. The losses are a "learning experience." The layoffs are a "team evolution."',
    traits: ['Euphemism expert', 'Masters spin', 'Never admits failure'],
  },
  'The Metric Cherry-Pick': {
    description: 'Highlighting only the green numbers while quietly burying the red ones in footnote hell.',
    traits: ['Selective truth-telling', 'Data acrobatics', 'Footnote artisan'],
  },
  'The Pivot Disguise': {
    description: 'A 180° strategic reversal framed as a "natural evolution of the vision." The original vision has left the building.',
    traits: ['Reality-optional', 'Vision shapeshifter', 'Commitment phobic'],
  },
  'The Hockey Stick Tease': {
    description: 'Growth is always "just around the corner." The hockey stick has been arriving next quarter for three years.',
    traits: ['Eternal optimist', 'Forecasting hobbyist', 'Corner-turn enthusiast'],
  },
  'The Humble Brag Board': {
    description: 'Dropping advisor and investor names like they\'re life preservers. The business is secondary to the LinkedIn network.',
    traits: ['Name-dropper', 'Network as moat', 'Credibility by association'],
  },
  'The Runway Minimizer': {
    description: 'Eighteen months of runway presented as plenty of time. (Narrator: it was not plenty of time.)',
    traits: ['Optimistic accountant', 'Cash-flow illusionist', 'Timeline bender'],
  },
  'The Vision Smoke Screen': {
    description: 'TAM = $500B. Actual revenue = $12K. But the vision is compelling.',
    traits: ['Market size maximizer', 'Vision over traction', 'Narrative first'],
  },
  'The Controlled Burn': {
    description: 'They ran out of money but it was totally intentional. A planned consolidation. A strategic reduction. A choice.',
    traits: ['Retroactive planner', 'Necessity as strategy', 'Failure rebrander'],
  },
};

// ---- Loading subtext cycle ----
const LOADING_MESSAGES = [
  'Detecting corporate speak',
  'Identifying red flags',
  'Calculating BS density',
  'Cross-referencing buzzwords',
  'Decoding the subtext',
  'Preparing brutal honesty',
];
let loadingMsgIndex = 0;
let loadingInterval = null;

function startLoadingCycle() {
  loadingMsgIndex = 0;
  loadingSubtextEl.textContent = LOADING_MESSAGES[0];
  loadingInterval = setInterval(() => {
    loadingMsgIndex = (loadingMsgIndex + 1) % LOADING_MESSAGES.length;
    loadingSubtextEl.style.opacity = '0';
    setTimeout(() => {
      loadingSubtextEl.textContent = LOADING_MESSAGES[loadingMsgIndex];
      loadingSubtextEl.style.opacity = '';
    }, 300);
  }, 1800);
}

function stopLoadingCycle() {
  if (loadingInterval) {
    clearInterval(loadingInterval);
    loadingInterval = null;
  }
}

// ---- UI State Machine ----
const inputSection = document.getElementById('inputSection');

function showState(state, fromSelection) {
  emptyState.classList.add('hidden');
  loadingState.classList.add('hidden');
  results.classList.add('hidden');
  errorState.classList.add('hidden');

  if (state === 'empty') {
    emptyState.classList.remove('hidden');
    inputSection.classList.remove('hidden');
  }
  if (state === 'loading') {
    loadingState.classList.remove('hidden');
    // Hide input when triggered from selection; show when typed manually
    if (fromSelection) inputSection.classList.add('hidden');
  }
  if (state === 'results') {
    results.classList.remove('hidden');
    inputSection.classList.add('hidden');
  }
  if (state === 'error') {
    errorState.classList.remove('hidden');
    inputSection.classList.remove('hidden');
  }
}

// ---- BS Score Odometer ----
function animateBSScore(target) {
  const duration = 1400;
  const start = performance.now();

  const colorClass =
    target >= 85 ? 'nuclear' :
    target >= 65 ? 'high' :
    target >= 40 ? 'medium' : '';

  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    const current = Math.round(target * eased);

    bsScoreNumber.textContent = current;
    bsScoreFill.style.width = current + '%';

    if (p < 1) {
      requestAnimationFrame(tick);
    } else {
      bsScoreNumber.textContent = target;
      bsScoreFill.style.width = target + '%';
      bsScoreNumber.className = 'bs-score-number' + (colorClass ? ' ' + colorClass : '');
      bsScoreFill.className = 'bs-score-fill' + (colorClass ? ' ' + colorClass : '');
    }
  }

  requestAnimationFrame(tick);
}

// ---- Severity helper ----
function getSeverity(s) {
  const v = (s || '').toLowerCase();
  if (v === 'nuclear') return { label: 'NUCLEAR', cls: 'nuclear' };
  if (v === 'spicy') return { label: 'SPICY', cls: 'spicy' };
  return { label: 'MILD', cls: 'mild' };
}

// ---- Build Translations ----
function buildTranslations(translations) {
  translationsList.innerHTML = '';
  translations.forEach((item, i) => {
    const { label, cls } = getSeverity(item.severity);
    const el = document.createElement('div');
    el.className = 'translation-item';
    el.innerHTML =
      '<div class="translation-original">' + escapeHtml(item.original) + '</div>' +
      '<div class="translation-decoded">' + escapeHtml(item.decoded) + '</div>' +
      '<div class="translation-severity severity-' + cls + '">' +
        '<span class="severity-dot"></span>' + label +
      '</div>';
    translationsList.appendChild(el);
    setTimeout(() => el.classList.add('bounce-in'), i * 130);
  });
}

// ---- Build Archetype Card ----
function buildArchetype(archetypeName) {
  if (!archetypeName) return;
  const section = document.getElementById('sectionArchetype');
  section.classList.remove('hidden');

  const data = ARCHETYPE_DATA[archetypeName] || {
    description: 'A classic corporate communication pattern.',
    traits: [],
  };

  archetypeCard.innerHTML =
    '<div class="archetype-name">' + escapeHtml(archetypeName) + '</div>' +
    '<div class="archetype-description">' + escapeHtml(data.description) + '</div>' +
    (data.traits.length ?
      '<div class="archetype-traits">' +
        data.traits.map(t => '<span class="archetype-trait">' + escapeHtml(t) + '</span>').join('') +
      '</div>'
    : '');
}

// ---- Build Survival Bar ----
function buildSurvival(pct) {
  if (pct === undefined || pct === null) return;
  const section = document.getElementById('sectionSurvival');
  section.classList.remove('hidden');

  const color =
    pct <= 20 ? '#ff3b3b' :
    pct <= 50 ? '#ffc857' : '#4ade80';

  const verdicts = [
    [0, 10, "Run. Do not walk."],
    [10, 25, "This job will require therapy."],
    [25, 40, "Survivable, barely."],
    [40, 60, "You'll need strong coffee and stronger boundaries."],
    [60, 80, "Decent odds if you don't read the Glassdoor reviews."],
    [80, 101, "Could be worse. Probably."],
  ];
  const verdict = verdicts.find(([lo, hi]) => pct >= lo && pct < hi)?.[2] || '';

  survivalContainer.innerHTML =
    '<div class="survival-percent" style="color:' + color + '">' + pct + '%</div>' +
    '<div class="survival-bar-track">' +
      '<div class="survival-bar-fill" id="survivalFill" style="background:' + color + '"></div>' +
    '</div>' +
    '<div class="survival-verdict">' + escapeHtml(verdict) + '</div>';

  requestAnimationFrame(() => {
    setTimeout(() => {
      const fill = document.getElementById('survivalFill');
      if (fill) fill.style.width = pct + '%';
    }, 400);
  });
}

// ---- Build Cringe Score ----
function buildCringe(score) {
  if (score === undefined || score === null) return;
  const section = document.getElementById('sectionCringe');
  section.classList.remove('hidden');

  const level = Math.min(Math.round(score / 20), 5);
  const labels = ['Tolerable', 'Eyebrow-raising', 'Cringe', 'Very Cringe', 'Peak Cringe', 'Unspeakable'];
  const label = labels[level];

  const verdictMap = {
    0: "Shockingly readable.",
    1: "Your LinkedIn could be worse.",
    2: "The thought leadership is showing.",
    3: "Felt secondhand embarrassment reading this.",
    4: "Should have been an email. Or a thought. Or nothing.",
    5: "Delete it. Delete the whole account.",
  };

  let barsHtml = '';
  for (let i = 0; i < 5; i++) {
    barsHtml += '<div class="cringe-bar"></div>';
  }

  cringeContainer.innerHTML =
    '<div class="cringe-score-row">' +
      '<span class="cringe-number">' + score + '</span>' +
      '<span class="cringe-label">' + escapeHtml(label) + '</span>' +
    '</div>' +
    '<div class="cringe-bars">' + barsHtml + '</div>' +
    '<div class="cringe-verdict">' + escapeHtml(verdictMap[level] || '') + '</div>';

  const barEls = cringeContainer.querySelectorAll('.cringe-bar');
  barEls.forEach((el, i) => {
    setTimeout(() => {
      if (i < level) el.classList.add('active');
    }, 200 + i * 100);
  });
}

// ---- Render Full Analysis ----
function renderAnalysis(data) {
  stopLoadingCycle();

  // Reset optional sections
  document.getElementById('sectionArchetype').classList.add('hidden');
  document.getElementById('sectionSurvival').classList.add('hidden');
  document.getElementById('sectionCringe').classList.add('hidden');

  // Reset anim states
  document.querySelectorAll('.anim-item').forEach(el => el.classList.remove('visible'));

  // 1. Category badge
  const categoryLabels = {
    'investor-email': 'INVESTOR EMAIL',
    'job-posting': 'JOB POSTING',
    'linkedin-post': 'LINKEDIN POST',
    'performance-review': 'PERFORMANCE REVIEW',
    'other': 'CORPORATE SPEAK',
  };
  categoryBadge.textContent = categoryLabels[data.category] || (data.category || 'UNKNOWN').toUpperCase();
  categoryBadge.classList.add('loaded');

  // 2. BS Score
  bsScoreNumber.className = 'bs-score-number';
  bsScoreFill.className = 'bs-score-fill';
  bsScoreNumber.textContent = '0';
  bsScoreFill.style.width = '0%';
  animateBSScore(data.bs_score || 0);

  bsScoreCaption.textContent =
    data.bs_score >= 85 ? "Impressive. This is almost entirely air." :
    data.bs_score >= 65 ? "Significant buzzword density. Handle with skepticism." :
    data.bs_score >= 40 ? "Some clarity buried in there, if you look hard enough." :
    "Relatively honest. For corporate writing.";

  // 3. One-liner
  oneLiner.textContent = data.one_liner || '';

  // 4. Translations
  if (data.translations && data.translations.length) {
    buildTranslations(data.translations);
  }

  // 5. Category-specific
  if (data.category === 'investor-email' && data.archetype) {
    buildArchetype(data.archetype);
  }
  if (data.category === 'job-posting' && data.survival_probability !== undefined) {
    buildSurvival(data.survival_probability);
  }
  if (data.category === 'linkedin-post' && data.cringe_score !== undefined) {
    buildCringe(data.cringe_score);
  }

  // 6. Honest rewrite
  honestRewrite.textContent = data.honest_rewrite || '';

  // 7. Reply (field name in schema is "the_reply_you_want")
  chaoticReply.textContent = data.the_reply_you_want || '';

  // Show results
  showState('results');

  // Trigger stagger animations
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.anim-item:not(.hidden)').forEach(el => {
        el.classList.add('visible');
      });
    });
  });
}

// ---- HTML Escape ----
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Copy Reply ----
copyReplyBtn.addEventListener('click', () => {
  const text = chaoticReply.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const lbl = copyReplyBtn.querySelector('span:first-child');
    const chk = copyReplyBtn.querySelector('.copy-check');
    lbl.classList.add('hidden');
    chk.classList.remove('hidden');
    setTimeout(() => {
      lbl.classList.remove('hidden');
      chk.classList.add('hidden');
    }, 2000);
  });
});

// ---- Reset ----
function doReset() {
  isAnalyzing = false;
  analyzeBtn.disabled = false;
  streamBuffer = '';
  stopLoadingCycle();
  document.querySelectorAll('.anim-item').forEach(el => el.classList.remove('visible'));
  categoryBadge.classList.remove('loaded');
  bsScoreNumber.textContent = '0';
  bsScoreFill.style.width = '0%';
  pasteArea.value = '';
  inputSection.classList.remove('hidden');
  showState('empty');
}

resetBtn.addEventListener('click', doReset);
errorResetBtn.addEventListener('click', doReset);

// ---- Analyze Button ----
analyzeBtn.addEventListener('click', () => {
  const text = pasteArea.value.trim();
  if (!text || isAnalyzing) return;
  triggerAnalysis(text);
});

pasteArea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const text = pasteArea.value.trim();
    if (text && !isAnalyzing) triggerAnalysis(text);
  }
});

function triggerAnalysis(text) {
  isAnalyzing = true;
  analyzeBtn.disabled = true;
  streamBuffer = '';
  showState('loading');
  startLoadingCycle();

  chrome.runtime.sendMessage({ type: 'ANALYZE_TEXT', text }, (response) => {
    if (chrome.runtime.lastError) {
      // Background will stream results back via onMessage — this just kicks it off
      // If there's a lastError here, it's a real problem
      stopLoadingCycle();
      isAnalyzing = false;
      analyzeBtn.disabled = false;
      errorText.textContent = chrome.runtime.lastError.message || 'Could not reach background.';
      showState('error');
    }
    // Success means analysis is in flight — results come via onMessage
  });
}

// ---- Message listener from background (streaming + results) ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ANALYSIS_START: side panel triggered from selection button
  if (message.type === 'ANALYSIS_START') {
    isAnalyzing = true;
    analyzeBtn.disabled = true;
    streamBuffer = '';
    showState('loading', true); // fromSelection=true → hides input area

    // Prefill the textarea (hidden but useful for reset)
    if (message.text) pasteArea.value = message.text;

    sendResponse({ ok: true });
    return true;
  }

  // STREAM_DELTA: partial JSON coming in (for visual feedback during streaming)
  if (message.type === 'STREAM_DELTA') {
    streamBuffer += (message.delta || '');
    // Update loading subtext with byte count as progress hint
    const chars = streamBuffer.length;
    if (chars > 50 && loadingSubtextEl) {
      loadingSubtextEl.textContent = 'Decoding... (' + chars + ' chars)';
    }
    sendResponse({ ok: true });
    return true;
  }

  // ANALYSIS_COMPLETE: full parsed result ready
  if (message.type === 'ANALYSIS_COMPLETE') {
    isAnalyzing = false;
    analyzeBtn.disabled = false;
    try {
      renderAnalysis(message.result);
    } catch (err) {
      stopLoadingCycle();
      errorText.textContent = 'Render error: ' + err.message;
      showState('error');
    }
    sendResponse({ ok: true });
    return true;
  }

  // ERROR
  if (message.type === 'ERROR') {
    isAnalyzing = false;
    analyzeBtn.disabled = false;
    stopLoadingCycle();
    errorText.textContent = message.error || 'Something went wrong.';
    showState('error');
    sendResponse({ ok: true });
    return true;
  }

  // NO_API_KEY
  if (message.type === 'NO_API_KEY') {
    isAnalyzing = false;
    analyzeBtn.disabled = false;
    stopLoadingCycle();
    errorText.textContent = 'No API key found. Click the ✦ Subtext icon in your toolbar and set up your Anthropic API key.';
    showState('error');
    sendResponse({ ok: true });
    return true;
  }

  // INVALID_API_KEY
  if (message.type === 'INVALID_API_KEY') {
    isAnalyzing = false;
    analyzeBtn.disabled = false;
    stopLoadingCycle();
    errorText.textContent = 'Invalid API key. Check your Anthropic key in Settings.';
    showState('error');
    sendResponse({ ok: true });
    return true;
  }

  // SET_TEXT (utility: prefill textarea from content script)
  if (message.type === 'SET_TEXT') {
    pasteArea.value = message.text || '';
    sendResponse({ ok: true });
    return true;
  }

  return true;
});

// ---- Init ----
showState('empty');
