'use strict';

/**
 * preload.js — the ONLY bridge between the renderer and Node/Electron.
 *
 * contextIsolation is on and nodeIntegration is off, so the renderer has no
 * direct access to Node. We expose a tiny, explicit `window.api` surface that
 * forwards to the ipcMain handlers in main.js. Nothing else leaks through.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Database file location (shown in the UI / Settings).
  getDbPath: () => ipcRenderer.invoke('db:getPath'),
  openDbFolder: () => ipcRenderer.invoke('app:openDbFolder'),

  // Deposits.
  createDeposit: (header, items) =>
    ipcRenderer.invoke('db:createDeposit', header, items),
  updateDeposit: (id, header, items) =>
    ipcRenderer.invoke('db:updateDeposit', id, header, items),
  getDeposit: (id) => ipcRenderer.invoke('db:getDeposit', id),
  listDeposits: (filters) => ipcRenderer.invoke('db:listDeposits', filters),
  deleteDeposit: (id) => ipcRenderer.invoke('db:deleteDeposit', id),
  duplicateDeposit: (id, newDate) =>
    ipcRenderer.invoke('db:duplicateDeposit', id, newDate),

  // Calibration.
  getCalibration: () => ipcRenderer.invoke('settings:getCalibration'),
  saveCalibration: (calib) => ipcRenderer.invoke('settings:saveCalibration', calib),

  // Defaults.
  getDefaults: () => ipcRenderer.invoke('settings:getDefaults'),
  saveDefaults: (d) => ipcRenderer.invoke('settings:saveDefaults', d),

  // Backup / restore / CSV.
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  exportCsv: (filters) => ipcRenderer.invoke('backup:exportCsv', filters),

  // Printing.
  printSheet: (html) => ipcRenderer.invoke('print:sheet', html),
  savePdf: (html, suggestedName) => ipcRenderer.invoke('print:pdf', html, suggestedName),
});
