'use strict';

/**
 * app.js — application shell: top navigation + view switching.
 *
 * No router library; views are plain functions that render into the #view
 * container. Settings is a placeholder until Phase 5.
 */

import { renderDepositForm } from './deposit-form.js';
import { renderCalibration } from './calibration.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { initUpdateBanner } from './update-banner.js';

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

/** Switch to a top-level view by id. */
export function navigate(id) {
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
