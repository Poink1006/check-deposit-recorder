'use strict';

/**
 * print-layout.js — builds the printable deposit slip as a standalone HTML
 * document, positioned in MILLIMETRES so it lands inside the bank form's
 * pre-printed boxes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * GEOMETRY (measured from RCBC-PIKUP-TEMPLATE.xlsx, print area A1:J52)
 * ────────────────────────────────────────────────────────────────────────────
 * Paper: US Legal, portrait = 215.9 mm × 355.6 mm. Excel margins were 0.2" side
 * / 0.25" top-bottom, but for printing we drive every number by absolute page
 * coordinates and set the printer margins to 0, so margins don't enter the math.
 *
 * The number block sits LOW on the page on purpose (rows 38–50 in the sheet):
 * the first data row's top is ~199.7 mm down, with a ~5.05 mm row pitch, 12 rows.
 *
 * Across the width there are four [line# + amount] column pairs:
 *     CASH  lines 1–12  -> pair 0     CASH  lines 13–24 -> pair 1
 *     CHECK lines 1–12  -> pair 2     CHECK lines 13–24 -> pair 3
 * Each pair has a line-number sub-column (numbers centered) and an amount
 * sub-column (numbers right-aligned). The x-values below are the Excel column
 * boundaries converted to mm.
 *
 * CALIBRATION: every printer feeds paper a little differently, so the whole
 * positioned layer is shifted by (offsetX, offsetY) mm and optionally stretched
 * by (scaleX, scaleY). Position of a point p becomes  offset + scale · p
 * (transform-origin at the page's top-left). These values are saved per install.
 */

// Legal paper, portrait (mm).
export const PAGE = { w: 215.9, h: 355.6 };

// Vertical layout of the 12-row block (mm).
const ROW_TOP = 199.7;   // top of line 1
const ROW_PITCH = 5.05;  // distance between line tops
const ROW_H = 5.05;      // used as line-height so text centres in its row
const ROWS = 12;

// Font size for printed numbers (mm ≈ pt; ~10pt to fit the boxes).
const FONT_MM = 3.5;

/**
 * The four column pairs. For each:
 *   numCenter — x of the line-number (text-align center)
 *   amtRight  — x of the amount's right edge (text-align right, 2 mm inset)
 *   numCol / amtCol — [left,right] sub-column bounds, used to draw the grid.
 */
const PAIRS = [
  { numCenter: 31.1,  amtRight: 63.4,  numCol: [25.7, 36.5],   amtCol: [36.5, 65.4] },   // CASH 1–12
  { numCenter: 70.8,  amtRight: 110.9, numCol: [65.4, 76.2],   amtCol: [76.2, 112.9] },  // CASH 13–24
  { numCenter: 118.3, amtRight: 151.2, numCol: [112.9, 123.7], amtCol: [123.7, 153.2] }, // CHECK 1–12
  { numCenter: 158.6, amtRight: 189.4, numCol: [153.2, 164.0], amtCol: [164.0, 191.4] }, // CHECK 13–24
];

// Section blocks (for grid borders + labels in full-form / alignment modes).
const BLOCKS = [
  { label: 'CASH', left: 25.7, right: 112.9 },   // pairs 0+1
  { label: 'CHECKS', left: 112.9, right: 191.4 }, // pairs 2+3
];
const BLOCK_TOP = ROW_TOP;
const BLOCK_BOTTOM = ROW_TOP + ROWS * ROW_PITCH;
const LABEL_TOP = ROW_TOP - 6.5; // section labels sit just above the grid

// Which pair a (section, line_no) belongs to, and its row y (mm).
function locate(section, lineNo) {
  const pairIndex = (section === 'CASH' ? 0 : 2) + (lineNo <= 12 ? 0 : 1);
  const rowInBlock = (lineNo - 1) % 12; // 0..11
  return { pair: PAIRS[pairIndex], y: ROW_TOP + rowInBlock * ROW_PITCH };
}

