'use strict';

/**
 * app.js — application shell: top navigation + view switching.
 *
 * No router library; views are plain functions that render into the #view
 * container. Settings is a placeholder until Phase 5.
 */

import { renderDepositForm, depositHasUnsavedChanges } from './deposit-form.js';
import { renderCalibration } from './calibration.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { initUpdateBanner } from './update-banner.js';
import { initSyncStatus } from './sync-status.js';
import { showLoginGate } from './login.js';

const view = document.getElementById('view');

const NAV = [
  { id: 'new', label: 'New Deposit' },
  { id: 'history', label: 'History' },
  { id: 'calibration', label: 'Calibration' },
  { id: 'settings', label: 'Settings' },
];

function setActiveNav(id) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === id);
  });
}

let currentView = 'new';

/** True while the deposit form is open with unsaved amount edits. */
function unsavedDeposit() {
  return currentView === 'new' && depositHasUnsavedChanges();
}

/** Switch to a top-level view by id. */
export function navigate(id) {
  // Warn before leaving a deposit with unsaved changes.
  if (id !== 'new' && unsavedDeposit()) {
    if (!confirm('You have unsaved changes on this deposit.\nLeave without saving?')) {
      setActiveNav('new'); // keep the highlight on New Deposit
      return;
    }
  }
  currentView = id;
  setActiveNav(id);
  if (id === 'new') {
    renderDepositForm(view);
  } else if (id === 'history') {
    renderHistory(view);
  } else if (id === 'calibration') {
    renderCalibration(view);
  } else if (id === 'settings') {
    renderSettings(view);
  }
}

/** Open the deposit form in edit mode for an existing deposit (from History). */
export function editDeposit(deposit) {
  setActiveNav('new');
  renderDepositForm(view, { deposit });
}

// Build the nav bar.
const nav = document.getElementById('nav');
NAV.forEach((item) => {
  const btn = document.createElement('button');
  btn.className = 'nav-btn';
  btn.dataset.view = item.id;
  btn.textContent = item.label;
  btn.addEventListener('click', () => navigate(item.id));
  nav.appendChild(btn);
});

// Start on the New Deposit screen.
navigate('new');

// Wire the auto-update banner (no-op in unpacked/dev builds).
initUpdateBanner();

// Warn before closing the app with unsaved deposit changes. Electron cancels
// the close when beforeunload sets returnValue; we then ask, and re-close if
// the user confirms (forceClose bypasses the guard the second time).
let forceClose = false;
window.addEventListener('beforeunload', (e) => {
  if (forceClose || !unsavedDeposit()) return;
  e.returnValue = false; // cancel this close
  setTimeout(() => {
    if (confirm('You have unsaved changes on this deposit.\nClose without saving?')) {
      forceClose = true;
      window.close();
    }
  }, 0);
});

// Sync status badge, and refresh the History list when a pull brings new data.
initSyncStatus();
if (window.api.onSyncChanged) {
  window.api.onSyncChanged(() => { if (currentView === 'history') navigate('history'); });
}

// Require the shared-account login on first run; the session is remembered
// afterwards. Signing out (from Settings) brings the gate back.
if (window.api.authStatus) {
  window.api.authStatus().then((st) => { if (!st.signedIn) showLoginGate(() => navigate(currentView)); });
  window.api.onSignedOut(() => showLoginGate(() => navigate(currentView)));
}

// Show the running app version in the header (handy for confirming updates).
if (window.api.getVersion) {
  window.api.getVersion().then((v) => {
    if (!v) return;
    const tag = document.createElement('span');
    tag.className = 'version-tag';
    tag.textContent = 'v' + v;
    document.querySelector('.app-header').appendChild(tag);
  });
}
