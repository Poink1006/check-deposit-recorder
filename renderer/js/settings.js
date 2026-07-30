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
  const [dbPath, auth] = await Promise.all([
    window.api.getDbPath(),
    window.api.authStatus(),
  ]);

  view.innerHTML = `
    <div class="view-head"><h2>Settings</h2></div>

    <section class="card">
      <h3>Sync</h3>
      <p class="muted">
        This computer syncs deposits with the shared office database while
        signed in. Signed in as <strong>${esc(auth.email || '—')}</strong>.
      </p>
      <div class="calib-actions">
        <button class="btn btn-ghost" id="y-sync">Sync now</button>
        <button class="btn btn-ghost" id="y-signout">Sign out</button>
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

  // --- Sync / account ---
  $('#y-signout').addEventListener('click', async () => {
    if (!confirm('Sign out on this computer? You will need the shared login to use it again.')) return;
    await window.api.signOut(); // main sends auth:signedout → app shows the login gate
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
