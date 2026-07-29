'use strict';
// Two-computer offline-sync test against the real Supabase project.
// Runs under Electron (matches the native better-sqlite3 ABI):
//   SUPA_URL=... SUPA_KEY=... npx electron reference/uitest-sync.js
const { app } = require('electron');
const os = require('os'), path = require('path'), fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const db = require('../db');
const sync = require('../sync');

app.disableHardwareAcceleration();

const URL = process.env.SUPA_URL, KEY = process.env.SUPA_KEY;
const raw = createClient(URL, KEY, { auth: { persistSession: false } });
const results = [];
const check = (n, c) => { results.push(c); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); };
const mkdir = (t) => fs.mkdtempSync(path.join(os.tmpdir(), t));

async function main() {
  sync.init({ url: URL, key: KEY });
  await raw.from('deposits').delete().like('reference_no', 'SYNC%'); // clean slate

  const A = mkdir('cdrA-'), B = mkdir('cdrB-');

  // ── Computer A: create + push ───────────────────────────────────────────
  db.init(A);
  const a1 = db.createDeposit({ deposit_date: '2026-07-29', reference_no: 'SYNC-A1' },
    [{ section: 'CASH', line_no: 1, amount: 1000 }]);
  check('A: 1 pending before sync', db.getPendingCount() === 1);
  let r = await sync.syncNow();
  check('A: push ok (pushed>=1)', r.ok && r.pushed >= 1);
  check('A: 0 pending after push', db.getPendingCount() === 0);

  // ── Computer B: pull A's deposit ────────────────────────────────────────
  db.init(B);
  r = await sync.syncNow();
  check('B: pulled A1', r.ok && r.pulled >= 1);
  const bA1 = db.getDeposit(a1);
  check('B: A1 present with item + total', bA1 && bA1.items.length === 1 && bA1.grand_total === 1000);

  // B creates its own, and edits A1 (newer) → both push
  const b1 = db.createDeposit({ deposit_date: '2026-07-29', reference_no: 'SYNC-B1' },
    [{ section: 'CHECK', line_no: 1, amount: 2000 }]);
  db.updateDeposit(a1, { deposit_date: '2026-07-30', reference_no: 'SYNC-A1-EDIT' },
    [{ section: 'CASH', line_no: 1, amount: 1500 }]);
  r = await sync.syncNow();
  check('B: pushed b1 + edit', r.ok && r.pushed >= 2);

  // ── Computer A: pull B1 + the edit (last-write-wins) ────────────────────
  db.init(A);
  r = await sync.syncNow();
  const aB1 = db.listDeposits().find((d) => d.reference_no === 'SYNC-B1');
  check('A: pulled B1', !!aB1);
  const aEdit = db.getDeposit(a1);
  check('A: A1 edit won (date+total+ref updated)',
    aEdit && aEdit.deposit_date === '2026-07-30' && aEdit.grand_total === 1500 &&
    aEdit.reference_no === 'SYNC-A1-EDIT' && aEdit.items[0].amount === 1500);

  // ── Delete propagation: A deletes B1, B pulls the removal ───────────────
  db.deleteDeposit(aB1.id);
  r = await sync.syncNow();
  check('A: pushed delete', r.ok && r.pushed >= 1);
  check('A: B1 hidden locally', db.getDeposit(b1) === null);

  db.init(B);
  r = await sync.syncNow();
  check('B: pulled delete → B1 gone', db.getDeposit(b1) === null &&
    !db.listDeposits().some((d) => d.id === b1));

  // ── cleanup remote test rows ────────────────────────────────────────────
  await raw.from('deposits').delete().like('reference_no', 'SYNC%');
  const { count } = await raw.from('deposits').select('*', { count: 'exact', head: true }).like('reference_no', 'SYNC%');
  check('cleanup: no SYNC rows left in Supabase', (count ?? 0) === 0);

  const pass = results.every(Boolean);
  console.log(pass ? 'SYNC TEST PASSED' : 'SYNC TEST FAILED');
  app.exit(pass ? 0 : 1);
}

app.whenReady().then(() => main().catch((e) => { console.error('ERROR', e.message); app.exit(1); }));
