'use strict';
// End-to-end Phase 2 check under real Electron: load the renderer, type amounts,
// read the live totals, click Save (real IPC -> temp DB), verify persistence,
// and capture a screenshot. Not shipped. Run: npx electron reference/uitest.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-ui-'));
  db.init(dir);

  // Same handlers the real main.js registers (the ones this test exercises).
  ipcMain.handle('db:getPath', () => db.getDbPath());
  ipcMain.handle('db:createDeposit', (_e, h, i) => db.createDeposit(h, i));
  ipcMain.handle('db:updateDeposit', (_e, id, h, i) => db.updateDeposit(id, h, i));
  ipcMain.handle('db:getDeposit', (_e, id) => db.getDeposit(id));
  ipcMain.handle('db:listDeposits', () => db.listDeposits());

  const win = new BrowserWindow({
    width: 1200, height: 900, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400)); // let the module render

  // 1) Type amounts and read live totals.
  const totals = await win.webContents.executeJavaScript(`(() => {
    const setAmt = (body, idx, val) => {
      const inp = document.querySelectorAll('#' + body + ' .amount-input')[idx];
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setAmt('cash-rows', 0, '1500.50');
    setAmt('cash-rows', 1, '2500');
    setAmt('check-rows', 0, '25396.75');
    document.querySelector('#f-ref').value = 'UITEST';
    return {
      cash: document.getElementById('bar-cash').textContent,
      check: document.getElementById('bar-check').textContent,
      grand: document.getElementById('bar-grand').textContent,
    };
  })()`);
  console.log('LIVE TOTALS -> cash:', totals.cash, '| check:', totals.check, '| grand:', totals.grand);
  const totalsOk = totals.cash === '₱ 4,000.50' && totals.check === '₱ 25,396.75' && totals.grand === '₱ 29,397.25';
  console.log('Live totals', totalsOk ? 'OK' : 'FAIL');

  // Screenshot the filled form for visual proof (wait for a repaint first).
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  const png = path.join(__dirname, 'phase2-ui.png');
  fs.writeFileSync(png, img.toPNG());
  console.log('Screenshot:', png);

  // 2) Click Save (goes through real window.api -> ipc -> db), then verify.
  await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('btn-save').click();
    await new Promise((r) => setTimeout(r, 400));
    return true;
  })()`);

  const rows = db.listDeposits();
  const saved = rows[0] ? db.getDeposit(rows[0].id) : null;
  const saveOk = saved && saved.grand_total === 29397.25 && saved.items.length === 3 &&
    saved.reference_no === 'UITEST';
  console.log('SAVED -> id:', saved && saved.id, '| grand:', saved && saved.grand_total,
    '| items:', saved && saved.items.length, saveOk ? 'OK' : 'FAIL');

  const pass = totalsOk && saveOk;
  console.log(pass ? 'UI TEST PASSED' : 'UI TEST FAILED');
  app.exit(pass ? 0 : 1);
});
