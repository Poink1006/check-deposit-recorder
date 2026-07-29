'use strict';
// Verify the simplified slip-style entry: fill cells by section+line, check live
// totals, save through IPC, read back. Not shipped. Run: npx electron reference/uitest6.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();
const results = [];
const check = (n, c) => { results.push(c); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-p6-'));
  db.init(dir);
  ipcMain.handle('settings:getDefaults', () => db.getDefaults());
  ipcMain.handle('settings:getCalibration', () => db.getCalibration());
  ipcMain.handle('db:createDeposit', (_e, h, i) => db.createDeposit(h, i));
  ipcMain.handle('db:updateDeposit', (_e, id, h, i) => db.updateDeposit(id, h, i));
  ipcMain.handle('db:getDeposit', (_e, id) => db.getDeposit(id));
  ipcMain.handle('db:listDeposits', (_e, f) => db.listDeposits(f));

  const win = new BrowserWindow({
    width: 1200, height: 900, useContentSize: true, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 500));

  const totals = await win.webContents.executeJavaScript(`(() => {
    const set = (sec, line, val) => {
      const el = document.querySelector('.amount-input[data-section="'+sec+'"][data-line="'+line+'"]');
      el.value = val; el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('CASH', 1, '2000'); set('CASH', 13, '126000');
    set('CHECK', 1, '183313.41'); set('CHECK', 15, '94848.36');
    return {
      onlyDateField: document.querySelectorAll('.field-grid .field').length === 1 && !document.querySelector('#f-bank'),
      cash: document.getElementById('bar-cash').textContent,
      check: document.getElementById('bar-check').textContent,
      grand: document.getElementById('bar-grand').textContent,
      cashInputs: document.querySelectorAll('.amount-input[data-section="CASH"]').length,
      checkInputs: document.querySelectorAll('.amount-input[data-section="CHECK"]').length,
      hasCheckNo: !!document.querySelector('.ck-no'),
      innerH: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
    };
  })()`);
  console.log('FIT innerHeight=' + totals.innerH + ' scrollHeight=' + totals.scrollH);
  check('fits on one screen (no scroll @1200x900)', totals.scrollH <= totals.innerH + 2);
  console.log('TOTALS', totals.cash, '|', totals.check, '|', totals.grand);
  check('header trimmed to date only', totals.onlyDateField === true);
  check('24 cash + 24 check cells', totals.cashInputs === 24 && totals.checkInputs === 24);
  check('no check-detail fields', totals.hasCheckNo === false);
  check('live totals correct', totals.cash === '₱ 128,000.00' && totals.check === '₱ 278,161.77' && totals.grand === '₱ 406,161.77');

  // paint + screenshot
  await win.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await new Promise((r) => setTimeout(r, 250));
  fs.writeFileSync(path.join(__dirname, 'slip-entry.png'), (await win.webContents.capturePage()).toPNG());
  console.log('Screenshot: slip-entry.png');

  // save + read back
  await win.webContents.executeJavaScript(`(async () => { document.getElementById('btn-save').click(); await new Promise(r=>setTimeout(r,400)); })()`);
  const rows = db.listDeposits();
  const saved = rows[0] ? db.getDeposit(rows[0].id) : null;
  check('saved with correct totals', saved && saved.cash_total === 128000 && saved.check_total === 278161.77 && saved.grand_total === 406161.77);
  check('saved 4 items, correct sections/lines', saved && saved.items.length === 4 &&
    saved.items.some((i) => i.section === 'CASH' && i.line_no === 13 && i.amount === 126000) &&
    saved.items.some((i) => i.section === 'CHECK' && i.line_no === 15 && i.amount === 94848.36));

  const pass = results.every(Boolean);
  console.log(pass ? 'SLIP ENTRY TEST PASSED' : 'SLIP ENTRY TEST FAILED');
  app.exit(pass ? 0 : 1);
});
