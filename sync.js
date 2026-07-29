'use strict';

/**
 * sync.js — Supabase client + offline-capable sync engine (main process).
 *
 * Local SQLite is always the working store, so the app runs fully offline.
 * This engine reconciles local ↔ the shared Supabase project:
 *
 *   push — every locally-changed deposit (dirty=1), including soft-deletes,
 *          is upserted to Supabase; its items are replaced remotely.
 *   pull — deposits with a newer updated_at than our watermark are fetched and
 *          applied locally, LAST-WRITE-WINS by updated_at (soft-deletes carry
 *          the deleted_at across, so removals propagate).
 *
 * Timestamps are ISO-8601 UTC generated on each machine. Last-write-wins uses
 * wall-clock time, so large clock differences between office PCs could resolve
 * a conflict the "wrong" way — fine for this low-conflict, mostly-append use.
 *
 * Config (URL + publishable key) is stored locally per machine, never baked
 * into the app, so the key stays off the public repo/installer.
 */

// Electron's main-process Node (v20) has no global WebSocket, and supabase-js's
// realtime client throws on load without one. We don't use realtime (we poll),
// but provide `ws` so the client constructs cleanly.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch { /* falls back to error if truly missing */ }
}

const { createClient } = require('@supabase/supabase-js');
const db = require('./db');

let client = null;
let current = { url: '', key: '' };

let lastSync = null;   // ISO time of the last successful sync
let lastError = null;  // message of the last failure (e.g. offline)
let syncing = false;   // guard against overlapping runs
let notifier = null;   // called after each run so the UI can refresh
let intervalId = null;
let soonTimer = null;

/** Accept either the base project URL or the REST URL; return the base. */
function normalizeUrl(url) {
  return (url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/, '');
}

/** (Re)create the client from a { url, key } config. */
function init(cfg) {
  current = { url: normalizeUrl(cfg && cfg.url), key: ((cfg && cfg.key) || '').trim() };
  client =
    current.url && current.key
      ? createClient(current.url, current.key, { auth: { persistSession: false } })
      : null;
  return client;
}

function getClient() {
  return client;
}
function isConfigured() {
  return !!client;
}
function setNotifier(cb) {
  notifier = cb;
}

/**
 * Confirm the URL/key work AND the schema exists. A real (non-head) select is
 * used so a missing table surfaces as an error — a head/count query can return
 * a false success when the table isn't there yet.
 */