// Amount as it prints on the slip: comma thousands, 2 decimals, NO symbol
// (matches the Excel "Comma" number format numFmtId 43).
function amountStr(n) {
  return Number(n).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// A centred line-number element at (x, y).
function numCell(x, y, text) {
  return `<div class="cell num" style="left:${x}mm;top:${y}mm">${esc(text)}</div>`;
}
// A right-aligned amount element ending at right-edge x, at y.
function amtCell(xRight, y, text) {
  return `<div class="cell amt" style="left:${xRight}mm;top:${y}mm">${esc(text)}</div>`;
}

/**
 * Build the positioned NUMBER layer.
 * opts.placeholders = true prints "0.00" at every amount slot (alignment grid).
 * Line numbers 1–24 are printed for both sections (as the Excel template does);
 * amounts are printed only where an item exists (or everywhere if placeholders).
 */
function numberLayer(deposit, opts = {}) {
  const byKey = new Map();
  for (const it of deposit.items || []) {
    if (Number(it.amount) > 0) byKey.set(`${it.section}:${it.line_no}`, it);
  }

  let html = '';
  for (const section of ['CASH', 'CHECK']) {
    for (let line = 1; line <= 24; line++) {
      const { pair, y } = locate(section, line);
      html += numCell(pair.numCenter, y, String(line));
      const item = byKey.get(`${section}:${line}`);
      if (opts.placeholders) {
        html += amtCell(pair.amtRight, y, '0.00');
      } else if (item) {
        html += amtCell(pair.amtRight, y, amountStr(item.amount));
      }
    }
  }
  return html;
}

/** Build the GRID layer (borders + section labels) for full-form / alignment. */
function gridLayer() {
  let html = '';

  // Section labels.
  for (const b of BLOCKS) {
    const cx = (b.left + b.right) / 2;
    html += `<div class="glabel" style="left:${b.left}mm;top:${LABEL_TOP}mm;width:${b.right - b.left}mm">${b.label}</div>`;
  }

  const height = BLOCK_BOTTOM - BLOCK_TOP;

  // Horizontal rules across the whole block width, one per row boundary.
  for (let r = 0; r <= ROWS; r++) {
    const y = BLOCK_TOP + r * ROW_PITCH;
    html += `<div class="hline" style="left:${BLOCKS[0].left}mm;top:${y}mm;width:${BLOCKS[1].right - BLOCKS[0].left}mm"></div>`;
  }

  // Vertical rules at every sub-column boundary (pair edges + inner splits).
  const xs = new Set();
  for (const p of PAIRS) {
    xs.add(p.numCol[0]); xs.add(p.numCol[1]); xs.add(p.amtCol[1]);
  }
  for (const x of xs) {
    html += `<div class="vline" style="left:${x}mm;top:${BLOCK_TOP}mm;height:${height}mm"></div>`;
  }
  return html;
}

/** Build a mm ruler layer (fixed to the page) for the alignment test sheet. */
function rulerLayer() {
  let html = '<div class="ruler">';
  // Vertical minor/major lines every 5/10 mm with x labels along the top.
  for (let x = 0; x <= Math.floor(PAGE.w); x += 5) {
    const major = x % 10 === 0;
    html += `<div class="rline v ${major ? 'major' : ''}" style="left:${x}mm;top:0;height:${PAGE.h}mm"></div>`;
    if (major && x > 0) html += `<div class="rlabel v" style="left:${x}mm;top:1mm">${x}</div>`;
  }
  // Horizontal minor/major lines every 5/10 mm with y labels along the left.
  for (let y = 0; y <= Math.floor(PAGE.h); y += 5) {
    const major = y % 10 === 0;
    html += `<div class="rline h ${major ? 'major' : ''}" style="top:${y}mm;left:0;width:${PAGE.w}mm"></div>`;
    if (major && y > 0) html += `<div class="rlabel h" style="top:${y}mm;left:1mm">${y}</div>`;
  }
  html += '</div>';
  return html;
}

// Shared document CSS. `mode`/`calib` drive the calibrated transform.
function docShell(calib, bodyHtml, extraCss = '') {
  const { offsetX = 0, offsetY = 0, scaleX = 1, scaleY = 1 } = calib || {};
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: Legal portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    .sheet {
      position: relative;
      width: ${PAGE.w}mm;
      height: ${PAGE.h}mm;
      background: #fff;
      overflow: hidden;
      font-family: Arial, "Segoe UI", sans-serif;
      color: #000;
    }
    /* Calibrated layer: shift then scale about the page's top-left corner. */
    .calib {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      transform: translate(${offsetX}mm, ${offsetY}mm) scale(${scaleX}, ${scaleY});
    }
    .cell {
      position: absolute;
      font-size: ${FONT_MM}mm;
      line-height: ${ROW_H}mm;
      height: ${ROW_H}mm;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .cell.num { transform: translateX(-50%); text-align: center; }
    .cell.amt { transform: translateX(-100%); text-align: right; }
    .glabel { position: absolute; text-align: center; font-weight: 700; font-size: 3.4mm; }
    .hline { position: absolute; border-top: 0.2mm solid #000; }
    .vline { position: absolute; border-left: 0.2mm solid #000; }
    ${extraCss}
    /* On-screen preview: dark backdrop + scaled page. Print stays 1:1. */
    @media screen {
      body { background: #525659; display: flex; justify-content: center; padding: 14px 0; }
      .sheet { box-shadow: 0 0 10px rgba(0,0,0,.55); transform: scale(var(--preview-scale, 0.62)); transform-origin: top center; }
    }
    @media print { body { background: #fff; } .sheet { transform: none; } }
  </style></head><body><div class="sheet">${bodyHtml}</div></body></html>`;
}

/**
 * Build the deposit slip document.
 * mode: 'overlay' (numbers only) | 'full' (numbers + grid + labels).
 */
export function buildDepositSheet(deposit, calib, mode = 'overlay') {
  const grid = mode === 'full' ? gridLayer() : '';
  const nums = numberLayer(deposit);
  const body = `<div class="calib">${grid}${nums}</div>`;
  return docShell(calib, body);
}

/**
 * Build the alignment / calibration test sheet: a mm ruler (fixed to the page)
 * with the full cell grid and "0.00" placeholders at every slot, all under the
 * CURRENT calibration — print it, hold it to the bank form, and nudge offsets.
 */
export function buildAlignmentGrid(calib) {
  const rulerCss = `
    .ruler .rline { position: absolute; }
    .ruler .rline.v { border-left: 0.1mm solid rgba(0,120,200,.25); }
    .ruler .rline.h { border-top: 0.1mm solid rgba(0,120,200,.25); }
    .ruler .rline.major.v { border-left-color: rgba(0,120,200,.7); }
    .ruler .rline.major.h { border-top-color: rgba(0,120,200,.7); }
    .ruler .rlabel { position: absolute; font-size: 2.3mm; color: #0a6; }
    .ruler .rlabel.v { transform: translateX(-50%); }
    .ruler .rlabel.h { transform: translateY(-50%); }`;
  const body =
    rulerLayer() +
    `<div class="calib">${gridLayer()}${numberLayer({ items: [] }, { placeholders: true })}</div>`;
  return docShell(calib, body, rulerCss);
}
