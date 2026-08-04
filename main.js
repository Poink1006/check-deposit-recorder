'use strict';

/**
 * main.js — Electron main process.
 *
 * Responsibilities:
 *  - Create the app window.
 *  - Open the SQLite database (in userData) at startup.
 *  - Expose the DB layer to the renderer over IPC (ipcMain.handle), since
 *    better-sqlite3 is synchronous and must run in the Node/main process.
 *
 * The renderer NEVER touches the database directly; it calls the small,
 * explicit API defined in preload.js which forwards to these handlers.
 */

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('./db');
const sync = require('./sync');

let mainWindow = null;

/**
 * Auto-update via electron-updater + GitHub Releases. Only packaged/installed
 * builds have an update feed (running unpacked has nothing to check against).
 * The renderer shows an in-app banner from the events we forward here.
 */
function setupAutoUpdater() {
  // Let the renderer's banner trigger install-and-restart.
  ipcMain.on('update:restart', () => autoUpdater.quitAndInstall());

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (info) =>
    mainWindow?.webContents.send('update:available', { version: info.version })
  );
  autoUpdater.on('update-downloaded', (info) =>
    mainWindow?.webContents.send('update:downloaded', { version: info.version })
  );
  autoUpdater.on('error', (err) => console.error('Auto-update error:', err));

  autoUpdater.checkForUpdates();
}

/**
 * Render an HTML string in a hidden, isolated window and hand its webContents
 * to `fn`. Used for printing / PDF export so the print document is a clean,
 * standalone page (exact Legal geometry, margin 0) independent of the app UI.
 *
 * We load the HTML from a temp file (not a data: URL) so large documents and
 * unicode content load reliably. The temp file and window are always cleaned up.
 */
async function withPrintWindow(html, fn) {
  const tmpFile = path.join(
    os.tmpdir(),
    `cdr-print-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
  );
  fs.writeFileSync(tmpFile, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: false, sandbox: true },
  });

  try {
    await win.loadFile(tmpFile);
    // Give layout/fonts a moment to settle before printing.
    await new Promise((r) => setTimeout(r, 250));
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.close();
    fs.promises.unlink(tmpFile).catch(() => {});
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Check Deposit Recorder',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open maximized — a full window (title bar + minimize/maximize/close stay),
  // not kiosk/fullscreen. Create it visible and maximize directly; relying on
  // show:false + 'ready-to-show' left the window hidden on some setups.
  mainWindow.maximize();
  mainWindow.show();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---- IPC: database API ------------------------------------------------------

ipcMain.handle('db:getPath', () => db.getDbPath());

ipcMain.handle('app:getVersion', () => app.getVersion());

// After any local change, nudge a sync so it reaches the other computers soon.
ipcMain.handle('db:createDeposit', (_evt, header, items) => {
  const r = db.createDeposit(header, items);
  sync.scheduleSoon();
  return r;
});

ipcMain.handle('db:updateDeposit', (_evt, id, header, items) => {
  const r = db.updateDeposit(id, header, items);
  sync.scheduleSoon();
  return r;
});

ipcMain.handle('db:getDeposit', (_evt, id) => db.getDeposit(id));

ipcMain.handle('db:getDepositByDate', (_evt, date) => db.getDepositByDate(date));

ipcMain.handle('db:listDeposits', (_evt, filters) => db.listDeposits(filters));

ipcMain.handle('db:deleteDeposit', (_evt, id) => {
  const r = db.deleteDeposit(id);
  sync.scheduleSoon();
  return r;
});

ipcMain.handle('db:duplicateDeposit', (_evt, id, newDate) => {
  const r = db.duplicateDeposit(id, newDate);
  sync.scheduleSoon();
  return r;
});

// Open the folder that contains the database file (used by Settings later).
ipcMain.handle('app:openDbFolder', () => {
  const p = db.getDbPath();
  if (p) shell.showItemInFolder(p);
});

// ---- IPC: calibration -------------------------------------------------------

ipcMain.handle('settings:getCalibration', () => db.getCalibration());
ipcMain.handle('settings:saveCalibration', (_evt, calib) => db.saveCalibration(calib));

// ---- IPC: defaults ----------------------------------------------------------

ipcMain.handle('settings:getDefaults', () => db.getDefaults());
ipcMain.handle('settings:saveDefaults', (_evt, d) => db.saveDefaults(d));

// ---- IPC: Supabase sync -----------------------------------------------------

ipcMain.handle('sync:now', () => sync.syncNow());
ipcMain.handle('sync:status', () => sync.status());

// ---- IPC: shared-account auth ----------------------------------------------

ipcMain.handle('auth:status', () => sync.authStatus());
ipcMain.handle('auth:signin', (_evt, email, password) => sync.signIn(email, password));
ipcMain.handle('auth:signout', async () => {
  const r = await sync.signOut();
  if (mainWindow) mainWindow.webContents.send('auth:signedout');
  return r;
});

// ---- IPC: backup / restore / CSV -------------------------------------------

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// Export a consistent copy of the whole database.
ipcMain.handle('backup:export', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export backup',
    defaultPath: `deposits-backup-${stamp()}.db`,
    filters: [{ name: 'Database backup', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await db.backupTo(filePath);
  return { canceled: false, filePath };
});

// Restore the database from a backup file (validated before overwriting).
ipcMain.handle('backup:restore', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore from backup',
    properties: ['openFile'],
    filters: [{ name: 'Database backup', extensions: ['db'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { canceled: true };
  const info = db.restoreFrom(filePaths[0]);
  return { canceled: false, ...info };
});

// Export an item-level CSV register for a date range (or everything).
ipcMain.handle('backup:exportCsv', async (_evt, filters) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export CSV',
    defaultPath: `deposits-${stamp()}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  const csv = db.exportCsv(filters || {});
  // Prepend a UTF-8 BOM so Excel opens the ₱-free numeric CSV in the right encoding.
  fs.writeFileSync(filePath, '﻿' + csv, 'utf8');
  return { canceled: false, filePath };
});

