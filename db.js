'use strict';

/**
 * db.js — SQLite persistence layer (better-sqlite3, synchronous).
 *
 * The database file lives in Electron's per-user data directory
 * (app.getPath('userData')) so each user's deposits are private and the
 * file survives app updates. The exact path is surfaced in the UI so the
 * operator always knows where their data lives and can back it up.
 *
 * Money is stored as REAL (numbers), always rounded to 2 decimals before
 * it is written. Totals are ALWAYS derived from the line items inside a
 * single transaction — they are never trusted from the renderer.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

let db = null;
let dbFilePath = null;
let dataDir = null; // remembered so restore can reopen at the same location

/** Round a value to 2 decimal places, guarding against floating-point drift. */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // Round-half-up on cents; the +Number.EPSILON nudge avoids 1.005 -> 1.00 drift.
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Globally-unique id, so records made on different computers never collide. */
function uuid() {
  return crypto.randomUUID();
}

/** Current instant as ISO-8601 UTC — comparable across machines for LWW sync. */
function nowIso() {
  return new Date().toISOString();
}

/** Convert an old SQLite datetime('now') string ('YYYY-MM-DD HH:MM:SS') to ISO. */
function toIso(s) {
  if (!s) return nowIso();
  const str = String(s);
  const d = str.includes('T') ? new Date(str) : new Date(str.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? nowIso() : d.toISOString();
}

/**
 * Open (and if needed create) the database at the given directory.
 * Called once from the main process with app.getPath('userData').
 */
function init(userDataDir) {
  if (db && db.open) db.close(); // close any prior connection first
  dataDir = userDataDir;
  dbFilePath = path.join(userDataDir, 'deposits.db');
  db = new Database(dbFilePath);

  // Durability + referential integrity.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Settings first (holds schema_version and sync bookkeeping).
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);

  // Decide schema state: fresh, legacy (v1, integer ids), or current (v2, uuid).
  const hasDeposits = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='deposits'`)
    .get();
  if (!hasDeposits) {
    createV2Schema();
  } else {
    const idCol = db.prepare(`PRAGMA table_info(deposits)`).all().find((c) => c.name === 'id');
    if (idCol && /INT/i.test(idCol.type)) {
      migrateV1toV2(); // upgrade existing integer-id data to uuids in place
    } else {
      createV2Schema(); // already v2 (CREATE IF NOT EXISTS is a no-op)
    }
  }

  return dbFilePath;
}

/**
 * v2 schema — the sync-ready shape:
 *   * TEXT (uuid) primary keys so different computers never collide
 *   * created_at / updated_at as ISO-8601 UTC (comparable for last-write-wins)
 *   * deleted_at for soft deletes (so removals propagate through sync)
 *   * dirty flag (1 = changed locally, needs pushing to Supabase)
 */
function createV2Schema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS deposits (
      id             TEXT    PRIMARY KEY,
      deposit_date   TEXT    NOT NULL,
      bank           TEXT    NOT NULL DEFAULT 'RCBC',
      account_name   TEXT,
      account_number TEXT,
      reference_no   TEXT,
      notes          TEXT,
      cash_total     REAL    NOT NULL DEFAULT 0,
      check_total    REAL    NOT NULL DEFAULT 0,
      grand_total    REAL    NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL,
      deleted_at     TEXT,
      dirty          INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS deposit_items (
      id           TEXT    PRIMARY KEY,
      deposit_id   TEXT    NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
      section      TEXT    NOT NULL CHECK (section IN ('CASH','CHECK')),
      line_no      INTEGER NOT NULL CHECK (line_no BETWEEN 1 AND 24),
      amount       REAL    NOT NULL,
      check_no     TEXT,
      drawee_bank  TEXT,
      check_date   TEXT,
      remarks      TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_deposit  ON deposit_items(deposit_id);
    CREATE INDEX IF NOT EXISTS idx_deposits_date  ON deposits(deposit_date);
    CREATE INDEX IF NOT EXISTS idx_deposits_dirty ON deposits(dirty);
  `);
  setSetting('schema_version', 2);
}