async function testConnection() {
  if (!client) return { ok: false, error: 'Sync is not configured yet.' };
  try {
    const { error } = await client.from('deposits').select('id').limit(1);
    if (error) {
      const schemaMissing = /schema cache|does not exist|not find the table/i.test(error.message);
      return {
        ok: false,
        error: schemaMissing
          ? 'Connected, but the tables are missing — run supabase/001_init.sql in the SQL editor.'
          : error.message,
      };
    }
    const { count } = await client
      .from('deposits')
      .select('*', { count: 'exact', head: true });
    return { ok: true, count: count ?? 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Map a local deposit row to the remote columns (drop the local-only `dirty`).
function toRemoteDeposit(d) {
  return {
    id: d.id,
    deposit_date: d.deposit_date,
    bank: d.bank,
    account_name: d.account_name ?? null,
    account_number: d.account_number ?? null,
    reference_no: d.reference_no ?? null,
    notes: d.notes ?? null,
    cash_total: d.cash_total ?? 0,
    check_total: d.check_total ?? 0,
    grand_total: d.grand_total ?? 0,
    created_at: d.created_at,
    updated_at: d.updated_at,
    deleted_at: d.deleted_at ?? null,
  };
}

function toRemoteItem(it, depositId) {
  return {
    id: it.id,
    deposit_id: depositId,
    section: it.section,
    line_no: it.line_no,
    amount: it.amount,
    check_no: it.check_no ?? null,
    drawee_bank: it.drawee_bank ?? null,
    check_date: it.check_date ?? null,
    remarks: it.remarks ?? null,
  };
}

/** Push all locally-changed deposits to Supabase, then clear their dirty flag. */
async function pushDirty() {
  const dirty = db.getDirtyDeposits();
  if (!dirty.length) return { pushed: 0 };

  const pushed = [];
  for (const d of dirty) {
    const { error: e1 } = await client.from('deposits').upsert(toRemoteDeposit(d), { onConflict: 'id' });
    if (e1) throw new Error('push deposit: ' + e1.message);

    // Replace remote items for this deposit (delete then insert current set).
    const { error: e2 } = await client.from('deposit_items').delete().eq('deposit_id', d.id);
    if (e2) throw new Error('push items (delete): ' + e2.message);

    if (!d.deleted_at && d.items.length) {
      const rows = d.items.map((it) => toRemoteItem(it, d.id));
      const { error: e3 } = await client.from('deposit_items').insert(rows);
      if (e3) throw new Error('push items (insert): ' + e3.message);
    }
    pushed.push({ id: d.id, updated_at: d.updated_at });
  }

  db.clearDirty(pushed);
  return { pushed: pushed.length };
}

/** Pull remote changes newer than our watermark and apply them (LWW). */
async function pull() {
  const watermark = db.getWatermark();

  let query = client.from('deposits').select('*').order('updated_at', { ascending: true });
  if (watermark) query = query.gt('updated_at', watermark);
  const { data: remoteDeps, error } = await query;
  if (error) throw new Error('pull deposits: ' + error.message);

  let applied = 0;
  let maxStr = watermark;
  let maxNum = watermark ? Date.parse(watermark) : -Infinity;

  for (const rd of remoteDeps || []) {
    const rNum = Date.parse(rd.updated_at);
    if (rNum > maxNum) { maxNum = rNum; maxStr = rd.updated_at; }

    const local = db.getDepositMeta(rd.id);
    // Skip if our local copy is the same age or newer (it'll push instead).
    if (local && !(rNum > Date.parse(local.updated_at))) continue;

    let items = [];
    if (!rd.deleted_at) {
      const { data: ri, error: ei } = await client
        .from('deposit_items')
        .select('*')
        .eq('deposit_id', rd.id);
      if (ei) throw new Error('pull items: ' + ei.message);
      items = ri || [];
    }
    db.applyRemote(rd, items);
    applied++;
  }

  if (maxStr) db.setWatermark(maxStr);
  return { pulled: applied };
}

/** Full sync: push local changes, then pull remote ones. Safe to call anytime. */
async function syncNow() {
  if (!client) return { ok: false, error: 'not_configured' };
  if (syncing) return { ok: false, error: 'busy' };
  syncing = true;
  try {
    const p = await pushDirty();
    const q = await pull();
    lastSync = new Date().toISOString();
    lastError = null;
    const result = { ok: true, pushed: p.pushed, pulled: q.pulled };
    if (notifier) notifier(result);
    return result;
  } catch (e) {
    lastError = e.message;
    const result = { ok: false, error: e.message };
    if (notifier) notifier(result);
    return result;
  } finally {
    syncing = false;
  }
}

/** Current sync state for the status badge. */
function status() {
  return {
    configured: !!client,
    lastSync,
    lastError,
    pending: (() => { try { return db.getPendingCount(); } catch { return 0; } })(),
  };
}

/** Kick a sync shortly after a local change (debounced), if configured. */
function scheduleSoon() {
  if (!client) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), 1500);
}

/** Start periodic background sync (every `ms`). */
function startAuto(ms = 45000) {
  if (intervalId) clearInterval(intervalId);
  if (client) syncNow(); // initial sync on launch
  intervalId = setInterval(() => { if (client) syncNow(); }, ms);
}

module.exports = {
  init,
  getClient,
  isConfigured,
  setNotifier,
  testConnection,
  normalizeUrl,
  syncNow,
  status,
  scheduleSoon,
  startAuto,
};
