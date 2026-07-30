'use strict';

/**
 * deposit-form.js — the New / Edit Deposit screen.
 *
 * The screen is DATE-DRIVEN: pick a date and it loads the saved deposit for
 * that date (if any) so you can view/edit it in place; saving updates it rather
 * than creating a duplicate. If no deposit exists for the date, it's a blank
 * form that saves as new.
 *
 * The entry area mirrors the RCBC slip: a single table with CASH on the left
 * and CHECKS on the right, each split into two columns of 12 (lines 1–12 and
 * 13–24). Every cell is just an amount box.
 */

import { peso, money, todayISO, toast } from './util.js';
import { openPrintPreview } from './print.js';

const ROWS = 12; // 12 rows × (2 cash + 2 check columns) = 24 cash + 24 check lines

let editingId = null;      // id of the deposit currently loaded, or null (new)
let editingDeposit = null; // the loaded record (to preserve hidden header fields)

/**
 * Render the deposit form into `container`.
 * Pass { deposit } to open a specific record (e.g. from History → Edit);
 * otherwise it opens on today and loads today's deposit if one exists.
 */
export function renderDepositForm(container, opts = {}) {
  let initialDeposit = opts.deposit || null;
  let currentDate = initialDeposit ? initialDeposit.deposit_date : todayISO();
  let formDirty = false; // any unsaved amount edits since the last load/save

  container.innerHTML = `
    <div class="view-head">
      <h2>Deposit</h2>
    </div>

    <section class="card">
      <div class="field-grid">
        <label class="field">
          <span>Deposit date <em>*</em></span>
          <input type="date" id="f-date" />
        </label>
      </div>
      <p class="date-hint" id="date-hint"></p>
    </section>

    <section class="card">
      <table class="slip-table">
        <thead>
          <tr class="slip-sections">
            <th colspan="4">CASH</th>
            <th class="slip-gap"></th>
            <th colspan="4">CHECKS</th>
          </tr>
          <tr class="slip-cols">
            <th class="lineno">#</th><th>Amount</th>
            <th class="lineno">#</th><th>Amount</th>
            <th class="slip-gap"></th>
            <th class="lineno">#</th><th>Amount</th>
            <th class="lineno">#</th><th>Amount</th>
          </tr>
        </thead>
        <tbody id="slip-body"></tbody>
        <tfoot>
          <tr class="slip-totals">
            <td colspan="4">Cash total: <strong id="cash-total">₱ 0.00</strong></td>
            <td class="slip-gap"></td>
            <td colspan="4">Checks total: <strong id="check-total">₱ 0.00</strong></td>
          </tr>
        </tfoot>
      </table>
    </section>

    <div class="totals-bar">
      <div class="totals-nums">
        <span>Cash <strong id="bar-cash">₱ 0.00</strong></span>
        <span>Checks <strong id="bar-check">₱ 0.00</strong></span>
        <span class="grand">Grand total <strong id="bar-grand">₱ 0.00</strong></span>
      </div>
      <div class="totals-actions">
        <button class="btn btn-ghost" id="btn-clear">Clear</button>
        <button class="btn btn-ghost" id="btn-print">Preview / Print</button>
        <button class="btn" id="btn-save">Save deposit</button>
      </div>
    </div>
  `;

  const body = container.querySelector('#slip-body');
  const dateEl = container.querySelector('#f-date');
  const amt = (section, line) =>
    `<td class="amt"><input type="number" class="amount-input" step="0.01" min="0"
       inputmode="decimal" data-section="${section}" data-line="${line}" /></td>`;

  // 12 rows; each row: [cash L, cash R, gap, check L, check R].
  let rowsHtml = '';
  for (let r = 1; r <= ROWS; r++) {
    rowsHtml += `<tr>
      <td class="lineno">${r}</td>${amt('CASH', r)}
      <td class="lineno">${r + ROWS}</td>${amt('CASH', r + ROWS)}
      <td class="slip-gap"></td>
      <td class="lineno">${r}</td>${amt('CHECK', r)}
      <td class="lineno">${r + ROWS}</td>${amt('CHECK', r + ROWS)}
    </tr>`;
  }
  body.innerHTML = rowsHtml;

  const inputs = [...body.querySelectorAll('.amount-input')];

  // Fill (or clear) the amount cells from a deposit record.
  function fillFrom(dep) {
    inputs.forEach((i) => { i.value = ''; i.classList.remove('invalid'); });
    if (dep) {
      for (const it of dep.items) {
        const el = body.querySelector(
          `.amount-input[data-section="${it.section}"][data-line="${it.line_no}"]`
        );
        if (el) el.value = it.amount;
      }
    }
  }

  // Reflect whether we're editing an existing deposit or starting a new one.
  function updateModeUI() {
    container.querySelector('#btn-save').textContent = editingId ? 'Save changes' : 'Save deposit';
    const hint = container.querySelector('#date-hint');
    hint.textContent = editingId
      ? 'Showing the saved deposit for this date — your edits will update it.'
      : 'No deposit for this date yet — this will be saved as new.';
    hint.className = 'date-hint ' + (editingId ? 'existing' : 'fresh');
  }

  // Load the deposit for a date into the form (or blank it if none).
  async function loadForDate(date) {
    let dep = null;
    if (initialDeposit && initialDeposit.deposit_date === date) dep = initialDeposit;
    else dep = await window.api.getDepositByDate(date);
    initialDeposit = null; // only honoured on the first load

    editingDeposit = dep;
    editingId = dep ? dep.id : null;
    fillFrom(dep);
    formDirty = false;
    currentDate = date;
    updateModeUI();
    recomputeTotals(container);
  }

  // ---- wiring ----
  dateEl.value = currentDate;

  dateEl.addEventListener('change', async () => {
    const newDate = dateEl.value;
    if (!newDate) return;
    if (formDirty && !confirm('Discard your unsaved changes and load the deposit for this date?')) {
      dateEl.value = currentDate; // revert
      return;
    }
    await loadForDate(newDate);
  });

  container.addEventListener('input', (e) => {
    if (e.target.classList.contains('amount-input')) {
      e.target.classList.remove('invalid');
      formDirty = true;
      recomputeTotals(container);
    }
  });

  // Enter / Arrow move between cells (same column) instead of nudging the value.
  body.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('amount-input')) return;
    let target = null;
    const i = inputs.indexOf(e.target);
    if (e.key === 'ArrowDown' || e.key === 'Enter') target = inputs[i + 4];
    else if (e.key === 'ArrowUp') target = inputs[i - 4];
    else return;
    e.preventDefault();
    if (target) { target.focus(); target.select(); }
  });

  container.querySelector('#btn-clear').addEventListener('click', () => {
    if (confirm('Clear the amounts on this screen?')) {
      fillFrom(null);
      formDirty = true;
      recomputeTotals(container);
    }
  });

  container.querySelector('#btn-print').addEventListener('click', () => previewCurrent(container));

  container.querySelector('#btn-save').addEventListener('click', async () => {
    const date = dateEl.value;
    if (!date) { toast('Deposit date is required.', 'error'); dateEl.focus(); return; }

    const { items, hadError } = collectItems(container);
    if (hadError) { toast('Some amounts are not valid positive numbers (highlighted).', 'error'); return; }
    if (items.length === 0) { toast('Enter at least one cash or check amount before saving.', 'error'); return; }

    const header = readHeader(container);
    try {
      if (editingId) {
        await window.api.updateDeposit(editingId, header, items);
        toast('Saved changes.', 'success');
      } else {
        await window.api.createDeposit(header, items);
        toast(`Saved deposit (${items.length} lines).`, 'success');
      }
      await loadForDate(date); // refresh — now in edit mode for this date
    } catch (err) {
      toast('Save failed: ' + err.message, 'error');
    }
  });

  // Initial load for the opening date.
  loadForDate(currentDate);
}

