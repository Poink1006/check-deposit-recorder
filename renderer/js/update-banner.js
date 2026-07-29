'use strict';

/**
 * update-banner.js — in-app auto-update banner.
 *
 * The main process (electron-updater) forwards 'update:available' and
 * 'update:downloaded' events. We show a small banner while downloading, then a
 * "Restart & update" button once the new version is ready to install.
 * Only packaged builds ever emit these, so nothing shows during `npm start`.
 */

export function initUpdateBanner() {
  if (!window.api || !window.api.onUpdateAvailable) return;

  const bar = document.createElement('div');
  bar.className = 'update-banner';
  bar.style.display = 'none';
  document.body.appendChild(bar);

  const show = (html) => {
    bar.innerHTML = html;
    bar.style.display = 'flex';
  };

  window.api.onUpdateAvailable((info) => {
    show(`<span>Downloading update ${info.version}…</span>`);
  });

  window.api.onUpdateDownloaded((info) => {
    show(
      `<span>Update ${info.version} is ready.</span>` +
      `<button class="btn" id="upd-restart">Restart &amp; update</button>`
    );
    bar.querySelector('#upd-restart').addEventListener('click', () =>
      window.api.restartToUpdate()
    );
  });
}
