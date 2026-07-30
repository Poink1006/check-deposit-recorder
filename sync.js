'use strict';

/**
 * sync.js — Supabase client, shared-account auth, and offline sync (main).
 *
 * Connection is embedded (config.js). Data is protected by RLS that requires an
 * authenticated user, so each computer signs in ONCE with the shared office
 * account; the session is persisted locally (in the settings table) and
 * auto-refreshed, so no repeated logins.
 *
 * Local SQLite stays the working store (fully offline). When signed in and
 * online, the engine pushes locally-changed deposits and pulls remote ones
 * (last-write-wins by updated_at; soft-deletes propagate).
 */

// Electron's main-process Node (v20) has no global WebSocket, and supabase-js's
// realtime client throws on load without one. We don't use realtime (we poll),
// but provide `ws` so the client constructs cleanly.
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch { /* handled by supabase error */ }
}

const { createClient } = require('@supabase/supabase-js');
const db = require('./db');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = require('./config');

let client = null;
let lastSync = null;
let lastError = null;
let syncing = false;
let notifier = null;
let intervalId = null;
let soonTimer = null;

// Persist the auth session in the local settings table (main has no localStorage).
const authStorage = {
  getItem: (k) => {
    const v = db.getSetting('auth:' + k, null);
    return v == null ? null : v; // stored/returned as the original string
  },
  setItem: (k, val) => db.setSetting('auth:' + k, val),
  removeItem: (k) => db.deleteSetting('auth:' + k),
};

/** Create the Supabase client from the embedded config (idempotent). */
function init() {
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: authStorage,
    },
  });
  return client;
}

function getClient() {
  return client;
}
function setNotifier(cb) {
  notifier = cb;
}

// ---- auth (shared office account) ------------------------------------------

async function authStatus() {
  if (!client) return { signedIn: false };
  const { data } = await client.auth.getSession();
  const session = data && data.session;
  return { signedIn: !!session, email: session ? session.user.email : null };
}

async function signIn(email, password) {
  if (!client) return { ok: false, error: 'not_ready' };
  const { data, error } = await client.auth.signInWithPassword({
    email: (email || '').trim(),
    password: password || '',
  });
  if (error) return { ok: false, error: error.message };
  scheduleSoon(); // pull shared data right after logging in
  return { ok: true, email: data.user.email };
}

async function signOut() {
  if (!client) return { ok: true };
  await client.auth.signOut();
  return { ok: true };
}

// ---- row mapping -----------------------------------------------------------

function toRemoteDeposit(d) {
  return {
    id: d.id, deposit_date: d.deposit_date, bank: d.bank,
    account_name: d.account_name ?? null, account_number: d.account_number ?? null,
    reference_no: d.reference_no ?? null, notes: d.notes ?? null,
    cash_total: d.cash_total ?? 0, check_total: d.check_total ?? 0, grand_total: d.grand_total ?? 0,
    created_at: d.created_at, updated_at: d.updated_at, deleted_at: d.deleted_at ?? null,
  };
}
function toRemoteItem(it, depositId) {
  return {
    id: it.id, deposit_id: depositId, section: it.section, line_no: it.line_no, amount: it.amount,
    check_no: it.check_no ?? null, drawee_bank: it.drawee_bank ?? null,
    check_date: it.check_date ?? null, remarks: it.remarks ?? null,
  };
}

async function pushDirty() {
  const dirty = db.getDirtyDeposits();
  if (!dirty.length) return { pushed: 0 };
  const pushed = [];
  for (const d of dirty) {
    const { error: e1 } = await client.from('deposits').upsert(toRemoteDeposit(d), { onConflict: 'id' });
    if (e1) throw new Error('push deposit: ' + e1.message);
    const { error: e2 } = await client.from('deposit_items').delete().eq('deposit_id', d.id);
    if (e2) throw new Error('push items (delete): ' + e2.message);
    if (!d.deleted_at && d.items.length) {
      const { error: e3 } = await client.from('deposit_items').insert(d.items.map((it) => toRemoteItem(it, d.id)));
      if (e3) throw new Error('push items (insert): ' + e3.message);
    }
    pushed.push({ id: d.id, updated_at: d.updated_at });
  }
  db.clearDirty(pushed);
  return { pushed: pushed.length };
}

async function pull() {
  const watermark = db.getWatermark();
  let query = client.from('deposits').select('*').order('updated_at', { ascending: true });
  if (watermark) query = query.gt('updated_at', watermark);
  const { data: remoteDeps, error } = await query;
  if (error) throw new Error('pull deposits: ' + error.message);

  let applied = 0, maxStr = watermark, maxNum = watermark ? Date.parse(watermark) : -Infinity;
  for (const rd of remoteDeps || []) {
    const rNum = Date.parse(rd.updated_at);
    if (rNum > maxNum) { maxNum = rNum; maxStr = rd.updated_at; }
    const local = db.getDepositMeta(rd.id);
    if (local && !(rNum > Date.parse(local.updated_at))) continue;
    let items = [];
    if (!rd.deleted_at) {
      const { data: ri, error: ei } = await client.from('deposit_items').select('*').eq('deposit_id', rd.id);
      if (ei) throw new Error('pull items: ' + ei.message);
      items = ri || [];
    }
    db.applyRemote(rd, items);
    applied++;
  }
  if (maxStr) db.setWatermark(maxStr);
  return { pulled: applied };
}

/** Full sync (requires being signed in). Safe to call anytime. */
async function syncNow() {
  if (!client) return { ok: false, error: 'not_ready' };
  if (syncing) return { ok: false, error: 'busy' };
  const st = await authStatus();
  if (!st.signedIn) return { ok: false, error: 'not_signed_in' };

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

function status() {
  return {
    lastSync,
    lastError,
    pending: (() => { try { return db.getPendingCount(); } catch { return 0; } })(),
  };
}

function scheduleSoon() {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), 1500);
}

function startAuto(ms = 45000) {
  if (intervalId) clearInterval(intervalId);
  syncNow(); // initial (no-op if not signed in)
  intervalId = setInterval(() => syncNow(), ms);
}

module.exports = {
  init, getClient, setNotifier,
  authStatus, signIn, signOut,
  syncNow, status, scheduleSoon, startAuto,
};