// ---- helpers (operate on the container, no closure state) -------------------

function sumSection(container, section) {
  let sum = 0;
  for (const input of container.querySelectorAll(`.amount-input[data-section="${section}"]`)) {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v > 0) sum += v;
  }
  return money(sum);
}

function recomputeTotals(container) {
  const cash = sumSection(container, 'CASH');
  const check = sumSection(container, 'CHECK');
  const grand = money(cash + check);

  container.querySelector('#cash-total').textContent = peso(cash);
  container.querySelector('#check-total').textContent = peso(check);
  container.querySelector('#bar-cash').textContent = peso(cash);
  container.querySelector('#bar-check').textContent = peso(check);
  container.querySelector('#bar-grand').textContent = peso(grand);
}

// Gather non-empty amounts as items, validating each. Returns { items, hadError }.
function collectItems(container) {
  const items = [];
  let hadError = false;
  for (const input of container.querySelectorAll('.amount-input')) {
    const raw = input.value.trim();
    if (raw === '') continue;
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) {
      input.classList.add('invalid');
      hadError = true;
      continue;
    }
    items.push({
      section: input.dataset.section,
      line_no: Number(input.dataset.line),
      amount: money(v),
    });
  }
  return { items, hadError };
}

function readHeader(container) {
  const header = { deposit_date: container.querySelector('#f-date').value };
  // The header only captures the date on screen. When editing, carry the
  // record's other (no-longer-shown) fields through so an edit never wipes them.
  if (editingDeposit) {
    header.bank = editingDeposit.bank;
    header.account_name = editingDeposit.account_name;
    header.account_number = editingDeposit.account_number;
    header.reference_no = editingDeposit.reference_no;
    header.notes = editingDeposit.notes;
  }
  return header;
}

// Build a deposit-like object from the current form (no save) and open preview.
function previewCurrent(container) {
  const { items, hadError } = collectItems(container);
  if (hadError) { toast('Fix the highlighted amounts before printing.', 'error'); return; }
  if (items.length === 0) { toast('Add at least one amount before printing.', 'warn'); return; }
  openPrintPreview({ deposit_date: container.querySelector('#f-date').value, items });
}
