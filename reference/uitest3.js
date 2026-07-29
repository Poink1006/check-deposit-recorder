'use strict';
// Phase 3 end-to-end check under real Electron:
//  - build the real print HTML via renderer/js/print-layout.js (dynamic import)
//  - confirm amount formatting (comma, 2dp) and the calibration transform
//  - export a real PDF through printToPDF at Legal size; verify page geometry
//  - screenshot the print preview (overlay + full) and the calibration screen
// Not shipped. Run: npx electron reference/uitest3.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();

function log(...a) { console.log(...a); }

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdr-p3-'));
  db.init(dir);
  ipcMain.handle('settings:getCalibration', () => db.getCalibration());
  ipcMain.handle('settings:saveCalibration', (_e, c) => db.saveCalibration(c));
  ipcMain.handle('db:createDeposit', (_e, h, i) => db.createDeposit(h, i));
  ipcMain.handle('db:listDeposits', () => db.listDeposits());
  ipcMain.handle('db:getDeposit', (_e, id) => db.getDeposit(id));
  ipcMain.handle('db:updateDeposit', (_e, id, h, i) => db.updateDeposit(id, h, i));

  const win = new BrowserWindow({
    width: 1280, height: 980, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  // 1) Build the real print HTML in the page context and check content.
  const built = await win.webContents.executeJavaScript(`(async () => {
    const pl = await import('./js/print-layout.js');
    const deposit = { deposit_date:'2026-07-27', bank:'RCBC', reference_no:'P3', items:[
      { section:'CASH',  line_no:1,  amount:2000 },
      { section:'CASH',  line_no:13, amount:126000 },
      { section:'CHECK', line_no:1,  amount:183313.41 },
      { section:'CHECK', line_no:15, amount:94848.36 },
    ]};
    const overlay = pl.buildDepositSheet(deposit, { offsetX:0, offsetY:0, scaleX:1, scaleY:1 }, 'overlay');
    const shifted = pl.buildDepositSheet(deposit, { offsetX:10, offsetY:-3, scaleX:1, scaleY:1 }, 'overlay');
    return {
      overlay,
      hasComma:  overlay.includes('183,313.41') && overlay.includes('126,000.00'),
      hasGridInOverlay: overlay.includes('class="hline"') || overlay.includes('class="glabel"'), // FALSE for overlay
      shiftHasTransform: shifted.includes('translate(10mm, -3mm)'),
      legalSize: overlay.includes('215.9mm') && overlay.includes('355.6mm'),
    };
  })()`);

  const contentOk = built.hasComma && !built.hasGridInOverlay && built.shiftHasTransform && built.legalSize;
  log('CONTENT -> comma amounts:', built.hasComma, '| overlay has no grid:', !built.hasGridInOverlay,
    '| calibration transform:', built.shiftHasTransform, '| Legal mm size:', built.legalSize, contentOk ? 'OK' : 'FAIL');

  // 2) Export a real PDF via printToPDF at Legal and check page geometry.
  const tmpHtml = path.join(dir, 'overlay.html');
  fs.writeFileSync(tmpHtml, built.overlay, 'utf8');
  const pwin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await pwin.loadFile(tmpHtml);
  await new Promise((r) => setTimeout(r, 250));
  const pdf = await pwin.webContents.printToPDF({
    pageSize: 'Legal', printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  pwin.close();
  const pdfPath = path.join(__dirname, 'phase3-overlay.pdf');
  fs.writeFileSync(pdfPath, pdf);
  const pdfText = pdf.toString('latin1');
  const isPdf = pdfText.startsWith('%PDF');
  // Legal portrait = 612 x 1008 pt. Electron writes the MediaBox in points.
  const mediaBox = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
  const w = mediaBox ? Math.round(+mediaBox[1]) : 0;
  const h = mediaBox ? Math.round(+mediaBox[2]) : 0;
  const geomOk = isPdf && w === 612 && h === 1008;
  log('PDF -> isPdf:', isPdf, '| MediaBox:', w, 'x', h, '(expect 612 x 1008)', geomOk ? 'OK' : 'FAIL', '|', pdfPath);

  // 3) Screenshots: calibration screen, then overlay + full preview.
  const shoot = async (name) => {
    await new Promise((r) => setTimeout(r, 450));
    const img = await win.webContents.capturePage();
    const p = path.join(__dirname, name);
    fs.writeFileSync(p, img.toPNG());
    log('Screenshot:', p);
  };

  await win.webContents.executeJavaScript(`document.querySelector('.nav-btn[data-view="calibration"]').click()`);
  await shoot('phase3-calibration.png');

  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('.nav-btn[data-view="new"]').click();
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await win.webContents.executeJavaScript(`(() => {
    const set = (b,i,v)=>{const el=document.querySelectorAll('#'+b+' .amount-input')[i];el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
    set('cash-rows',0,'2000'); set('cash-rows',1,'126000');
    set('check-rows',0,'183313.41'); set('check-rows',1,'94848.36');
    document.getElementById('btn-print').click();
  })()`);
  await shoot('phase3-preview-overlay.png');
  await win.webContents.executeJavaScript(`document.querySelector('.tab[data-mode="full"]').click()`);
  await shoot('phase3-preview-full.png');

  const pass = contentOk && geomOk;
  log(pass ? 'PHASE 3 TEST PASSED' : 'PHASE 3 TEST FAILED');
  app.exit(pass ? 0 : 1);
});