/** One-time migration of a legacy (integer-id) database to the v2 uuid schema. */
function migrateV1toV2() {
  const tx = db.transaction(() => {
    db.exec(`ALTER TABLE deposits      RENAME TO deposits_v1;`);
    db.exec(`ALTER TABLE deposit_items RENAME TO deposit_items_v1;`);
    createV2Schema();

    const insDep = db.prepare(`
      INSERT INTO deposits
        (id, deposit_date, bank, account_name, account_number, reference_no, notes,
         cash_total, check_total, grand_total, created_at, updated_at, deleted_at, dirty)
      VALUES
        (@id, @deposit_date, @bank, @account_name, @account_number, @reference_no, @notes,
         @cash_total, @check_total, @grand_total, @created_at, @updated_at, NULL, 1)`);
    const insItem = db.prepare(`
      INSERT INTO deposit_items
        (id, deposit_id, section, line_no, amount, check_no, drawee_bank, check_date, remarks)
      VALUES
        (@id, @deposit_id, @section, @line_no, @amount, @check_no, @drawee_bank, @check_date, @remarks)`);

    const idMap = new Map(); // old integer id -> new uuid
    for (const d of db.prepare(`SELECT * FROM deposits_v1`).all()) {
      const nid = uuid();
      idMap.set(d.id, nid);
      insDep.run({
        ...d, id: nid,
        created_at: toIso(d.created_at),
        updated_at: toIso(d.updated_at),
      });
    }
    for (const it of db.prepare(`SELECT * FROM deposit_items_v1`).all()) {
      const ndid = idMap.get(it.deposit_id);
      if (!ndid) continue;
      insItem.run({ ...it, id: uuid(), deposit_id: ndid });
    }

    db.exec(`DROP TABLE deposit_items_v1; DROP TABLE deposits_v1;`);
  });
  tx();
}

// ---- settings (key/value JSON) ---------------------------------------------

/** Print calibration defaults: no shift, no scale. Millimetres / ratios. */
const DEFAULT_CALIBRATION = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
  return value;
}

function deleteSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/** Calibration merged over defaults, so missing/older keys still work. */
function getCalibration() {
  return { ...DEFAULT_CALIBRATION, ...(getSetting('calibration') || {}) };
}

function saveCalibration(calib) {
  const clean = {
    offsetX: Number(calib.offsetX) || 0,
    offsetY: Number(calib.offsetY) || 0,
    // Guard the scale so a stray 0 can't collapse the whole layout.
    scaleX: Number(calib.scaleX) > 0 ? Number(calib.scaleX) : 1,
    scaleY: Number(calib.scaleY) > 0 ? Number(calib.scaleY) : 1,
  };
  return setSetting('calibration', clean);
}

/** Default header values pre-filled on a new deposit. */
const DEFAULT_HEADER = { bank: 'RCBC', account_name: '', account_number: '' };

function getDefaults() {
  return { ...DEFAULT_HEADER, ...(getSetting('defaults') || {}) };
}

function saveDefaults(d) {
  return setSetting('defaults', {
    bank: (d.bank || '').trim() || 'RCBC',
    account_name: (d.account_name || '').trim(),
    account_number: (d.account_number || '').trim(),
  });
}

/** Supabase sync config (per machine; the key never ships in the app). */
function getSyncConfig() {
  return { url: '', key: '', ...(getSetting('sync') || {}) };
}

function saveSyncConfig(cfg) {
  return setSetting('sync', {
    url: (cfg.url || '').trim(),
    key: (cfg.key || '').trim(),
  });
}

// ---- sync bookkeeping (used by sync.js) ------------------------------------

/** Highest remote updated_at we've pulled, so we only fetch newer rows. */
function getWatermark() {
  return getSetting('sync_watermark', null);
}
function setWatermark(ts) {
  return setSetting('sync_watermark', ts);
}

/** Locally-changed deposits awaiting push (includes soft-deleted), with items. */
function getDirtyDeposits() {
  const deps = db.prepare('SELECT * FROM deposits WHERE dirty = 1').all();
  const itemsStmt = db.prepare('SELECT * FROM deposit_items WHERE deposit_id = ?');
  return deps.map((d) => ({ ...d, items: itemsStmt.all(d.id) }));
}

/** How many deposits are still pending a push (for the sync status badge). */
function getPendingCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM deposits WHERE dirty = 1').get().n;
}

/**
 * Clear the dirty flag after a successful push — but only if the row hasn't
 * changed again since (updated_at still matches), so a concurrent local edit
 * during the push isn't silently marked as synced.
 */
function clearDirty(pushed) {
  const stmt = db.prepare('UPDATE deposits SET dirty = 0 WHERE id = @id AND updated_at = @updated_at');
  const tx = db.transaction(() => pushed.forEach((p) => stmt.run(p)));
  tx();
}

/** {updated_at, deleted_at} for LWW comparison during pull, or null. */
function getDepositMeta(id) {
  return db.prepare('SELECT updated_at, deleted_at FROM deposits WHERE id = ?').get(id) || null;
}

