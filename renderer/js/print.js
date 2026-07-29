'use strict';

/**
 * print.js — the Print / Preview modal.
 *
 * Shows the deposit rendered into the real print layout (scaled down on screen),
 * with a toggle between Overlay mode (numbers only, for feeding the bank's
 * pre-printed form) and Full-form mode (grid + labels, for plain paper).
 * The same HTML that previews is the HTML that prints / exports to PDF, so what
 * you see is exactly what lands on paper.
 */

import { buildDepositSheet } from './print-layout.js';
import { toast } from './util.js';

let modalEl = null;

function suggestedPdfName(deposit) {
  const d = deposit.deposit_date || 'deposit';
  const ref = deposit.reference_no ? '-' + deposit.reference_no.replace(/[^\w-]+/g, '_') : '';
  return `deposit-${d}${ref}.pdf`;
}

export async function openPrintPreview(deposit) {
  if (!deposit || !(deposit.items || []).length) {
    toast('Nothing to print — add at least one line first.', 'warn');
    return;
  }

  const calib = await window.api.getCalibration();

  // Build the modal shell once. Always the full form (grid + labels).
  modalEl = document.createElement('div');
  modalEl.className = 'modal-backdrop';
  modalEl.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <strong>Print preview</strong>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-act="pdf">Save as PDF…</button>
        <button class="btn" data-act="print">Print…</button>
        <button class="icon-btn" data-act="close" title="Close">×</button>
      </div>
      <div class="modal-hint muted">
        The deposit slip with grid &amp; labels. Position on the page is
        controlled by <b>Calibration</b>.
      </div>
      <div class="modal-body">
        <iframe class="preview-frame" title="Deposit slip preview"></iframe>
      </div>
    </div>`;

  const frame = modalEl.querySelector('.preview-frame');
  const html = () => buildDepositSheet(deposit, calib, 'full');
  frame.srcdoc = html();

  modalEl.querySelector('[data-act="close"]').addEventListener('click', close);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
  document.addEventListener('keydown', onEsc);

  modalEl.querySelector('[data-act="print"]').addEventListener('click', async () => {
    const res = await window.api.printSheet(html());
    if (res && res.success === false && res.failureReason && res.failureReason !== 'cancelled') {
      toast('Print failed: ' + res.failureReason, 'error');
    }
  });

  modalEl.querySelector('[data-act="pdf"]').addEventListener('click', async () => {
    const res = await window.api.savePdf(html(), suggestedPdfName(deposit));
    if (res && !res.canceled) toast('Saved PDF: ' + res.filePath, 'success');
  });

  document.body.appendChild(modalEl);
}

function onEsc(e) {
  if (e.key === 'Escape') close();
}

function close() {
  document.removeEventListener('keydown', onEsc);
  if (modalEl) modalEl.remove();
  modalEl = null;
}
