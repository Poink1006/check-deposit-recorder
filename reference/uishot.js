'use strict';
// Render full-page images of the actual print output (overlay, full-form,
// alignment grid) for visual review. Not shipped. Run: npx electron reference/uishot.js
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

const SAMPLE = {
  deposit_date: '2026-07-27', bank: 'RCBC', reference_no: 'DEMO',
  items: [
    { section: 'CASH', line_no: 1, amount: 2000 },
    { section: 'CASH', line_no: 2, amount: 2500 },
    { section: 'CASH', line_no: 13, amount: 126000 },
    { section: 'CHECK', line_no: 1, amount: 183313.41 },
    { section: 'CHECK', line_no: 2, amount: 12000 },
    { section: 'CHECK', line_no: 3, amount: 210040.15 },
    { section: 'CHECK', line_no: 15, amount: 94848.36 },
  ],
};
const CALIB = { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 };

app.whenReady().then(async () => {
  // Load the layout module inside a page (it's an ES module) to build the HTML.
  const builder = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  await builder.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 300));
  const html = await builder.webContents.executeJavaScript(`(async () => {
    const pl = await import('./js/print-layout.js');
    const d = ${JSON.stringify(SAMPLE)}, c = ${JSON.stringify(CALIB)};
    return {
      overlay: pl.buildDepositSheet(d, c, 'overlay'),
      full:    pl.buildDepositSheet(d, c, 'full'),
      grid:    pl.buildAlignmentGrid(c),
    };
  })()`);
  builder.close();

  const scale = 0.55;
  const shot = async (name, doc) => {
    const f = path.join(os.tmpdir(), 'cdr-shot-' + name + '.html');
    fs.writeFileSync(f, doc, 'utf8');
    const w = new BrowserWindow({
      width: 470, height: 780, show: false,
      paintWhenInitiallyHidden: true, backgroundThrottling: false,
      webPreferences: { sandbox: true },
    });
    await w.loadFile(f);
    // Scale from the top-left and left-align so the full page width (incl. the
    // CHECKS half at the right edge) stays inside the capture.
    await w.webContents.insertCSS(
      `body{background:#fff !important; display:block !important; padding:4px !important}
       .sheet{transform:scale(${scale}) !important; transform-origin:top left !important; outline:1px solid #bbb}`
    );
    await new Promise((r) => setTimeout(r, 500));
    const img = await w.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'shot-' + name + '.png'), img.toPNG());
    w.close();
    console.log('wrote shot-' + name + '.png');
  };

  await shot('overlay', html.overlay);
  await shot('full', html.full);
  await shot('grid', html.grid);
  app.exit(0);
});
