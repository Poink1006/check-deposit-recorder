'use strict';

/**
 * calibration.js — the calibration screen.
 *
 * The whole printed layout can be nudged by X/Y offsets (mm) and finely
 * stretched by per-axis scale factors, saved persistently so you calibrate
 * once per printer/form. A live preview and a printable mm alignment grid let
 * you dial the numbers in: print the grid, hold it against the bank form, and
 * adjust until the sample "0.00" boxes land where the form's boxes are.
 */

import { buildAlignmentGrid } from './print-layout.js';
import { toast } from './util.js';

export async function renderCalibration(view) {
  const calib = await window.api.getCalibration();

  view.innerHTML = `
    <div class="view-head"><h2>Calibration</h2></div>

    <div class="calib-layout">
      <section class="card calib-controls">
        <p class="muted">
          Shift the whole printed layout so your numbers fall inside the bank
          form's boxes. Positive X moves right, positive Y moves down. Scale
          finely stretches spacing (leave at 1.000 unless lines drift apart
          across the page).
        </p>

        <div class="field-grid two">
          <label class="field">
            <span>X offset (mm)</span>
            <input type="number" id="c-x" step="0.5" />
          </label>
          <label class="field">
            <span>Y offset (mm)</span>
            <input type="number" id="c-y" step="0.5" />
          </label>
          <label class="field">
            <span>X scale</span>
            <input type="number" id="c-sx" step="0.001" />
          </label>
          <label class="field">
            <span>Y scale</span>
            <input type="number" id="c-sy" step="0.001" />
          </label>
        </div>

        <div class="nudge">
          <span class="muted">Nudge Y:</span>
          <button class="btn btn-ghost btn-sm" data-nudge="y" data-d="-1">↑ 1 mm</button>
          <button class="btn btn-ghost btn-sm" data-nudge="y" data-d="1">↓ 1 mm</button>
          <span class="muted" style="margin-left:12px">Nudge X:</span>
          <button class="btn btn-ghost btn-sm" data-nudge="x" data-d="-1">← 1 mm</button>
          <button class="btn btn-ghost btn-sm" data-nudge="x" data-d="1">→ 1 mm</button>
        </div>

        <div class="calib-actions">
          <button class="btn" id="c-save">Save calibration</button>
          <button class="btn btn-ghost" id="c-reset">Reset to default</button>
          <button class="btn btn-ghost" id="c-print">Print alignment grid…</button>
          <button class="btn btn-ghost" id="c-pdf">Save grid as PDF…</button>
        </div>
        <p class="muted" id="c-status"></p>
      </section>

      <section class="card calib-preview">
        <div class="section-head"><h3>Alignment grid preview</h3></div>
        <iframe class="preview-frame tall" title="Alignment grid preview"></iframe>
      </section>
    </div>`;

  const $ = (id) => view.querySelector(id);
  const frame = view.querySelector('.preview-frame');

  // Read the current control values into a calibration object.
  const readControls = () => ({
    offsetX: parseFloat($('#c-x').value) || 0,
    offsetY: parseFloat($('#c-y').value) || 0,
    scaleX: parseFloat($('#c-sx').value) || 1,
    scaleY: parseFloat($('#c-sy').value) || 1,
  });

  // Write a calibration object into the controls.
  const writeControls = (c) => {
    $('#c-x').value = c.offsetX;
    $('#c-y').value = c.offsetY;
    $('#c-sx').value = Number(c.scaleX).toFixed(3);
    $('#c-sy').value = Number(c.scaleY).toFixed(3);
  };

  const refresh = () => { frame.srcdoc = buildAlignmentGrid(readControls()); };

  writeControls(calib);
  refresh();

  // Live preview as values change.
  view.querySelectorAll('.calib-controls input').forEach((inp) =>
    inp.addEventListener('input', refresh)
  );

  // Nudge buttons bump an offset by ±1 mm.
  view.querySelectorAll('[data-nudge]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = btn.dataset.nudge === 'x' ? '#c-x' : '#c-y';
      $(id).value = (parseFloat($(id).value) || 0) + Number(btn.dataset.d);
      refresh();
    })
  );

  $('#c-save').addEventListener('click', async () => {
    const saved = await window.api.saveCalibration(readControls());
    writeControls(saved);
    refresh();
    $('#c-status').textContent =
      `Saved: X ${saved.offsetX} mm, Y ${saved.offsetY} mm, scale ${saved.scaleX}×${saved.scaleY}.`;
    toast('Calibration saved.', 'success');
  });

  $('#c-reset').addEventListener('click', () => {
    writeControls({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 });
    refresh();
    $('#c-status').textContent = 'Reset to defaults — click Save to keep.';
  });

  $('#c-print').addEventListener('click', async () => {
    const res = await window.api.printSheet(buildAlignmentGrid(readControls()));
    if (res && res.success === false && res.failureReason && res.failureReason !== 'cancelled') {
      toast('Print failed: ' + res.failureReason, 'error');
    }
  });

  $('#c-pdf').addEventListener('click', async () => {
    const res = await window.api.savePdf(buildAlignmentGrid(readControls()), 'alignment-grid.pdf');
    if (res && !res.canceled) toast('Saved PDF: ' + res.filePath, 'success');
  });
}
