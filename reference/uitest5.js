'use strict';
// Phase 5 end-to-end: defaults, backup, restore (+validation), CSV export,
// and a Settings-screen screenshot. Not shipped. Run: npx electron reference/uitest5.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const db = require('../db');

app.disableHardwareAcceleration();
const results = [];
const check = (name, cond) => { results.push(cond); console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name); };

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-p5-'));
  db.init(dir);
  ipcMain.handle('settings:getDefaults', () => db.getDefaults());
  ipcMain.handle('settings:saveDefaults', (_e, d) => db.saveDefaults(d));
  ipcMain.handle('db:getPath', () => db.getDbPath());
  ipcMain.handle('auth:status', () => ({ signedIn: true, email: 'office@example.com' }));

  // --- defaults ---
  db.saveDefaults({ bank: 'RCBC', account_name: 'Victoria Ent.', account_number: '1234567890' });
  const d = db.getDefaults();
  check('defaults round-trip', d.bank === 'RCBC' && d.account_name === 'Victoria Ent.' && d.account_number === '1234567890');
  check('defaults bank falls back to RCBC', (() => { db.saveDefaults({ bank: '', account_name: '', account_number: '' }); return db.getDefaults().bank === 'RCBC'; })());

  // --- seed deposits ---
  db.createDeposit({ deposit_date: '2026-07-01', bank: 'RCBC', reference_no: 'A' },
    [{ section: 'CASH', line_no: 1, amount: 1000 },
     { section: 'CHECK', line_no: 1, amount: 500, check_no: 'CHK-1', drawee_bank: 'BDO' }]);
  db.createDeposit({ deposit_date: '2026-07-05', bank: 'RCBC', reference_no: 'B' },
    [{ section: 'CASH', line_no: 1, amount: 2500.25 }]);
  check('two deposits present', db.listDeposits().length === 2);

  // --- backup ---
  const backupPath = path.join(dir, 'backup.db');
  await db.backupTo(backupPath);
  const probe = new Database(backupPath, { readonly: true });
  const backupCount = probe.prepare('SELECT COUNT(*) AS n FROM deposits').get().n;
  probe.close();
  check('backup file has both deposits', fs.existsSync(backupPath) && backupCount === 2);

  // --- CSV export ---
  const csv = db.exportCsv({});
  const csvLines = csv.split('\r\n');
  check('CSV header correct', csvLines[0].startsWith('deposit_id,deposit_date,bank'));
  check('CSV has 3 item rows + header', csvLines.length === 4); // 2 items in dep1 + 1 in dep2
  check('CSV amount is plain 2dp', csv.includes(',2500.25,') && csv.includes(',1000.00,'));
  const csvRange = db.exportCsv({ from: '2026-07-03', to: '2026-07-31' });
  check('CSV date range narrows to dep2 (1 row)', csvRange.split('\r\n').length === 2);

  // --- mutate then restore ---
  db.createDeposit({ deposit_date: '2026-07-09', bank: 'RCBC', reference_no: 'C' },
    [{ section: 'CASH', line_no: 1, amount: 9999 }]);
  check('live db now has 3', db.listDeposits().length === 3);
  const info = db.restoreFrom(backupPath);
  check('restore reports 2 deposits', info.deposits === 2);
  check('live db reverted to 2 after restore', db.listDeposits().length === 2);
  check('restored data intact (ref A reachable)', db.listDeposits({ search: 'CHK-1' }).length === 1);

  // --- invalid restore rejected ---
  const bad = path.join(dir, 'not-a-db.db');
  fs.writeFileSync(bad, 'this is not sqlite');
  let rejected = false;
  try { db.restoreFrom(bad); } catch { rejected = true; }
  check('invalid backup file rejected', rejected);
  check('db still usable after rejected restore', db.listDeposits().length === 2);

  // --- Settings UI screenshot ---
  db.saveDefaults({ bank: 'RCBC', account_name: 'Victoria Enterprises', account_number: '0044-1122-3300' });
  const win = new BrowserWindow({
    width: 1240, height: 980, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));
  await win.webContents.executeJavaScript(`document.querySelector('.nav-btn[data-view="settings"]').click()`);
  await win.webContents.executeJavaScript(`(async () => { for (let k=0;k<40;k++){ if(document.querySelector('#s-dbpath')) return; await new Promise(r=>setTimeout(r,50)); } })()`);
  await win.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  const uiOk = await win.webContents.executeJavaScript(`!!document.querySelector('#s-dbpath') && !!document.querySelector('#y-sync')`);
  check('Settings screen renders (db path + sync section)', uiOk);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'phase5-settings.png'), img.toPNG());
  console.log('Screenshot: phase5-settings.png');

  const pass = results.every(Boolean);
  console.log(pass ? 'PHASE 5 TEST PASSED' : 'PHASE 5 TEST FAILED');
  app.exit(pass ? 0 : 1);
});
