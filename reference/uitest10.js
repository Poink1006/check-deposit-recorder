const { app, BrowserWindow, ipcMain } = require('electron');
const path=require('path'), fs=require('fs'), os=require('os');
const db=require('../db');
app.disableHardwareAcceleration();
const R=[]; const ck=(n,c)=>{R.push(c);console.log((c?'OK  ':'FAIL')+' '+n);};
const js=(w,s)=>w.webContents.executeJavaScript(s);
app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(),'u10-')));
  for (const [c,f] of [['db:getDepositByDate',(_e,d)=>db.getDepositByDate(d)],['db:createDeposit',(_e,h,i)=>db.createDeposit(h,i)],['db:getDeposit',(_e,id)=>db.getDeposit(id)],['db:listDeposits',(_e,x)=>db.listDeposits(x)]]) ipcMain.handle(c,f);
  const win=new BrowserWindow({width:1200,height:900,show:false,paintWhenInitiallyHidden:true,webPreferences:{preload:path.join(__dirname,'..','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(__dirname,'..','renderer','index.html'));
  await new Promise(r=>setTimeout(r,500));

  const press=(key)=>js(win,`(()=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'${key}',bubbles:true,cancelable:true}));const a=document.activeElement;return a.dataset.section+':'+a.dataset.line;})()`);
  const focus=(s,l)=>js(win,`(()=>{const el=document.querySelector('.amount-input[data-section="${s}"][data-line="${l}"]');el.focus();return document.activeElement.dataset.section+':'+document.activeElement.dataset.line;})()`);

  await focus('CASH',1);
  ck('Right: CASH1 -> CASH13', (await press('ArrowRight'))==='CASH:13');
  ck('Right: CASH13 -> CHECK1', (await press('ArrowRight'))==='CHECK:1');
  ck('Right: CHECK1 -> CHECK13', (await press('ArrowRight'))==='CHECK:13');
  ck('Right: CHECK13 -> CASH2 (next row)', (await press('ArrowRight'))==='CASH:2');
  ck('Left: CASH2 -> CHECK13', (await press('ArrowLeft'))==='CHECK:13');
  ck('Left: CHECK13 -> CHECK1', (await press('ArrowLeft'))==='CHECK:1');
  // up/down still work
  await focus('CASH',1);
  ck('Down: CASH1 -> CASH2', (await press('ArrowDown'))==='CASH:2');
  ck('Up: CASH2 -> CASH1', (await press('ArrowUp'))==='CASH:1');

  // Right should NOT jump when cursor is mid-value
  await js(win,`(()=>{const el=document.querySelector('.amount-input[data-section="CASH"][data-line="1"]');el.value='12345';el.focus();el.setSelectionRange(2,2);})()`);
  ck('Right mid-value stays in cell', (await press('ArrowRight'))==='CASH:1');

  const pass=R.every(Boolean);
  console.log(pass?'UITEST10 PASSED':'UITEST10 FAILED');
  app.exit(pass?0:1);
});
