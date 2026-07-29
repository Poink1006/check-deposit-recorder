'use strict';

/**
 * sync-status.js — the header sync badge.
 *
 * Shows "Synced", "N pending", "Syncing…", or "Offline" based on the main
 * process's sync state, and clicking it forces a sync now. Hidden entirely when
 * sync isn't configured (the app still works as a purely local recorder).
 */

export function initSyncStatus() {
  if (!window.api || !window.api.getSyncStatus) return;

  const tag = document.createElement('button');
  tag.className = 'sync-tag';
  tag.title = 'Click to sync now';
  tag.style.display = 'none';
  document.querySelector('.app-header').appendChild(tag);

  const render = (st) => {
    if (!st || !st.configured) { tag.style.display = 'none'; return; }
    tag.style.display = '';
    let label = 'Synced';
    let cls = 'ok';
    const realError = st.lastError && !['busy', 'not_configured'].includes(st.lastError);
    if (realError) { label = 'Offline'; cls = 'warn'; }
    else if (st.pending > 0) { label = `${st.pending} pending`; cls = 'pending'; }
    tag.textContent = '⟳ ' + label;
    tag.className = 'sync-tag ' + cls;
    tag.title = realError ? 'Sync error: ' + st.lastError + ' — click to retry'
      : st.lastSync ? 'Last synced ' + new Date(st.lastSync).toLocaleTimeString() + ' — click to sync now'
      : 'Click to sync now';
  };

  tag.addEventListener('click', async () => {
    tag.textContent = '⟳ Syncing…';
    tag.className = 'sync-tag syncing';
    await window.api.syncNow();
    render(await window.api.getSyncStatus());
  });

  window.api.onSyncStatus(render);
  window.api.getSyncStatus().then(render);
}