/**
 * Overwrite a local deposit + its items from a remote (Supabase) copy, marked
 * clean (dirty=0). Called by pull only when the remote is the winner (or new).
 */
function applyRemote(dep, items) {
  const insDep = db.prepare(`
    INSERT OR REPLACE INTO deposits
      (id, deposit_date, bank, account_name, account_number, reference_no, notes,
       cash_total, check_total, grand_total, created_at, updated_at, deleted_at, dirty)
    VALUES
      (@id, @deposit_date, @bank, @account_name, @account_number, @reference_no, @notes,
       @cash_total, @check_total, @grand_total, @created_at, @updated_at, @deleted_at, 0)`);
  const insItem = db.prepare(`
    INSERT INTO deposit_items
      (id, deposit_id, section, line_no, amount, check_no, drawee_bank, check_date, remarks)
    VALUES
      (@id, @deposit_id, @section, @line_no, @amount, @check_no, @drawee_bank, @check_date, @remarks)`);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM deposit_items WHERE deposit_id = ?').run(dep.id);
    insDep.run({
      id: dep.id,
      deposit_date: dep.deposit_date,
      bank: dep.bank || 'RCBC',
      account_name: dep.account_name ?? null,
      account_number: dep.account_number ?? null,
      reference_no: dep.reference_no ?? null,
      notes: dep.notes ?? null,
      cash_total: dep.cash_total ?? 0,
      check_total: dep.check_total ?? 0,
      grand_total: dep.grand_total ?? 0,
      created_at: dep.created_at,
      updated_at: dep.updated_at,
      deleted_at: dep.deleted_at ?? null,
    });
    for (const it of items || []) {
      insItem.run({
        id: it.id,
        deposit_id: dep.id,
        section: it.section,
        line_no: it.line_no,
        amount: money(it.amount),
        check_no: it.check_no ?? null,
        drawee_bank: it.drawee_bank ?? null,
        check_date: it.check_date ?? null,
        remarks: it.remarks ?? null,
      });
    }
  });
  tx();
}

// ---- backup / restore / CSV ------------------------------------------------

/**
 * Write a consistent single-file copy of the database to destPath using the
 * SQLite online backup API (safe even while the app is running / in WAL mode).
 */
async function backupTo(destPath) {
  await db.backup(destPath);
  return destPath;
}

/** Close, reopen the database at the remembered data directory. */
function reopen() {
  if (db) db.close();
  return init(dataDir);
}

/**
 * Replace the live database with the file at srcPath. The source is validated
 * (must be a SQLite file containing our tables) before anything is overwritten.
 * Returns { deposits } — the row count in the restored database.
 */
