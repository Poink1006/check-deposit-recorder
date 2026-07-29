'use strict';
// Screenshot the Calibration screen with the preview iframe fully rendered.
// Not shipped. Run: npx electron reference/cal-shot.js
const { app, BrowserWindow, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const db = require('../db');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(), 'cal-')));
  ipcMain.handle('settings:getCalibration', () => db.getCalibration());
  ipcMain.handle('settings:saveCalibration', (_e, c) => db.saveCalibration(c));

  const win = new BrowserWindow({
    width: 1200, height: 900, useContentSize: true, show: false,
    paintWhenInitiallyHidden: true, backgroundThrottling: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));
  await win.webContents.executeJavaScript(`document.querySelector('.nav-btn[data-view="calibration"]').click()`);
  // wait for the preview iframe to actually render the sheet
  await win.webContents.executeJavaScript(`(async () => {
    for (let k=0;k<60;k++){
      const f=document.querySelector('.preview-frame');
      if (f && f.contentDocument && f.contentDocument.querySelector('.sheet')) return true;
      await new Promise(r=>setTimeout(r,50));
    }
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await win.webContents.executeJavaScript(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, 'cal-preview.png'), img.toPNG());
  console.log('wrote cal-preview.png');
  app.exit(0);
});
