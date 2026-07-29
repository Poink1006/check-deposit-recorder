'use strict';
// Verify: (1) print preview has no overlay toggle (full form only),
// (3) arrow up/down move between cells without changing the value.
// Not shipped. Run: npx electron reference/uitest7.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();
const results = [];
const check = (n, c) => { results.push(c); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };

app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(), 'p7-')));
  ipcMain.handle('settings:getDefaults', () => db.getDefaults());
  ipcMain.handle('settings:getCalibration', () => db.getCalibration());

  const win = new BrowserWindow({
    width: 1200, height: 900, useContentSize: true, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  // --- (3) arrow-key navigation ---
  const nav = await win.webContents.executeJavaScript(`(() => {
    const at = (sec, line) => document.querySelector('.amount-input[data-section="'+sec+'"][data-line="'+line+'"]');
    const c1 = at('CASH', 1);
    c1.value = '5'; c1.focus();
    c1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    const afterDown = document.activeElement;
    const downRes = { sec: afterDown.dataset.section, line: afterDown.dataset.line, c1val: c1.value };
    // now arrow back up
    afterDown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    const afterUp = document.activeElement;
    return { downRes, up: { sec: afterUp.dataset.section, line: afterUp.dataset.line } };
  })()`);
  check('ArrowDown moves CASH #1 -> CASH #2 (same column)', nav.downRes.sec === 'CASH' && nav.downRes.line === '2');
  check('ArrowDown did NOT change the value', nav.downRes.c1val === '5');
  check('ArrowUp moves back to CASH #1', nav.up.sec === 'CASH' && nav.up.line === '1');

  // --- (1) print preview: full form only, no overlay toggle ---
  const prev = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('.amount-input[data-section="CASH"][data-line="1"]').value = '100';
    document.getElementById('btn-print').click();
    await new Promise(r => setTimeout(r, 300));
    const frame = document.querySelector('.preview-frame');
    const src = frame ? frame.getAttribute('srcdoc') : '';
    return {
      modalOpen: !!document.querySelector('.modal-backdrop'),
      tabCount: document.querySelectorAll('.tab-toggle .tab').length,
      mentionsOverlay: /overlay/i.test(document.querySelector('.modal-hint').textContent),
      isFullForm: src.includes('class="hline"') && src.includes('class="glabel"'),
    };
  })()`);
  check('print preview opens', prev.modalOpen);
  check('no overlay/full toggle present', prev.tabCount === 0 && prev.mentionsOverlay === false);
  check('preview renders the full form (grid + labels)', prev.isFullForm);

  const pass = results.every(Boolean);
  console.log(pass ? 'UITEST7 PASSED' : 'UITEST7 FAILED');
  app.exit(pass ? 0 : 1);
});