function restoreFrom(srcPath) {
  // 1) Validate the candidate file without touching the live DB.
  let probe;
  try {
    probe = new Database(srcPath, { readonly: true, fileMustExist: true });
    const tables = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('deposits','deposit_items')`)
      .all()
      .map((r) => r.name);
    if (!tables.includes('deposits') || !tables.includes('deposit_items')) {
      throw new Error('This file is not a Check Deposit Recorder backup.');
    }
  } finally {
    if (probe) probe.close();
  }

  // 2) Swap the file in, then reopen. WAL/SHM sidecars are cleared so no stale
  //    pages from the old database survive.
  db.close();
  fs.copyFileSync(srcPath, dbFilePath);
  for (const ext of ['-wal', '-shm']) {
    const p = dbFilePath + ext;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  init(dataDir);

  const count = db.prepare('SELECT COUNT(*) AS n FROM deposits WHERE deleted_at IS NULL').get().n;
  return { deposits: count };
}

/** Quote a value for CSV (RFC 4180): wrap in quotes if it holds , " or newline. */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Build an item-level CSV (one row per cash/check line) for the given date
 * filters — a real, re-importable register. Amounts are plain numbers with 2
 * decimals (no symbol / separators) so spreadsheets parse them cleanly.
 */
function exportCsv(filters = {}) {
  const deposits = listDeposits(filters); // already honours from/to/search
  const header = [
    'deposit_id', 'deposit_date', 'bank', 'account_name', 'account_number',
    'reference_no', 'notes', 'section', 'line_no', 'amount',
    'check_no', 'drawee_bank', 'check_date', 'remarks',
  ];
  const lines = [header.join(',')];

  for (const d of deposits) {
    const full = getDeposit(d.id);
    for (const it of full.items) {
      lines.push([
        full.id, full.deposit_date, full.bank, full.account_name, full.account_number,
        full.reference_no, full.notes, it.section, it.line_no, money(it.amount).toFixed(2),
        it.check_no, it.drawee_bank, it.check_date, it.remarks,
      ].map(csvCell).join(','));
    }
  }
  return lines.join('\r\n');
}

function getDbPath() {
  return dbFilePath;
}

/**
 * Recompute cash/check/grand totals from a list of items.
 * Returns rounded { cash_total, check_total, grand_total }.
 */
function computeTotals(items) {
  let cash = 0;
  let check = 0;
  for (const it of items) {
    const amt = money(it.amount);
    if (it.section === 'CASH') cash += amt;
    else if (it.section === 'CHECK') check += amt;
  }
  cash = money(cash);
  check = money(check);
  return { cash_total: cash, check_total: check, grand_total: money(cash + check) };
}

/**
 * Insert a deposit and its items in one transaction.
 * `header` = { deposit_date, bank, account_name, account_number, reference_no, notes }
 * `items`  = [{ section, line_no, amount, check_no, drawee_bank, check_date, remarks }]
 * Returns the new deposit id.
 */
function createDeposit(header, items) {
  if (!header || !header.deposit_date) throw new Error('deposit_date is required');
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('a deposit needs at least one item');
  }

  const totals = computeTotals(items);
  const id = uuid();
  const ts = nowIso();

  const insertDeposit = db.prepare(`
    INSERT INTO deposits
      (id, deposit_date, bank, account_name, account_number, reference_no, notes,
       cash_total, check_total, grand_total, created_at, updated_at, deleted_at, dirty)
    VALUES
      (@id, @deposit_date, @bank, @account_name, @account_number, @reference_no, @notes,
       @cash_total, @check_total, @grand_total, @created_at, @updated_at, NULL, 1)
  `);

  const insertItem = db.prepare(`
    INSERT INTO deposit_items
      (id, deposit_id, section, line_no, amount, check_no, drawee_bank, check_date, remarks)
    VALUES
      (@id, @deposit_id, @section, @line_no, @amount, @check_no, @drawee_bank, @check_date, @remarks)
  `);

  const tx = db.transaction(() => {
    insertDeposit.run({
      id,
      deposit_date: header.deposit_date,
      bank: header.bank || 'RCBC',
      account_name: header.account_name || null,
      account_number: header.account_number || null,
      reference_no: header.reference_no || null,
      notes: header.notes || null,
      created_at: ts,
      updated_at: ts,
      ...totals,
    });

    for (const it of items) {
      insertItem.run({
        id: uuid(),
        deposit_id: id,
        section: it.section,
        line_no: it.line_no,
        amount: money(it.amount),
        check_no: it.check_no || null,
        drawee_bank: it.drawee_bank || null,
        check_date: it.check_date || null,
        remarks: it.remarks || null,
      });
    }
    return id;
  });

  return tx();
}

/**
 * Update an existing deposit and fully replace its items, in one transaction.
 * Totals are recomputed from the items; updated_at is bumped.
 * Returns the number of deposit rows changed (0 if the id doesn't exist).
 */
function updateDeposit(id, header, items) {
  if (!header || !header.deposit_date) throw new Error('deposit_date is required');
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('a deposit needs at least one item');
  }

  const totals = computeTotals(items);

  const updateRow = db.prepare(`
    UPDATE deposits SET
      deposit_date = @deposit_date,
      bank = @bank,
      account_name = @account_name,
      account_number = @account_number,
      reference_no = @reference_no,
      notes = @notes,
      cash_total = @cash_total,
      check_total = @check_total,
      grand_total = @grand_total,
      updated_at = @updated_at,
      dirty = 1
    WHERE id = @id AND deleted_at IS NULL
  `);

  const deleteItems = db.prepare('DELETE FROM deposit_items WHERE deposit_id = ?');
  const insertItem = db.prepare(`
    INSERT INTO deposit_items
      (id, deposit_id, section, line_no, amount, check_no, drawee_bank, check_date, remarks)
    VALUES
      (@id, @deposit_id, @section, @line_no, @amount, @check_no, @drawee_bank, @check_date, @remarks)
  `);

  const tx = db.transaction(() => {
    const info = updateRow.run({
      id,
      deposit_date: header.deposit_date,
      bank: header.bank || 'RCBC',
      account_name: header.account_name || null,
      account_number: header.account_number || null,
      reference_no: header.reference_no || null,
      notes: header.notes || null,
      updated_at: nowIso(),
      ...totals,
    });
    if (info.changes === 0) return 0; // no such deposit; nothing else to do

    deleteItems.run(id);
    for (const it of items) {
      insertItem.run({
        id: uuid(),
        deposit_id: id,
        section: it.section,
        line_no: it.line_no,
        amount: money(it.amount),
        check_no: it.check_no || null,
        drawee_bank: it.drawee_bank || null,
        check_date: it.check_date || null,
        remarks: it.remarks || null,
      });
    }
    return info.changes;
  });

  return tx();
}

/** Fetch a single (non-deleted) deposit with its items, or null. */
function getDeposit(id) {
  const deposit = db
    .prepare('SELECT * FROM deposits WHERE id = ? AND deleted_at IS NULL')
    .get(id);
  if (!deposit) return null;
  const items = db
    .prepare('SELECT * FROM deposit_items WHERE deposit_id = ? ORDER BY section, line_no')
    .all(id);
  return { ...deposit, items };
}

/** The newest non-deleted deposit for a given date (with items), or null. */
function getDepositByDate(date) {
  const row = db
    .prepare(`SELECT id FROM deposits WHERE deposit_date = ? AND deleted_at IS NULL
              ORDER BY created_at DESC LIMIT 1`)
    .get(date);
  return row ? getDeposit(row.id) : null;
}

/**
 * List deposits (newest first) with an item count.
 * filters = { from, to, search } — all optional:
 *   from / to  — inclusive deposit_date bounds ('YYYY-MM-DD')
 *   search     — free text matched against reference/notes/bank/account and,
 *                via the items, check no / drawee bank / remarks.
 */
function listDeposits(filters = {}) {
  const where = ['d.deleted_at IS NULL'];
  const params = {};

  if (filters.from) { where.push('d.deposit_date >= @from'); params.from = filters.from; }
  if (filters.to) { where.push('d.deposit_date <= @to'); params.to = filters.to; }

  const q = (filters.search || '').trim();
  if (q) {
    params.q = '%' + q + '%';
    where.push(`(
      d.reference_no LIKE @q OR d.notes LIKE @q OR d.bank LIKE @q
      OR d.account_name LIKE @q OR d.account_number LIKE @q
      OR EXISTS (
        SELECT 1 FROM deposit_items i
        WHERE i.deposit_id = d.id
          AND (i.check_no LIKE @q OR i.drawee_bank LIKE @q OR i.remarks LIKE @q)
      )
    )`);
  }

  const sql = `
    SELECT d.*, (SELECT COUNT(*) FROM deposit_items i WHERE i.deposit_id = d.id) AS item_count
    FROM deposits d
    WHERE ${where.join(' AND ')}
    ORDER BY d.deposit_date DESC, d.created_at DESC`;

  return db.prepare(sql).all(params);
}

/**
 * Soft-delete a deposit (set deleted_at) so the removal syncs to other
 * computers. The row + items stay locally but are hidden from all UI queries.
 */
function deleteDeposit(id) {
  const ts = nowIso();
  return db
    .prepare(`UPDATE deposits SET deleted_at = @ts, updated_at = @ts, dirty = 1
              WHERE id = @id AND deleted_at IS NULL`)
    .run({ id, ts }).changes;
}

/**
 * Duplicate a deposit into a NEW deposit dated `newDate` (copies header + items,
 * assigns a fresh id). Used for recurring deposits. Returns the new id.
 */
function duplicateDeposit(id, newDate) {
  const src = getDeposit(id);
  if (!src) throw new Error('deposit not found');
  const header = {
    deposit_date: newDate,
    bank: src.bank,
    account_name: src.account_name,
    account_number: src.account_number,
    reference_no: src.reference_no,
    notes: src.notes,
  };
  const items = src.items.map((it) => ({
    section: it.section,
    line_no: it.line_no,
    amount: it.amount,
    check_no: it.check_no,
    drawee_bank: it.drawee_bank,
    check_date: it.check_date,
    remarks: it.remarks,
  }));
  return createDeposit(header, items);
}

module.exports = {
  init,
  getDbPath,
  money,
  computeTotals,
  createDeposit,
  updateDeposit,
  getDeposit,
  getDepositByDate,
  listDeposits,
  deleteDeposit,
  duplicateDeposit,
  getSetting,
  setSetting,
  deleteSetting,
  getCalibration,
  saveCalibration,
  DEFAULT_CALIBRATION,
  getDefaults,
  saveDefaults,
  getSyncConfig,
  saveSyncConfig,
  getWatermark,
  setWatermark,
  getDirtyDeposits,
  getPendingCount,
  clearDirty,
  getDepositMeta,
  applyRemote,
  backupTo,
  restoreFrom,
  reopen,
  exportCsv,
};