// ---- IPC: printing ----------------------------------------------------------

// Long bond / Folio paper size, 8.5" × 13", as the print defaults.
const PAPER_MICRONS = { width: 215900, height: 330200 }; // for webContents.print
const PAPER_INCHES = { width: 8.5, height: 13 };          // for printToPDF

// Print an HTML sheet to a physical printer. Opens the OS print dialog
// (silent:false) so the user can pick the printer feeding the bank form.
// Long bond (8.5×13), zero margins — the mm coordinates in the HTML are authoritative.
ipcMain.handle('print:sheet', (_evt, html) =>
  withPrintWindow(html, (win) =>
    new Promise((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          color: true,
          margins: { marginType: 'none' },
          pageSize: PAPER_MICRONS,
          landscape: false,
        },
        (success, failureReason) => resolve({ success, failureReason })
      );
    })
  )
);

// Export the same HTML sheet to a PDF the user chooses a location for.
ipcMain.handle('print:pdf', async (_evt, html, suggestedName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save deposit slip as PDF',
    defaultPath: suggestedName || 'deposit-slip.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const data = await withPrintWindow(html, (win) =>
    win.webContents.printToPDF({
      pageSize: PAPER_INCHES,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
  );
  fs.writeFileSync(filePath, data);
  return { canceled: false, filePath };
});

// ---- App lifecycle ----------------------------------------------------------

app.whenReady().then(() => {
  // Open/create the database before any window can query it.
  db.init(app.getPath('userData'));
  sync.init(); // Supabase client from the embedded config

  // After each sync, push the status to the renderer; if the pull brought new
  // data, tell it to refresh the current view.
  sync.setNotifier((result) => {
    if (!mainWindow) return;
    mainWindow.webContents.send('sync:status', sync.status());
    if (result.ok && result.pulled > 0) mainWindow.webContents.send('sync:changed');
  });

  createWindow();
  setupAutoUpdater();
  sync.startAuto(); // periodic background sync (+ one on launch)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
