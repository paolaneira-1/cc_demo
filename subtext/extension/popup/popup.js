/* ========================================
   SUBTEXT — Popup Logic
   ======================================== */

'use strict';

const stateNoKey = document.getElementById('stateNoKey');
const stateReady = document.getElementById('stateReady');
const goToOptions = document.getElementById('goToOptions');
const openPanel = document.getElementById('openPanel');
const footerSettings = document.getElementById('footerSettings');

// Check if API key exists in storage.sync (matches service-worker.js)
chrome.storage.sync.get('apiKey', ({ apiKey }) => {
  if (apiKey && apiKey.trim()) {
    stateNoKey.classList.add('hidden');
    stateReady.classList.remove('hidden');
  } else {
    stateNoKey.classList.remove('hidden');
    stateReady.classList.add('hidden');
  }
});

goToOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

openPanel.addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.sidePanel.open({ tabId: tabs[0].id });
    }
  });
  window.close();
});

footerSettings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
