// Verify a legacy (integer-id) local DB migrates to v2 (uuid) without data loss.
const { app } = require('electron');
const path=require('path'), fs=require('fs'), os=require('os');
const Database=require('better-sqlite3');
const db=require('../db');
app.disableHardwareAcceleration();
const R=[]; const ck=(n,c)=>{R.push(c);console.log((c?'OK  ':'FAIL')+' '+n);};
app.whenReady().then(() => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mig-'));
  const f=path.join(dir,'deposits.db');
  // build a v1 (integer-id) database like the deployed app had
  const raw=new Database(f);
  raw.exec(`
    CREATE TABLE deposits(id INTEGER PRIMARY KEY AUTOINCREMENT, deposit_date TEXT NOT NULL, bank TEXT NOT NULL DEFAULT 'RCBC', account_name TEXT, account_number TEXT, reference_no TEXT, notes TEXT, cash_total REAL DEFAULT 0, check_total REAL DEFAULT 0, grand_total REAL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE deposit_items(id INTEGER PRIMARY KEY AUTOINCREMENT, deposit_id INTEGER NOT NULL REFERENCES deposits(id) ON DELETE CASCADE, section TEXT NOT NULL, line_no INTEGER NOT NULL, amount REAL NOT NULL, check_no TEXT, drawee_bank TEXT, check_date TEXT, remarks TEXT);
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  raw.prepare(`INSERT INTO deposits(id,deposit_date,bank,reference_no,cash_total,check_total,grand_total,created_at,updated_at) VALUES (1,'2026-07-01','RCBC','OLD-1',1000,500,1500,'2026-07-01 03:00:00','2026-07-01 03:00:00')`).run();
  raw.prepare(`INSERT INTO deposit_items(deposit_id,section,line_no,amount) VALUES (1,'CASH',1,1000)`).run();
  raw.prepare(`INSERT INTO deposit_items(deposit_id,section,line_no,amount,check_no,drawee_bank) VALUES (1,'CHECK',1,500,'CK1','BDO')`).run();
  raw.close();

  // now open through db.init -> should migrate to v2 uuids
  db.init(dir);
  const list=db.listDeposits();
  ck('one deposit after migrate', list.length===1);
  const d=list[0];
  ck('id is a uuid string', typeof d.id==='string' && d.id.length===36);
  ck('totals + reference preserved', d.grand_total===1500 && d.reference_no==='OLD-1');
  ck('created_at converted to ISO', /\dT\d.*Z$/.test(d.created_at));
  const full=db.getDeposit(d.id);
  ck('two items preserved with detail', full.items.length===2 && full.items.some(i=>i.check_no==='CK1' && i.drawee_bank==='BDO'));
  ck('migrated rows are dirty (will push on sync)', db.getPendingCount()===1);
  ck('legacy tables dropped', !db.getDeposit(1) && true);
  const pass=R.every(Boolean);
  console.log(pass?'MIGRATE TEST PASSED':'MIGRATE TEST FAILED');
  app.exit(pass?0:1);
});
