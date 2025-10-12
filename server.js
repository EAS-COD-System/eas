// server.js — EAS Tracker backend
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

function initDBIfMissing() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {
      password: 'eastafricashop',
      countries: ['china', 'kenya', 'tanzania', 'uganda', 'zambia', 'zimbabwe'],
      products: [],
      adspend: [],
      deliveries: [],
      shipments: [],
      remittances: [],
      finance: { categories: { debit: [], credit: [] }, entries: [] },
      influencers: [],
      influencerSpends: [],
      snapshots: []
    }, { spaces: 2 });
  }
}
function loadDB() { initDBIfMissing(); return fs.readJsonSync(DATA_FILE); }
function saveDB(db) { fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); }
function ensureSnapshotDir() { fs.ensureDirSync(SNAPSHOT_DIR); }

const keepChina = c => c.toLowerCase() === 'china';
const noChina = c => c.toLowerCase() !== 'china';

const balanceAll = db => (db.finance?.entries||[])
  .reduce((acc,e)=>acc+(e.type==='credit'?+e.amount||0:-(+e.amount||0)),0);

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();
  if (password === 'logout') {
    res.clearCookie('auth', { httpOnly:true, sameSite:'Lax', path:'/' });
    return res.json({ ok:true });
  }
  if (password && password === db.password) {
    // stay logged in "forever" until logout
    res.cookie('auth','1',{ httpOnly:true, sameSite:'Lax', path:'/', maxAge: 10*365*24*60*60*1000 });
    return res.json({ ok:true });
  }
  res.status(403).json({ error:'Wrong password' });
});
function requireAuth(req,res,next){ if(req.cookies.auth==='1') return next(); res.status(403).json({error:'Unauthorized'}); }

app.get('/api/meta', requireAuth, (req,res)=>{
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

/* -------- Countries (China cannot be deleted) -------- */
app.get('/api/countries', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ countries: db.countries || [] });
});
app.post('/api/countries', requireAuth, (req,res)=>{
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error:'Missing name' });
  const db = loadDB(); db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db); res.json({ ok:true, countries: db.countries });
});
app.delete('/api/countries/:name', requireAuth, (req,res)=>{
  const n = req.params.name;
  if (keepChina(n)) return res.status(400).json({ error:'China cannot be deleted' });
  const db = loadDB(); db.countries = (db.countries||[]).filter(c=>c!==n);
  saveDB(db); res.json({ ok:true, countries: db.countries });
});

/* -------- Products (DELETE wipes related data) -------- */
app.get('/api/products', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ products: db.products||[] });
});
app.post('/api/products', requireAuth, (req,res)=>{
  const db=loadDB(); db.products=db.products||[];
  const p = {
    id: uuidv4(), status:'active',
    name: req.body.name||'', sku: req.body.sku||'',
    cost_china:+req.body.cost_china||0, ship_china_to_kenya:+req.body.ship_china_to_kenya||0,
    margin_budget:+req.body.margin_budget||0, budgets: req.body.budgets||{}
  };
  if (!p.name) return res.status(400).json({ error:'Name required' });
  db.products.push(p); saveDB(db); res.json({ ok:true, product: p });
});
app.put('/api/products/:id', requireAuth, (req,res)=>{
  const db=loadDB(); const p=(db.products||[]).find(x=>x.id===req.params.id);
  if(!p) return res.status(404).json({ error:'Not found' });
  const u=req.body||{};
  if(u.name!==undefined)p.name=u.name;
  if(u.sku!==undefined)p.sku=u.sku;
  if(u.cost_china!==undefined)p.cost_china=+u.cost_china||0;
  if(u.ship_china_to_kenya!==undefined)p.ship_china_to_kenya=+u.ship_china_to_kenya||0;
  if(u.margin_budget!==undefined)p.margin_budget=+u.margin_budget||0;
  if(u.budgets!==undefined)p.budgets=u.budgets||{};
  saveDB(db); res.json({ ok:true, product:p });
});
app.delete('/api/products/:id', requireAuth, (req,res)=>{
  const db=loadDB(); const id=req.params.id;
  db.products=(db.products||[]).filter(p=>p.id!==id);
  db.adspend=(db.adspend||[]).filter(a=>a.productId!==id);
  db.shipments=(db.shipments||[]).filter(s=>s.productId!==id);
  db.remittances=(db.remittances||[]).filter(r=>r.productId!==id);
  db.influencerSpends=(db.influencerSpends||[]).filter(s=>s.productId!==id);
  saveDB(db); res.json({ ok:true });
});

