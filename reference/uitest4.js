'use strict';
// Phase 4 end-to-end: list filters (date range + search), delete (cascade),
// duplicate, and a UI pass over the History list + detail modal.
// Not shipped. Run: npx electron reference/uitest4.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();
const results = [];
const check = (name, cond) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name); };

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-p4-'));
  db.init(dir);
  for (const [ch, fn] of [
    ['settings:getCalibration', () => db.getCalibration()],
    ['db:createDeposit', (_e, h, i) => db.createDeposit(h, i)],
    ['db:updateDeposit', (_e, id, h, i) => db.updateDeposit(id, h, i)],
    ['db:getDeposit', (_e, id) => db.getDeposit(id)],
    ['db:listDeposits', (_e, f) => db.listDeposits(f)],
    ['db:deleteDeposit', (_e, id) => db.deleteDeposit(id)],
    ['db:duplicateDeposit', (_e, id, d) => db.duplicateDeposit(id, d)],
  ]) ipcMain.handle(ch, fn);

  // --- seed data ---
  const d1 = db.createDeposit(
    { deposit_date: '2026-07-01', bank: 'RCBC', reference_no: 'JULY-1' },
    [{ section: 'CASH', line_no: 1, amount: 1000 },
     { section: 'CHECK', line_no: 1, amount: 500, check_no: 'CHK-100', drawee_bank: 'BDO' }]
  );
  const d2 = db.createDeposit(
    { deposit_date: '2026-07-15', bank: 'RCBC', reference_no: 'JULY-15' },
    [{ section: 'CHECK', line_no: 1, amount: 2000, check_no: 'CHK-200', drawee_bank: 'BPI', remarks: 'urgent' }]
  );
  const d3 = db.createDeposit(
    { deposit_date: '2026-08-02', bank: 'RCBC', reference_no: 'AUG-2' },
    [{ section: 'CASH', line_no: 1, amount: 3000 }]
  );

  // --- filters ---
  check('list all = 3', db.listDeposits().length === 3);
  check('newest first (Aug before July)', db.listDeposits()[0].id === d3);
  const range = db.listDeposits({ from: '2026-07-10', to: '2026-07-31' });
  check('date range 07-10..07-31 = [d2]', range.length === 1 && range[0].id === d2);
  check('search "BPI" (drawee) = [d2]', (() => { const r = db.listDeposits({ search: 'BPI' }); return r.length === 1 && r[0].id === d2; })());
  check('search "CHK-100" (check no) = [d1]', (() => { const r = db.listDeposits({ search: 'CHK-100' }); return r.length === 1 && r[0].id === d1; })());
  check('search "JULY" (reference) = 2', db.listDeposits({ search: 'JULY' }).length === 2);
  check('item_count on d1 = 2', db.listDeposits().find((r) => r.id === d1).item_count === 2);

  // --- duplicate ---
  const dupId = db.duplicateDeposit(d1, '2026-07-29');
  const dup = db.getDeposit(dupId);
  check('duplicate dated today, same items', dup.deposit_date === '2026-07-29' && dup.items.length === 2 && dup.grand_total === 1500);
  check('duplicate is a new row', dupId !== d1 && db.listDeposits().length === 4);

  // --- delete (cascade) ---
  db.deleteDeposit(d3);
  check('deleted d3 removed', db.getDeposit(d3) === null && db.listDeposits().length === 3);

  // --- UI pass ---
  const win = new BrowserWindow({
    width: 1240, height: 940, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  // Wait until the async list has painted (poll the DOM, then flush a frame).
  const paint = () => win.webContents.executeJavaScript(
    `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`
  );
  const waitRows = (n) => win.webContents.executeJavaScript(`(async () => {
    for (let k = 0; k < 40; k++) {
      if (document.querySelectorAll('#h-body .row-link').length === ${n}) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return document.querySelectorAll('#h-body .row-link').length === ${n};
  })()`);

  await win.webContents.executeJavaScript(`document.querySelector('.nav-btn[data-view="history"]').click()`);
  const rowsOk = await waitRows(3);
  await paint();
  check('History renders 3 rows', rowsOk);
  let img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'phase4-history.png'), img.toPNG());
  console.log('Screenshot: phase4-history.png');

  // open the first row's detail modal
  await win.webContents.executeJavaScript(`document.querySelector('#h-body .row-link').click()`);
  await new Promise((r) => setTimeout(r, 400));
  await paint();
  const modalInfo = await win.webContents.executeJavaScript(
    `({ open: !!document.querySelector('.detail-modal'), hasEdit: !!document.querySelector('[data-act="edit"]') })`
  );
  check('detail modal opens with actions', modalInfo.open && modalInfo.hasEdit);
  img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'phase4-detail.png'), img.toPNG());
  console.log('Screenshot: phase4-detail.png');

  const pass = results.every(Boolean);
  console.log(pass ? 'PHASE 4 TEST PASSED' : 'PHASE 4 TEST FAILED');
  app.exit(pass ? 0 : 1);
});
