'use strict';

/**
 * deposit-form.js — the New / Edit Deposit screen.
 *
 * The entry area mirrors the RCBC slip one-to-one: a SINGLE table with CASH on
 * the left and CHECKS on the right, each split into two columns of 12 (lines
 * 1–12 and 13–24). Every cell is just an amount box — you type numbers, nothing
 * else. Line numbers are fixed labels. Totals update live.
 *
 * Each row holds four amount inputs in this order: cash 1–12, cash 13–24,
 * check 1–12, check 13–24 — so pressing Enter jumps straight down a column.
 */

import { peso, money, todayISO, toast } from './util.js';
import { openPrintPreview } from './print.js';

const ROWS = 12; // 12 rows × (2 cash + 2 check columns) = 24 cash + 24 check lines

let editingId = null;       // null = creating; otherwise editing this deposit id
let editingDeposit = null;  // the record being edited (to preserve hidden header fields)

/**
 * Render the deposit form into `container`.
 * Pass { deposit } (as returned by getDeposit) to open in edit mode.
 */
export function renderDepositForm(container, opts = {}) {
  const deposit = opts.deposit || null;
  editingId = deposit ? deposit.id : null;
  editingDeposit = deposit;

  container.innerHTML = `
    <div class="view-head">
      <h2>${editingId ? 'Edit deposit #' + editingId : 'New deposit'}</h2>
    </div>

    <section class="card">
      <div class="field-grid">
        <label class="field">
          <span>Deposit date <em>*</em></span>
          <input type="date" id="f-date" />
        </label>
      </div>
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
        <button class="btn" id="btn-save">${editingId ? 'Save changes' : 'Save deposit'}</button>
      </div>
    </div>
  `;

  const body = container.querySelector('#slip-body');
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

  // ---- date + edit population ----
  container.querySelector('#f-date').value = deposit ? deposit.deposit_date : todayISO();

  if (deposit) {
    // Edit mode: drop each item's amount into its matching cell by section+line.
    for (const it of deposit.items) {
      const input = body.querySelector(
        `.amount-input[data-section="${it.section}"][data-line="${it.line_no}"]`
      );
      if (input) input.value = it.amount;
    }
  }

  recomputeTotals(container);

  // ---- wiring ----
  container.querySelector('#btn-clear').addEventListener('click', () => {
    if (confirm('Clear the form and start a new deposit?')) renderDepositForm(container);
  });
  container.querySelector('#btn-save').addEventListener('click', () => save(container));
  container.querySelector('#btn-print').addEventListener('click', () => previewCurrent(container));

  // Live totals + clear invalid highlight on edit.
  container.addEventListener('input', (e) => {
    if (e.target.classList.contains('amount-input')) {
      e.target.classList.remove('invalid');
      recomputeTotals(container);
    }
  });

  // Move between cells with the arrow keys instead of nudging the number value.
  // Each row has 4 amount inputs, so up/down is ±4 in the flat list; Enter also
  // steps down. Left/Right keep their normal text-cursor behaviour.
  const inputs = [...body.querySelectorAll('.amount-input')];
  body.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('amount-input')) return;
    let target = null;
    const i = inputs.indexOf(e.target);
    if (e.key === 'ArrowDown' || e.key === 'Enter') target = inputs[i + 4];
    else if (e.key === 'ArrowUp') target = inputs[i - 4];
    else return;
    e.preventDefault(); // stop the number input from incrementing/decrementing
    if (target) { target.focus(); target.select(); }
  });
}

// ---- helpers ---------------------------------------------------------------

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
  // The header now only captures the date. When editing, carry the record's
  // other (no-longer-shown) fields through so an edit never wipes them; new
  // deposits let the DB apply its defaults (bank 'RCBC', the rest null).
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

async function save(container) {
  const date = container.querySelector('#f-date').value;
  if (!date) {
    toast('Deposit date is required.', 'error');
    container.querySelector('#f-date').focus();
    return;
  }

  const { items, hadError } = collectItems(container);
  if (hadError) {
    toast('Some amounts are not valid positive numbers (highlighted).', 'error');
    return;
  }
  if (items.length === 0) {
    toast('Enter at least one cash or check amount before saving.', 'error');
    return;
  }

  const header = readHeader(container);
  try {
    if (editingId) {
      await window.api.updateDeposit(editingId, header, items);
      toast(`Saved changes to deposit #${editingId}.`, 'success');
    } else {
      const id = await window.api.createDeposit(header, items);
      toast(`Saved deposit #${id} (${items.length} lines).`, 'success');
      renderDepositForm(container); // fresh form for the next entry
    }
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}
