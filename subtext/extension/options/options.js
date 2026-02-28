/* ========================================
   SUBTEXT — Options Page Logic
   ======================================== */

'use strict';

const apiKeyInput = document.getElementById('apiKeyInput');
const showHideBtn = document.getElementById('showHideBtn');
const eyeShow = document.getElementById('eyeShow');
const eyeHide = document.getElementById('eyeHide');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusMsg = document.getElementById('statusMsg');
const keyStatus = document.getElementById('keyStatus');
const getKeyLink = document.getElementById('getKeyLink');

// ---- Show/Hide Toggle ----
let isVisible = false;

showHideBtn.addEventListener('click', () => {
  isVisible = !isVisible;
  apiKeyInput.type = isVisible ? 'text' : 'password';
  eyeShow.classList.toggle('hidden', isVisible);
  eyeHide.classList.toggle('hidden', !isVisible);
});

// ---- Load existing key ----
// NOTE: storage.sync matches what the service worker uses
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey && apiKey.trim()) {
    apiKeyInput.value = apiKey;
    updateKeyStatus(true);
    clearBtn.classList.remove('hidden');
  } else {
    updateKeyStatus(false);
  }
});

// ---- Save ----
saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showStatus('Please enter an API key.', 'error');
    return;
  }

  if (!key.startsWith('sk-ant-')) {
    showStatus("That doesn't look like an Anthropic key. It should start with sk-ant-", 'error');
    return;
  }

  chrome.storage.sync.set({ apiKey: key }, () => {
    if (chrome.runtime.lastError) {
      showStatus('Failed to save: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    showStatus("API key saved. You're ready to translate some corporate nonsense.", 'success');
    updateKeyStatus(true);
    clearBtn.classList.remove('hidden');
  });
});

// ---- Clear ----
clearBtn.addEventListener('click', () => {
  if (!confirm("Remove your API key? You'll need to re-enter it to use Subtext.")) return;

  chrome.storage.sync.remove('apiKey', () => {
    apiKeyInput.value = '';
    updateKeyStatus(false);
    clearBtn.classList.add('hidden');
    showStatus('API key removed.', 'success');
  });
});

// ---- Status display ----
let statusTimeout = null;

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg ' + type;
  statusMsg.classList.remove('hidden');

  if (statusTimeout) clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    statusMsg.classList.add('hidden');
  }, 4500);
}

function updateKeyStatus(hasKey) {
  if (hasKey) {
    keyStatus.textContent = '✓ API key saved';
    keyStatus.className = 'key-status has-key';
  } else {
    keyStatus.textContent = 'No API key saved';
    keyStatus.className = 'key-status no-key';
  }
}

// ---- Open link in new tab (options page CSP restriction) ----
getKeyLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://console.anthropic.com/account/keys' });
});

// ---- Enter to save ----
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});