/* -------- Daily ad spend (replace upsert) -------- */
app.get('/api/adspend', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ adSpends: db.adspend||[] });
});
app.post('/api/adspend', requireAuth, (req,res)=>{
  const db=loadDB(); db.adspend=db.adspend||[];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error:'Missing fields' });
  const found=db.adspend.find(a=>a.productId===productId && a.country===country && a.platform===platform);
  if(found) found.amount=+amount||0; else db.adspend.push({ id:uuidv4(), productId, country, platform, amount:+amount||0 });
  saveDB(db); res.json({ ok:true });
});

/* -------- Deliveries -------- */
app.get('/api/deliveries', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ deliveries: db.deliveries||[] });
});
app.post('/api/deliveries', requireAuth, (req,res)=>{
  const db=loadDB(); db.deliveries=db.deliveries||[];
  const { date, country, delivered } = req.body||{};
  if (!date || !country) return res.status(400).json({ error:'Missing date/country' });
  if (!noChina(country)) return res.status(400).json({ error:'China is source-only' });
  db.deliveries.push({ id:uuidv4(), date, country, delivered:+delivered||0 });
  saveDB(db); res.json({ ok:true });
});

/* -------- Shipments -------- */
app.get('/api/shipments', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ shipments: db.shipments||[] });
});
app.post('/api/shipments', requireAuth, (req,res)=>{
  const db=loadDB(); db.shipments=db.shipments||[];
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry || req.body.from,
    toCountry: req.body.toCountry || req.body.to,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    departedAt: req.body.departedAt || new Date().toISOString().slice(0,10),
    arrivedAt: req.body.arrivedAt || null
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error:'Missing productId/fromCountry/toCountry' });
  db.shipments.push(s); saveDB(db); res.json({ ok:true, shipment:s });
});
app.put('/api/shipments/:id', requireAuth, (req,res)=>{
  const db=loadDB(); const s=(db.shipments||[]).find(x=>x.id===req.params.id);
  if(!s) return res.status(404).json({ error:'Not found' });
  const u=req.body||{};
  if(u.qty!==undefined) s.qty=+u.qty||0;
  if(u.shipCost!==undefined) s.shipCost=+u.shipCost||0;
  if(u.departedAt!==undefined) s.departedAt=u.departedAt;
  if(u.arrivedAt!==undefined) s.arrivedAt=u.arrivedAt;
  saveDB(db); res.json({ ok:true, shipment:s });
});
app.delete('/api/shipments/:id', requireAuth, (req,res)=>{
  const db=loadDB(); db.shipments=(db.shipments||[]).filter(x=>x.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* -------- Remittances (China excluded) -------- */
app.get('/api/remittances', requireAuth, (req,res)=>{
  const db=loadDB(); let list=db.remittances||[];
  const { start,end,country } = req.query||{};
  if (start) list=list.filter(r=>r.start>=start);
  if (end) list=list.filter(r=>r.end<=end);
  if (country) list=list.filter(r=>r.country===country);
  res.json({ remittances: list });
});
app.post('/api/remittances', requireAuth, (req,res)=>{
  const db=loadDB(); db.remittances=db.remittances||[];
  const r={
    id:uuidv4(),
    start:req.body.start, end:req.body.end,
    country:req.body.country, productId:req.body.productId,
    orders:+req.body.orders||0, pieces:+req.body.pieces||0,
    revenue:+req.body.revenue||0, adSpend:+req.body.adSpend||0,
    extraPerPiece:+req.body.extraPerPiece||0
  };
  if (!r.start || !r.end || !r.country || !r.productId) return res.status(400).json({ error:'Missing required fields' });
  if (!noChina(r.country)) return res.status(400).json({ error:'China is source-only' });
  db.remittances.push(r); saveDB(db); res.json({ ok:true, remittance:r });
});

/* -------- Finance -------- */
app.get('/api/finance/categories', requireAuth, (req,res)=>{
  const db=loadDB(); res.json(db.finance?.categories || { debit:[], credit:[] });
});
app.post('/api/finance/categories', requireAuth, (req,res)=>{
  const db=loadDB(); db.finance=db.finance||{ categories:{ debit:[],credit:[] }, entries:[] };
  const { type,name } = req.body||{};
  if(!type||!name) return res.status(400).json({ error:'Missing type/name' });
  if(!db.finance.categories[type]) db.finance.categories[type]=[];
  if(!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db); res.json({ ok:true, categories: db.finance.categories });
});
app.delete('/api/finance/categories', requireAuth, (req,res)=>{
  const db=loadDB(); const { type,name } = req.query||{};
  if(!type||!name) return res.status(400).json({ error:'Missing type/name' });
  if(db.finance?.categories?.[type]) db.finance.categories[type]=db.finance.categories[type].filter(c=>c!==name);
  saveDB(db); res.json({ ok:true, categories: db.finance.categories });
});
app.get('/api/finance/entries', requireAuth, (req,res)=>{
  const db=loadDB(); let list=db.finance?.entries||[];
  const { start,end } = req.query||{};
  let period = list;
  if (start) period = period.filter(e=>e.date>=start);
  if (end) period = period.filter(e=>e.date<=end);
  const running = balanceAll(db);
  const balance = period.reduce((a,e)=>a+(e.type==='credit'?+e.amount||0:-(+e.amount||0)),0);
  res.json({ entries: period, running, balance });
});
app.post('/api/finance/entries', requireAuth, (req,res)=>{
  const db=loadDB(); db.finance=db.finance||{ categories:{debit:[],credit:[]}, entries:[] };
  const { date,type,category,amount,note } = req.body||{};
  if(!date||!category||!type) return res.status(400).json({ error:'Missing date/type/category' });
  const entry={ id:uuidv4(), date, type, category, amount:+amount||0, note: note||'' };
  db.finance.entries.push(entry); saveDB(db); res.json({ ok:true, entry });
});
app.delete('/api/finance/entries/:id', requireAuth, (req,res)=>{
  const db=loadDB(); db.finance.entries=(db.finance.entries||[]).filter(e=>e.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* -------- Influencers -------- */
app.get('/api/influencers', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ influencers: db.influencers||[] });
});
app.post('/api/influencers', requireAuth, (req,res)=>{
  const db=loadDB(); db.influencers=db.influencers||[];
  const { name,social,country } = req.body||{};
  if(!name) return res.status(400).json({ error:'Missing name' });
  const inf={ id:uuidv4(), name, social: social||'', country: country||'' };
  db.influencers.push(inf); saveDB(db); res.json({ ok:true, influencer: inf });
});
app.delete('/api/influencers/:id', requireAuth, (req,res)=>{
  const db=loadDB(); db.influencers=(db.influencers||[]).filter(i=>i.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});
app.get('/api/influencers/spend', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ spends: db.influencerSpends||[] });
});
app.post('/api/influencers/spend', requireAuth, (req,res)=>{
  const db=loadDB(); db.influencerSpends=db.influencerSpends||[];
  const { date,influencerId,country,productId,amount } = req.body||{};
  if(!influencerId) return res.status(400).json({ error:'Missing influencerId' });
  const sp={ id:uuidv4(), date: date||new Date().toISOString().slice(0,10), influencerId, country: country||'', productId: productId||'', amount:+amount||0 };
  if (country && !noChina(country)) return res.status(400).json({ error:'China is source-only' });
  db.influencerSpends.push(sp); saveDB(db); res.json({ ok:true, spend: sp });
});
app.delete('/api/influencers/spend/:id', requireAuth, (req,res)=>{
  const db=loadDB(); db.influencerSpends=(db.influencerSpends||[]).filter(s=>s.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* -------- Snapshots (Push keeps file) -------- */
app.get('/api/snapshots', requireAuth, (req,res)=>{
  const db=loadDB(); res.json({ snapshots: db.snapshots||[] });
});
app.post('/api/snapshots', requireAuth, async (req,res)=>{
  ensureSnapshotDir(); const db=loadDB();
  const name=(req.body?.name||'').trim()||`Manual ${new Date().toLocaleString()}`;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const file=path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g,'_')}.json`);
  await fs.copy(DATA_FILE, file);
  const entry={ id:uuidv4(), name, file, createdAt:new Date().toISOString(), kind:'manual' };
  db.snapshots=db.snapshots||[]; db.snapshots.push(entry);
  db.snapshots.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  saveDB(db);
  res.json({ ok:true, file, snapshot: entry });
});
app.post('/api/snapshots/restore', requireAuth, async (req,res)=>{
  const { file } = req.body||{};
  if(!file) return res.status(400).json({ error:'Missing file' });
  const safe=path.join(SNAPSHOT_DIR, path.basename(file));
  if(!fs.existsSync(safe)) return res.status(404).json({ error:'Snapshot not found' });
  await fs.copy(safe, DATA_FILE);
  res.json({ ok:true, restoredFrom: safe });
});
app.delete('/api/snapshots/:id', requireAuth, async (req,res)=>{
  const db=loadDB(); const snap=(db.snapshots||[]).find(s=>s.id===req.params.id);
  if (snap && snap.file && fs.existsSync(snap.file)) { try{ await fs.remove(snap.file); }catch{} }
  db.snapshots=(db.snapshots||[]).filter(s=>s.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* -------- pages -------- */
app.get('/product.html', (req,res)=> res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req,res)=> res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, ()=>console.log(`✅ EAS Tracker running on ${PORT}`));
