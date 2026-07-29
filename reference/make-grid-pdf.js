'use strict';
// Produce the alignment grid as a print-ready Legal PDF (zero calibration) via
// the real print pipeline. Not shipped. Run: npx electron reference/make-grid-pdf.js
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const OUT = 'C:\\Users\\danie\\Downloads\\alignment-grid.pdf';
const CALIB = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

app.whenReady().then(async () => {
  // Build the grid HTML using the app's real layout module.
  const builder = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  await builder.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 300));
  const html = await builder.webContents.executeJavaScript(`(async () => {
    const pl = await import('./js/print-layout.js');
    return pl.buildAlignmentGrid(${JSON.stringify(CALIB)});
  })()`);
  builder.close();

  // Render at Legal, zero margins, and export to PDF.
  const tmp = path.join(os.tmpdir(), 'cdr-grid.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 300));
  const pdf = await win.webContents.printToPDF({
    pageSize: 'Legal', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  win.close();
  fs.writeFileSync(OUT, pdf);

  // Report page geometry so we know it's true Legal (612 x 1008 pt).
  const m = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
  console.log('Wrote', OUT, '| MediaBox', m ? Math.round(+m[1]) + 'x' + Math.round(+m[2]) : '?', '(expect 612x1008)');
  app.exit(0);
});
