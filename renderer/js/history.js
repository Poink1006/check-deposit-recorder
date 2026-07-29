'use strict';

/**
 * history.js — History / Records screen.
 *
 * Lists deposits newest-first with date-range + free-text filtering, and lets
 * you open any deposit to view its full breakdown, then edit / reprint /
 * duplicate / delete it. Search covers reference, notes, bank, account and the
 * check register (check no / drawee bank / remarks).
 */

import { peso, todayISO, toast, esc } from './util.js';
import { openPrintPreview } from './print.js';
import { editDeposit } from './app.js';

let filters = { from: '', to: '', search: '' };

export function renderHistory(view) {
  view.innerHTML = `
    <div class="view-head"><h2>History</h2></div>

    <section class="card">
      <div class="filter-bar">
        <label class="field">
          <span>From</span>
          <input type="date" id="h-from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" id="h-to" />
        </label>
        <label class="field grow">
          <span>Search</span>
          <input type="text" id="h-search" placeholder="reference, notes, check no, drawee bank…" />
        </label>
        <button class="btn btn-ghost btn-sm" id="h-clear">Clear</button>
      </div>
    </section>

    <section class="card">
      <table class="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Bank</th>
            <th>Reference</th>
            <th class="right">Cash</th>
            <th class="right">Checks</th>
            <th class="right">Grand total</th>
            <th class="right"># items</th>
          </tr>
        </thead>
        <tbody id="h-body"></tbody>
      </table>
    </section>`;

  const fromEl = view.querySelector('#h-from');
  const toEl = view.querySelector('#h-to');
  const searchEl = view.querySelector('#h-search');

  // Restore any filters kept from the last visit this session.
  fromEl.value = filters.from;
  toEl.value = filters.to;
  searchEl.value = filters.search;

  let debounce;
  const reload = async () => {
    filters = { from: fromEl.value, to: toEl.value, search: searchEl.value };
    const rows = await window.api.listDeposits(filters);
    renderRows(view, rows);
  };

  fromEl.addEventListener('change', reload);
  toEl.addEventListener('change', reload);
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(reload, 220);
  });
  view.querySelector('#h-clear').addEventListener('click', () => {
    fromEl.value = ''; toEl.value = ''; searchEl.value = '';
    reload();
  });

  reload();
}

function renderRows(view, rows) {
  const body = view.querySelector('#h-body');
  const filtered = filters.from || filters.to || filters.search;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="muted empty">${
      filtered ? 'No deposits match your filters.' : 'No deposits yet — create one on the New Deposit screen.'
    }</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map(
      (r) => `
      <tr class="row-link" data-id="${r.id}" title="Click to view">
        <td>${r.deposit_date}</td>
        <td>${esc(r.bank)}</td>
        <td>${esc(r.reference_no || '—')}</td>
        <td class="right">${peso(r.cash_total)}</td>
        <td class="right">${peso(r.check_total)}</td>
        <td class="right"><strong>${peso(r.grand_total)}</strong></td>
        <td class="right">${r.item_count}</td>
      </tr>`
    )
    .join('');

  body.querySelectorAll('.row-link').forEach((tr) =>
    tr.addEventListener('click', () => openDetail(view, tr.dataset.id))
  );
}

// ---- detail modal ----------------------------------------------------------

async function openDetail(view, id) {
  const dep = await window.api.getDeposit(id);
  if (!dep) { toast('That deposit no longer exists.', 'error'); return; }

  const cash = dep.items.filter((i) => i.section === 'CASH');
  const checks = dep.items.filter((i) => i.section === 'CHECK');

  const meta = [
    ['Bank', dep.bank],
    ['Account name', dep.account_name],
    ['Account number', dep.account_number],
    ['Reference no', dep.reference_no],
    ['Notes', dep.notes],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><span class="muted">${k}</span><div>${esc(v)}</div></div>`)
    .join('');

  const cashRows = cash.length
    ? cash.map((i) => `<tr><td class="right">${i.line_no}</td><td class="right">${peso(i.amount)}</td></tr>`).join('')
    : `<tr><td colspan="2" class="muted">No cash lines.</td></tr>`;

  const checkRows = checks.length
    ? checks
        .map((i) => `<tr><td class="right">${i.line_no}</td><td class="right">${peso(i.amount)}</td></tr>`)
        .join('')
    : `<tr><td colspan="2" class="muted">No check lines.</td></tr>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal detail-modal">
      <div class="modal-head">
        <strong>Deposit — ${dep.deposit_date}</strong>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="close" title="Close">×</button>
      </div>
      <div class="detail-body">
        <div class="detail-meta">${meta || '<span class="muted">No header details.</span>'}</div>

        <h4>Cash <span class="muted">— ${peso(dep.cash_total)}</span></h4>
        <table class="table compact"><thead><tr><th class="right">#</th><th class="right">Amount</th></tr></thead>
          <tbody>${cashRows}</tbody></table>

        <h4>Checks <span class="muted">— ${peso(dep.check_total)}</span></h4>
        <table class="table compact"><thead><tr>
          <th class="right">#</th><th class="right">Amount</th>
        </tr></thead><tbody>${checkRows}</tbody></table>

        <div class="detail-grand">Grand total <strong>${peso(dep.grand_total)}</strong></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-act="delete">Delete</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-act="duplicate">Duplicate</button>
        <button class="btn btn-ghost" data-act="reprint">Reprint</button>
        <button class="btn" data-act="edit">Edit</button>
      </div>
    </div>`;

  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onEsc); };
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-act="close"]').addEventListener('click', close);

  backdrop.querySelector('[data-act="edit"]').addEventListener('click', () => {
    close();
    editDeposit(dep);
  });

  backdrop.querySelector('[data-act="reprint"]').addEventListener('click', () => {
    openPrintPreview(dep);
  });

  backdrop.querySelector('[data-act="duplicate"]').addEventListener('click', async () => {
    const newId = await window.api.duplicateDeposit(dep.id, todayISO());
    close();
    toast('Duplicated to a new deposit dated today. Opening for edit…', 'success');
    const fresh = await window.api.getDeposit(newId);
    editDeposit(fresh);
  });

  backdrop.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!confirm(`Delete this deposit (${dep.deposit_date}, ${peso(dep.grand_total)})?\nThis cannot be undone.`)) return;
    await window.api.deleteDeposit(dep.id);
    close();
    toast('Deposit deleted.', 'info');
    renderHistory(view); // refresh the list
  });

  document.body.appendChild(backdrop);
}
