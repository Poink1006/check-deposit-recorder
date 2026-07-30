'use strict';
// Two-computer offline-sync test against the real Supabase project.
// Requires the shared account (RLS is authenticated-only) + migration 002 run.
// Runs under Electron:
//   SUPA_TEST_EMAIL=... SUPA_TEST_PASSWORD=... npx electron reference/uitest-sync.js
// Skips (exit 0) if no test credentials are provided.
const { app } = require('electron');
const os = require('os'), path = require('path'), fs = require('fs');
const db = require('../db');
const sync = require('../sync');

app.disableHardwareAcceleration();
const EMAIL = process.env.SUPA_TEST_EMAIL, PASS = process.env.SUPA_TEST_PASSWORD;
const results = [];
const check = (n, c) => { results.push(c); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const mkdir = (t) => fs.mkdtempSync(path.join(os.tmpdir(), t));

async function useComputer(dir) {
  db.init(dir);
  sync.init();
  const r = await sync.signIn(EMAIL, PASS);
  if (!r.ok) throw new Error('sign-in failed: ' + r.error);
}

async function main() {
  if (!EMAIL || !PASS) {
    console.log('SYNC TEST SKIPPED (set SUPA_TEST_EMAIL / SUPA_TEST_PASSWORD)');
    return app.exit(0);
  }

  const A = mkdir('cdrA-'), B = mkdir('cdrB-');
  await useComputer(A);
  await sync.getClient().from('deposits').delete().like('reference_no', 'SYNC%'); // clean slate

  // A: create + push
  const a1 = db.createDeposit({ deposit_date: '2026-07-29', reference_no: 'SYNC-A1' },
    [{ section: 'CASH', line_no: 1, amount: 1000 }]);
  let r = await sync.syncNow();
  check('A: push ok', r.ok && r.pushed >= 1);

  // B: pull
  await useComputer(B);
  r = await sync.syncNow();
  check('B: pulled A1', r.ok && r.pulled >= 1);
  const bA1 = db.getDeposit(a1);
  check('B: A1 present with total', bA1 && bA1.grand_total === 1000);

  // B: create + edit A1 (newer)
  const b1 = db.createDeposit({ deposit_date: '2026-07-29', reference_no: 'SYNC-B1' },
    [{ section: 'CHECK', line_no: 1, amount: 2000 }]);
  db.updateDeposit(a1, { deposit_date: '2026-07-30', reference_no: 'SYNC-A1-EDIT' },
    [{ section: 'CASH', line_no: 1, amount: 1500 }]);
  r = await sync.syncNow();
  check('B: pushed b1 + edit', r.ok && r.pushed >= 2);

  // A: pull edit + b1 (last-write-wins)
  await useComputer(A);
  r = await sync.syncNow();
  const aEdit = db.getDeposit(a1);
  check('A: A1 edit won', aEdit && aEdit.grand_total === 1500 && aEdit.deposit_date === '2026-07-30');
  const aB1 = db.listDeposits().find((d) => d.reference_no === 'SYNC-B1');
  check('A: pulled B1', !!aB1);

  // A: delete b1, B: pull removal
  db.deleteDeposit(aB1.id);
  await sync.syncNow();
  await useComputer(B);
  r = await sync.syncNow();
  check('B: B1 removed via sync', db.getDeposit(b1) === null);

  await sync.getClient().from('deposits').delete().like('reference_no', 'SYNC%'); // cleanup
  const pass = results.every(Boolean);
  console.log(pass ? 'SYNC TEST PASSED' : 'SYNC TEST FAILED');
  app.exit(pass ? 0 : 1);
}

app.whenReady().then(() => main().catch((e) => { console.error('ERROR', e.message); app.exit(1); }));
