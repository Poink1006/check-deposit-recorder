// Test the unsaved-changes navigation guard. Each scenario mocks confirm and
// triggers the nav in ONE evaluation so the mock is active at click time.
const { app, BrowserWindow, ipcMain } = require('electron');
const path=require('path'), fs=require('fs'), os=require('os');
const db=require('../db');
app.disableHardwareAcceleration();
const R=[]; const ck=(n,c)=>{R.push(c);console.log((c?'OK  ':'FAIL')+' '+n);};
const js=(w,s)=>w.webContents.executeJavaScript(s);
setTimeout(() => { console.log('HARD TIMEOUT'); app.exit(3); }, 30000);
app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(),'u11-')));
  for (const [c,f] of [['db:getDepositByDate',(_e,d)=>db.getDepositByDate(d)],['db:createDeposit',(_e,h,i)=>db.createDeposit(h,i)],['db:updateDeposit',(_e,id,h,i)=>db.updateDeposit(id,h,i)],['db:getDeposit',(_e,id)=>db.getDeposit(id)],['db:listDeposits',(_e,x)=>db.listDeposits(x)]]) ipcMain.handle(c,f);
  const win=new BrowserWindow({width:1200,height:900,show:false,paintWhenInitiallyHidden:true,webPreferences:{preload:path.join(__dirname,'..','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(__dirname,'..','renderer','index.html'));
  await new Promise(r=>setTimeout(r,600));

  const dirty = () => js(win,`(()=>{const el=document.querySelector('.amount-input[data-section="CASH"][data-line="1"]');el.value='500';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const goNew = () => js(win,`document.querySelector('.nav-btn[data-view="new"]').click()`);
  const wait = (ms)=>new Promise(r=>setTimeout(r,ms));

  // Scenario 1: clean form navigates without any confirm.
  let r = await js(win,`(()=>{ let calls=0; window.confirm=()=>{calls++;return true;};
    document.querySelector('.nav-btn[data-view="history"]').click();
    return { calls, onHistory: !!document.querySelector('#h-body') }; })()`);
  ck('clean: navigates, no prompt', r.onHistory === true && r.calls === 0);

  // Scenario 2: dirty + Cancel -> stays on New, prompt shown.
  await goNew(); await wait(200); await dirty();
  r = await js(win,`(()=>{ let calls=0; window.confirm=()=>{calls++;return false;};
    document.querySelector('.nav-btn[data-view="history"]').click();
    return { calls, onNew: !!document.querySelector('#f-date') }; })()`);
  ck('dirty + cancel: prompted, stays on New', r.calls >= 1 && r.onNew === true);

  // Scenario 3: dirty + OK -> leaves to History.
  r = await js(win,`(()=>{ let calls=0; window.confirm=()=>{calls++;return true;};
    document.querySelector('.nav-btn[data-view="history"]').click();
    return { calls, onHistory: !!document.querySelector('#h-body') }; })()`);
  ck('dirty + confirm: prompted, leaves to History', r.calls >= 1 && r.onHistory === true);

  const pass=R.every(Boolean);
  console.log(pass?'UITEST11 PASSED':'UITEST11 FAILED');
  app.exit(pass?0:1);
});
