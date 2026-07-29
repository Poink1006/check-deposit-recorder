'use strict';

/**
 * settings.js — Settings / Backup screen.
 *
 *  - Default header values pre-filled on new deposits.
 *  - Where the database file lives (+ open its folder).
 *  - Backup (export a copy), restore (replace from a backup), CSV export.
 */

import { toast, esc } from './util.js';
import { navigate } from './app.js';

export async function renderSettings(view) {
  const [dbPath, syncCfg] = await Promise.all([
    window.api.getDbPath(),
    window.api.getSyncConfig(),
  ]);

  view.innerHTML = `
    <div class="view-head"><h2>Settings</h2></div>

    <section class="card">
      <h3>Sync (Supabase)</h3>
      <p class="muted">
        Connect this computer to your shared office database so deposits sync
        across all machines. Paste the Project URL and the publishable
        (<code>sb_publishable_…</code>) key. Enter this once per computer.
      </p>
      <div class="field-grid">
        <label class="field field-wide">
          <span>Project URL</span>
          <input type="text" id="y-url" placeholder="https://xxxx.supabase.co" />
        </label>
        <label class="field field-wide">
          <span>Publishable key</span>
          <input type="password" id="y-key" placeholder="sb_publishable_…" />
        </label>
      </div>
      <div class="calib-actions">
        <button class="btn" id="y-save">Save &amp; test connection</button>
        <button class="btn btn-ghost" id="y-sync">Sync now</button>
        <span class="muted" id="y-status"></span>
      </div>
    </section>

    <section class="card">
      <h3>Database</h3>
      <p class="muted">Your deposits are stored locally in this file:</p>
      <p><code id="s-dbpath">${esc(dbPath)}</code></p>
      <div class="calib-actions"><button class="btn btn-ghost" id="s-openfolder">Open containing folder</button></div>
    </section>

    <section class="card">
      <h3>Backup &amp; restore</h3>
      <p class="muted">
        Export a complete copy of your database, or restore from a previous
        backup. Restoring <b>replaces</b> all current data.
      </p>
      <div class="calib-actions">
        <button class="btn" id="s-export">Export backup (.db)…</button>
        <button class="btn btn-ghost" id="s-restore">Restore from backup…</button>
      </div>
    </section>

    <section class="card">
      <h3>Export to CSV</h3>
      <p class="muted">One row per cash/check line, for a date range (leave blank for everything).</p>
      <div class="filter-bar">
        <label class="field"><span>From</span><input type="date" id="s-from" /></label>
        <label class="field"><span>To</span><input type="date" id="s-to" /></label>
        <button class="btn" id="s-csv">Export CSV…</button>
      </div>
    </section>`;

  const $ = (s) => view.querySelector(s);

  // --- Sync config ---
  $('#y-url').value = syncCfg.url || '';
  $('#y-key').value = syncCfg.key || '';
  $('#y-save').addEventListener('click', async () => {
    const status = $('#y-status');
    status.textContent = 'Saving…';
    await window.api.saveSyncConfig({ url: $('#y-url').value, key: $('#y-key').value });
    const res = await window.api.testSync();
    if (res.ok) {
      status.textContent = `Connected ✓ (${res.count} deposit(s) in the shared database).`;
      toast('Sync connected.', 'success');
    } else {
      status.textContent = 'Connection failed: ' + res.error;
      toast('Sync connection failed.', 'error');
    }
  });

  $('#y-sync').addEventListener('click', async () => {
    const status = $('#y-status');
    status.textContent = 'Syncing…';
    const res = await window.api.syncNow();
    if (res.ok) {
      status.textContent = `Synced ✓ (pushed ${res.pushed}, pulled ${res.pulled}).`;
      toast('Sync complete.', 'success');
    } else {
      status.textContent = 'Sync failed: ' + res.error;
      toast('Sync failed.', 'error');
    }
  });

  $('#s-openfolder').addEventListener('click', () => window.api.openDbFolder());

  $('#s-export').addEventListener('click', async () => {
    const res = await window.api.exportBackup();
    if (res && !res.canceled) toast('Backup saved: ' + res.filePath, 'success');
  });

  $('#s-restore').addEventListener('click', async () => {
    if (!confirm('Restore will REPLACE all current deposits with the backup file.\nContinue?')) return;
    try {
      const res = await window.api.restoreBackup();
      if (res && !res.canceled) {
        toast(`Restored ${res.deposits} deposit(s) from backup.`, 'success');
        navigate('history'); // reload against the restored database
      }
    } catch (err) {
      toast('Restore failed: ' + err.message, 'error');
    }
  });

  $('#s-csv').addEventListener('click', async () => {
    const filters = { from: $('#s-from').value, to: $('#s-to').value };
    const res = await window.api.exportCsv(filters);
    if (res && !res.canceled) toast('CSV saved: ' + res.filePath, 'success');
  });
}
