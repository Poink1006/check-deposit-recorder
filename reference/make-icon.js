'use strict';
// Generate the app icon: render an SVG to a transparent PNG via Electron, then
// pack multiple sizes into a Windows .ico (PNG-compressed entries) plus a 256px
// PNG for the runtime window. Not shipped. Run: npx electron reference/make-icon.js
const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

// Brand mark: rounded green square + a slip motif + a bold white ₱ (Segoe UI has
// the Philippine peso glyph). Designed to stay legible down to 16px.
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#15855f"/>
      <stop offset="1" stop-color="#0b6b4f"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="54" fill="url(#g)"/>
  <!-- faint deposit-slip lines behind the mark -->
  <g opacity="0.16" stroke="#ffffff" stroke-width="7" stroke-linecap="round">
    <line x1="70" y1="86" x2="150" y2="86"/>
    <line x1="70" y1="170" x2="150" y2="170"/>
  </g>
  <text x="130" y="180" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif"
        font-size="168" font-weight="700" fill="#ffffff">&#8369;</text>
</svg>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent}
  svg{display:block}
</style></head><body>${SVG}</body></html>`;

// Build a Windows .ico from an array of { size, png:Buffer } (PNG-in-ICO format).
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type: icon
  header.writeUInt16LE(count, 4); // image count

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const blobs = [];
  images.forEach((img, i) => {
    const b = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 0); // width (0 = 256)
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, b + 1); // height
    dir.writeUInt8(0, b + 2);   // palette
    dir.writeUInt8(0, b + 3);   // reserved
    dir.writeUInt16LE(1, b + 4);   // color planes
    dir.writeUInt16LE(32, b + 6);  // bits per pixel
    dir.writeUInt32LE(img.png.length, b + 8);  // size of image data
    dir.writeUInt32LE(offset, b + 12);         // offset
    offset += img.png.length;
    blobs.push(img.png);
  });
  return Buffer.concat([header, dir, ...blobs]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false, transparent: true,
    useContentSize: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });
  const tmp = path.join(app.getPath('temp'), 'cdr-icon.html');
  fs.writeFileSync(tmp, HTML, 'utf8');
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 400));

  const base = await win.webContents.capturePage(); // 256x256 with alpha
  const sizes = [256, 128, 64, 48, 32, 16];
  const images = sizes.map((size) => ({
    size,
    png: (size === 256 ? base : base.resize({ width: size, height: size, quality: 'best' })).toPNG(),
  }));

  const buildDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(buildDir, 'icon.png'), base.toPNG());
  // A preview for review.
  fs.writeFileSync(path.join(__dirname, 'icon-preview.png'), base.toPNG());

  console.log('Wrote build/icon.ico (' + sizes.join(',') + ') and build/icon.png');
  app.exit(0);
});
