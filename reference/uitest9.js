const { app, BrowserWindow, ipcMain } = require('electron');
const path=require('path'), fs=require('fs'), os=require('os');
const db=require('../db');
app.disableHardwareAcceleration();
const R=[]; const ck=(n,c)=>{R.push(c);console.log((c?'OK  ':'FAIL')+' '+n);};
const js=(w,s)=>w.webContents.executeJavaScript(s);
app.whenReady().then(async () => {
  db.init(fs.mkdtempSync(path.join(os.tmpdir(),'u9-')));
  for (const [c,f] of [['db:getDepositByDate',(_e,d)=>db.getDepositByDate(d)],['db:createDeposit',(_e,h,i)=>db.createDeposit(h,i)],['db:updateDeposit',(_e,id,h,i)=>db.updateDeposit(id,h,i)],['db:getDeposit',(_e,id)=>db.getDeposit(id)],['db:listDeposits',(_e,x)=>db.listDeposits(x)]]) ipcMain.handle(c,f);
  const win=new BrowserWindow({width:1200,height:900,show:false,paintWhenInitiallyHidden:true,webPreferences:{preload:path.join(__dirname,'..','preload.js'),contextIsolation:true}});
  await win.loadFile(path.join(__dirname,'..','renderer','index.html'));
  await new Promise(r=>setTimeout(r,500));

  const setBlur=(sec,line,val)=>js(win,`(()=>{const el=document.querySelector('.amount-input[data-section="${sec}"][data-line="${line}"]');el.value='${val}';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('focusout',{bubbles:true}));return el.value;})()`);

  ck('20000 -> 20,000.00', (await setBlur('CASH',1,'20000'))==='20,000.00');
  ck('30000 -> 30,000.00', (await setBlur('CASH',2,'30000'))==='30,000.00');
  ck('1500.5 -> 1,500.50', (await setBlur('CHECK',1,'1500.5'))==='1,500.50');
  const grand=await js(win,`document.getElementById('bar-grand').textContent`);
  ck('grand total = 51,500.50', /51,500\.50/.test(grand));
  // typing a comma-grouped value directly also parses
  ck('125,000 typed -> 125,000.00', (await setBlur('CASH',3,'125,000'))==='125,000.00');

  // save then verify db numbers + reload formatting
  const date=await js(win,`document.getElementById('f-date').value`);
  await js(win,`document.getElementById('btn-save').click()`);
  await new Promise(r=>setTimeout(r,500));
  const dep=db.getDepositByDate(date);
  ck('saved numeric amounts (no commas in DB)', dep && dep.grand_total===176500.5 && dep.items.some(i=>i.section==='CASH'&&i.line_no===1&&i.amount===20000));
  const reloaded=await js(win,`document.querySelector('.amount-input[data-section="CASH"][data-line="1"]').value`);
  ck('reloaded value is comma-formatted', reloaded==='20,000.00');

  const pass=R.every(Boolean);
  console.log(pass?'UITEST9 PASSED':'UITEST9 FAILED');
  app.exit(pass?0:1);
});
