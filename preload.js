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

  // App version (shown in the header).
  getVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Deposits.
  createDeposit: (header, items) =>
    ipcRenderer.invoke('db:createDeposit', header, items),
  updateDeposit: (id, header, items) =>
    ipcRenderer.invoke('db:updateDeposit', id, header, items),
  getDeposit: (id) => ipcRenderer.invoke('db:getDeposit', id),
  getDepositByDate: (date) => ipcRenderer.invoke('db:getDepositByDate', date),
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

  // Supabase sync config.
  getSyncConfig: () => ipcRenderer.invoke('sync:getConfig'),
  saveSyncConfig: (cfg) => ipcRenderer.invoke('sync:saveConfig', cfg),
  testSync: () => ipcRenderer.invoke('sync:test'),

  // Supabase sync runtime.
  syncNow: () => ipcRenderer.invoke('sync:now'),
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  onSyncStatus: (cb) => {
    const h = (_e, st) => cb(st);
    ipcRenderer.on('sync:status', h);
    return () => ipcRenderer.removeListener('sync:status', h);
  },
  onSyncChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on('sync:changed', h);
    return () => ipcRenderer.removeListener('sync:changed', h);
  },

  // Backup / restore / CSV.
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),
  exportCsv: (filters) => ipcRenderer.invoke('backup:exportCsv', filters),

  // Printing.
  printSheet: (html) => ipcRenderer.invoke('print:sheet', html),
  savePdf: (html, suggestedName) => ipcRenderer.invoke('print:pdf', html, suggestedName),

  // Auto-update banner hooks.
  onUpdateAvailable: (cb) => {
    const h = (_e, info) => cb(info);
    ipcRenderer.on('update:available', h);
    return () => ipcRenderer.removeListener('update:available', h);
  },
  onUpdateDownloaded: (cb) => {
    const h = (_e, info) => cb(info);
    ipcRenderer.on('update:downloaded', h);
    return () => ipcRenderer.removeListener('update:downloaded', h);
  },
  restartToUpdate: () => ipcRenderer.send('update:restart'),
});
