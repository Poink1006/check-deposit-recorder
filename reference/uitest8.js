const { app, BrowserWindow, ipcMain } = require('electron');
const path=require('path'), fs=require('fs'), os=require('os');
const db=require('../db');
app.disableHardwareAcceleration();
const R=[]; const ck=(n,c)=>{R.push(c);console.log((c?'OK  ':'FAIL')+' '+n);};
const jsf=(w,s)=>w.webContents.executeJavaScript(s);
app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(),'u8-')));
  for (const [c,f] of [
    ['db:getDepositByDate',(_e,d)=>db.getDepositByDate(d)],
    ['db:createDeposit',(_e,h,i)=>db.createDeposit(h,i)],
    ['db:updateDeposit',(_e,id,h,i)=>db.updateDeposit(id,h,i)],
    ['db:getDeposit',(_e,id)=>db.getDeposit(id)],
    ['db:listDeposits',(_e,x)=>db.listDeposits(x)],
  ]) ipcMain.handle(c,f);

  const D='2026-07-30';
  db.createDeposit({deposit_date:D},[{section:'CASH',line_no:1,amount:20000},{section:'CASH',line_no:2,amount:30000}]);

  const win=new BrowserWindow({width:1200,height:900,show:false,paintWhenInitiallyHidden:true,webPreferences:{preload:path.join(__dirname,'..','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(__dirname,'..','renderer','index.html'));
  await new Promise(r=>setTimeout(r,500));

  // select the date -> should load existing deposit
  await jsf(win,`(()=>{const e=document.getElementById('f-date');e.value='${D}';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  // wait until cells populate
  await jsf(win,`(async()=>{for(let k=0;k<50;k++){const el=document.querySelector('.amount-input[data-section="CASH"][data-line="1"]');if(el&&el.value==='20000')return;await new Promise(r=>setTimeout(r,50));}})()`);
  const loaded=await jsf(win,`({
    c1:document.querySelector('.amount-input[data-section="CASH"][data-line="1"]').value,
    c2:document.querySelector('.amount-input[data-section="CASH"][data-line="2"]').value,
    btn:document.getElementById('btn-save').textContent,
    hint:document.getElementById('date-hint').className,
    grand:document.getElementById('bar-grand').textContent })`);
  ck('existing amounts loaded on date select', loaded.c1==='20000' && loaded.c2==='30000');
  ck('save button shows "Save changes"', loaded.btn==='Save changes');
  ck('hint marks existing', /existing/.test(loaded.hint));
  ck('grand total shows 50,000', /50,000\.00/.test(loaded.grand));

  // edit line 1 -> 25000 and save (should UPDATE, not duplicate)
  await jsf(win,`(()=>{const el=document.querySelector('.amount-input[data-section="CASH"][data-line="1"]');el.value='25000';el.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('btn-save').click();})()`);
  await jsf(win,`(async()=>{for(let k=0;k<50;k++){await new Promise(r=>setTimeout(r,50));}})()`);
  await new Promise(r=>setTimeout(r,400));
  const forDate=db.listDeposits({from:D,to:D});
  ck('no duplicate — still 1 deposit for the date', forDate.length===1);
  const cur=db.getDepositByDate(D);
  ck('edit saved as update (grand 55000)', cur.grand_total===55000 && cur.items.find(i=>i.line_no===1).amount===25000);

  // switch to a fresh date -> blank + "Save deposit"
  await jsf(win,`(()=>{const e=document.getElementById('f-date');e.value='2026-08-15';e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await new Promise(r=>setTimeout(r,400));
  const fresh=await jsf(win,`({
    c1:document.querySelector('.amount-input[data-section="CASH"][data-line="1"]').value,
    btn:document.getElementById('btn-save').textContent,
    hint:document.getElementById('date-hint').className })`);
  ck('fresh date -> cells blank', fresh.c1==='');
  ck('fresh date -> "Save deposit" + fresh hint', fresh.btn==='Save deposit' && /fresh/.test(fresh.hint));

  const pass=R.every(Boolean);
  console.log(pass?'UITEST8 PASSED':'UITEST8 FAILED');
  app.exit(pass?0:1);
});
