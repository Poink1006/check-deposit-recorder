'use strict';
// Automated proof for the DB layer, run under Electron's runtime (matching the
// native better-sqlite3 ABI). Not shipped. Run: npx electron reference/smoke.js
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-smoke-'));
  const dbPath = db.init(dir);
  console.log('DB created at:', dbPath);

  // --- create ---
  const id = db.createDeposit(
    { deposit_date: '2026-07-27', bank: 'RCBC', reference_no: 'SMOKE' },
    [
      { section: 'CASH', line_no: 1, amount: 1500.5 },
      { section: 'CHECK', line_no: 1, amount: 25396.75, check_no: '000123', drawee_bank: 'BDO' },
    ]
  );
  let back = db.getDeposit(id);
  const createOk =
    back.cash_total === 1500.5 && back.check_total === 25396.75 &&
    back.grand_total === 26897.25 && back.items.length === 2;
  console.log('CREATE totals grand:', back.grand_total, '| items:', back.items.length, createOk ? 'OK' : 'FAIL');

  // --- update (replace items, recompute totals) ---
  db.updateDeposit(id, { deposit_date: '2026-07-28', bank: 'RCBC', reference_no: 'SMOKE-2' }, [
    { section: 'CASH', line_no: 1, amount: 100 },
    { section: 'CASH', line_no: 2, amount: 200.25 },
    { section: 'CHECK', line_no: 3, amount: 50, check_no: 'A1' }, // gap at line 1-2 preserved
  ]);
  back = db.getDeposit(id);
  const updateOk =
    back.deposit_date === '2026-07-28' &&
    back.cash_total === 300.25 && back.check_total === 50 &&
    back.grand_total === 350.25 && back.items.length === 3 &&
    back.items.find((i) => i.section === 'CHECK').line_no === 3;
  console.log('UPDATE totals grand:', back.grand_total, '| items:', back.items.length,
    '| check line_no:', back.items.find((i) => i.section === 'CHECK').line_no, updateOk ? 'OK' : 'FAIL');

  // --- update of a missing id returns 0 ---
  const missing = db.updateDeposit(999999, { deposit_date: '2026-01-01' }, [{ section: 'CASH', line_no: 1, amount: 1 }]);
  const missingOk = missing === 0;
  console.log('UPDATE missing id ->', missing, missingOk ? 'OK' : 'FAIL');

  const pass = createOk && updateOk && missingOk;
  console.log(pass ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED');
  app.exit(pass ? 0 : 1);
});
