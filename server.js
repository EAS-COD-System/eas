// server.js
// EAS Tracker — Express backend (password auth + JSON DB + snapshots)

import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'eastafricashop';

const PUBLIC_DIR   = path.join(__dirname, 'public');
const DATA_FILE    = path.join(__dirname, 'db.json');
const SNAP_DIR     = path.join(__dirname, 'data', 'snapshots'); // manual saves live here

// ---------- middleware ----------
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/public', express.static(PUBLIC_DIR, { fallthrough: true }));

// ---------- tiny helpers ----------
const todayStr = () => new Date().toISOString().slice(0,10);
const parseDate = (d) => new Date(d);
const inRange = (d, s, e) => {
  const t = +new Date(d);
  if (s && t < +new Date(s)) return false;
  if (e && t > +new Date(e)) return false;
  return true;
};
const isoWeekBounds = (date=new Date()) => {
  const d = new Date(date);
  const day = (d.getDay()+6)%7; // Monday=0
  const start = new Date(d); start.setDate(d.getDate()-day); start.setHours(0,0,0,0);
  const end   = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);
  return { start, end };
};

// ensure db & dirs
await fse.ensureFile(DATA_FILE);
await fse.ensureDir(SNAP_DIR);

// ---------- DB (single JSON) ----------
const defaultDB = {
  meta:   { currency: 'USD', theme: { primary:'#0E9F6E', bg:'#fff' }, createdAt: new Date().toISOString() },
  countries: ["china","kenya","tanzania","uganda","zambia","zimbabwe"],
  products: [],                 // {id,name,sku,status, cost_china, ship_china_to_kenya, margin_budget}
  deliveries: [],               // {id,date,country,delivered}
  adSpends: [],                 // {id,date,platform,productId,country,amount}
  shipments: [],                // {id,productId,fromCountry,toCountry,qty,shipCost,departedAt,arrivedAt}
  remittances: [],              // {id,start,end,country,productId,orders,pieces,revenue,adSpend,extraCostPerPiece}
  finance: {
    categories: { debits:["Facebook Ads","TikTok Ads","Google Ads","Shipping","Salaries"], credits:["Revenue Boxleo","Other Revenue"]},
    entries: []                // {id,date,type,category,amount,note}
  },
  snapshots: []                 // {id,label,createdAt,filepath}
};

async function readDB(){
  try{
    const raw = await fse.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) { await writeDB(defaultDB); return { ...defaultDB }; }
    const obj = JSON.parse(raw);
    // shallow patch for missing keys
    return {
      ...defaultDB,
      ...obj,
      meta: { ...defaultDB.meta, ...(obj.meta||{}) },
      finance: { ...defaultDB.finance, ...(obj.finance||{}),
        categories: { ...defaultDB.finance.categories, ...((obj.finance||{}).categories||{}) },
        entries: (obj.finance?.entries)||[]
      }
    };
  }catch{
    await writeDB(defaultDB);
    return { ...defaultDB };
  }
}
async function writeDB(db){
  await fse.writeJson(DATA_FILE, db, { spaces: 2 });
}

// ---------- auth ----------
function guard(req,res,next){
  // allow static, auth, health
  if (req.path.startsWith('/public') || req.path === '/api/auth' || req.path === '/health' ) return next();
  if (req.cookies?.eas_auth === '1') return next();
  return res.status(401).json({ ok:false, error: 'Unauthorized' });
}
app.use(guard);

app.post('/api/auth', async (req,res)=>{
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD){
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('eas_auth','1',{ httpOnly:true, sameSite:'lax', secure:isProd, path:'/' });
    return res.json({ ok:true });
  }
  // cheap logout path used by frontend:
  if (password === 'logout'){
    res.clearCookie('eas_auth'); return res.json({ ok:true });
  }
  return res.status(401).json({ ok:false, error:'Invalid password' });
});

app.get('/health', (req,res)=> res.json({ ok:true }));

// ---------- meta ----------
app.get('/api/meta', async (req,res)=>{
  const db = await readDB();
  const { start, end } = isoWeekBounds(new Date());
  res.json({ meta: db.meta, countries: db.countries, week: { start, end }});
});

// ---------- countries ----------
app.get('/api/countries', async (req,res)=>{
  const db = await readDB();
  res.json({ countries: db.countries });
});
app.post('/api/countries', async (req,res)=>{
  const db = await readDB();
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'Missing name' });
  const n = String(name).trim();
  if (!db.countries.includes(n)) db.countries.push(n);
  await writeDB(db);
  res.json({ ok:true, countries: db.countries });
});
app.delete('/api/countries/:name', async (req,res)=>{
  const db = await readDB();
  const n = req.params.name;
  db.countries = db.countries.filter(c => c !== n);
  await writeDB(db);
  res.json({ ok:true, countries: db.countries });
});

// ---------- products ----------
app.get('/api/products', async (req,res)=>{
  const db = await readDB();
  res.json({ products: db.products });
});
app.post('/api/products', async (req,res)=>{
  const db = await readDB();
  const { name, sku, cost_china=0, ship_china_to_kenya=0, margin_budget=0 } = req.body||{};
  if (!name) return res.status(400).json({ ok:false, error:'Missing name' });
  const p = { id: uuid(), status:'active', name, sku: sku||'', cost_china:+cost_china||0, ship_china_to_kenya:+ship_china_to_kenya||0, margin_budget:+margin_budget||0 };
  db.products.push(p);
  await writeDB(db);
  res.json({ ok:true, product:p });
});
app.delete('/api/products/:id', async (req,res)=>{
  const db = await readDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  await writeDB(db);
  res.json({ ok:true });
});
app.post('/api/products/:id/status', async (req,res)=>{
  const db = await readDB();
  const { status } = req.body || {};
  const p = db.products.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ ok:false, error:'Not found' });
  p.status = status === 'paused' ? 'paused' : 'active';
  await writeDB(db);
  res.json({ ok:true, product:p });
});
app.put('/api/products/:id', async (req,res)=>{
  const db = await readDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok:false, error:'Not found' });
  const patch = req.body || {};
  Object.assign(p, {
    name: patch.name ?? p.name,
    sku: patch.sku ?? p.sku,
    cost_china: patch.cost_china!=null ? +patch.cost_china : p.cost_china,
    ship_china_to_kenya: patch.ship_china_to_kenya!=null ? +patch.ship_china_to_kenya : p.ship_china_to_kenya,
    margin_budget: patch.margin_budget!=null ? +patch.margin_budget : p.margin_budget
  });
  await writeDB(db);
  res.json({ ok:true, product:p });
});

// ---------- deliveries (daily) ----------
app.get('/api/deliveries', async (req,res)=>{
  const db = await readDB();
  const { start, end } = req.query;
  let list = db.deliveries;
  if (start || end) list = list.filter(d => inRange(d.date, start, end));
  // Limit to 8 most recent by default (if no filters)
  if (!start && !end) {
    list = [...list].sort((a,b)=> b.date.localeCompare(a.date)).slice(0, 8);
  }
  res.json({ deliveries: list });
});
app.get('/api/deliveries/current-week', async (req,res)=>{
  const db = await readDB();
  const { start, end } = isoWeekBounds(new Date());
  const days = {};
  db.deliveries.forEach(d=>{
    const dt = new Date(d.date);
    if (dt >= start && dt <= end){
      const key = d.date;
      days[key] = (days[key]||0) + (+d.delivered||0);
    }
  });
  res.json({ days });
});
app.post('/api/deliveries', async (req,res)=>{
  const db = await readDB();
  const { date, country, delivered } = req.body||{};
  if (!date || !country) return res.status(400).json({ ok:false, error:'Missing fields' });
  const row = { id: uuid(), date, country, delivered:+delivered||0 };
  db.deliveries.push(row);
  await writeDB(db);
  res.json({ ok:true, delivery: row });
});
app.put('/api/deliveries/:id', async (req,res)=>{
  const db = await readDB();
  const it = db.deliveries.find(x => x.id === req.params.id);
  if (!it) return res.status(404).json({ ok:false, error:'Not found' });
  const { delivered } = req.body || {};
  if (delivered != null) it.delivered = +delivered;
  await writeDB(db);
  res.json({ ok:true, delivery: it });
});
app.delete('/api/deliveries/:id', async (req,res)=>{
  const db = await readDB();
  db.deliveries = db.deliveries.filter(x => x.id !== req.params.id);
  await writeDB(db);
  res.json({ ok:true });
});

// ---------- ad spend ----------
// NOTE: If client omits `date`, we auto-use today, and we REPLACE existing entry
// for the same (productId, country, platform, date=today) by overwriting amount.
app.get('/api/adspend', async (req,res)=>{
  const db = await readDB();
  res.json({ adSpends: db.adSpends });
});
app.post('/api/adspend', async (req,res)=>{
  const db = await readDB();
  let { date, platform, productId, country, amount } = req.body || {};
  if (!platform || !productId || !country) {
    return res.status(400).json({ ok:false, error:'Missing fields' });
  }
  date = date || todayStr();
  amount = +amount || 0;

  // replace same key (same day, product, platform, country)
  const idx = db.adSpends.findIndex(a => a.date===date && a.platform===platform && a.productId===productId && a.country===country);
  if (idx >= 0){
    db.adSpends[idx].amount = amount;
    await writeDB(db);
    return res.json({ ok:true, ad: db.adSpends[idx], replaced:true });
  } else {
    const row = { id: uuid(), date, platform, productId, country, amount };
    db.adSpends.push(row);
    await writeDB(db);
    return res.json({ ok:true, ad: row, replaced:false });
  }
});

// ---------- shipments (stock movements & transit) ----------
app.get('/api/shipments', async (req,res)=>{
  const db = await readDB();
  res.json({ shipments: db.shipments });
});
app.post('/api/shipments', async (req,res)=>{
  const db = await readDB();
  const { productId, fromCountry, toCountry, qty=0, shipCost=0, departedAt, arrivedAt=null } = req.body||{};
  if (!productId || !fromCountry || !toCountry) return res.status(400).json({ ok:false, error:'Missing fields' });
  const row = {
    id: uuid(),
    productId,
    fromCountry, toCountry,
    qty:+qty||0,
    shipCost:+shipCost||0,
    departedAt: departedAt || todayStr(),
    arrivedAt: arrivedAt || null
  };
  db.shipments.push(row);
  await writeDB(db);
  res.json({ ok:true, shipment: row });
});
app.put('/api/shipments/:id', async (req,res)=>{
  const db = await readDB();
  const shp = db.shipments.find(s => s.id === req.params.id);
  if (!shp) return res.status(404).json({ ok:false, error:'Not found' });
  const { qty, shipCost, arrivedAt, departedAt, fromCountry, toCountry } = req.body||{};
  if (qty != null) shp.qty = +qty;
  if (shipCost != null) shp.shipCost = +shipCost;
  if (arrivedAt != null) shp.arrivedAt = arrivedAt || null;
  if (departedAt != null) shp.departedAt = departedAt || shp.departedAt;
  if (fromCountry) shp.fromCountry = fromCountry;
  if (toCountry)   shp.toCountry   = toCountry;
  await writeDB(db);
  res.json({ ok:true, shipment: shp });
});
app.delete('/api/shipments/:id', async (req,res)=>{
  const db = await readDB();
  db.shipments = db.shipments.filter(s => s.id !== req.params.id);
  await writeDB(db);
  res.json({ ok:true });
});

// ---------- remittances (performance source of truth) ----------
app.get('/api/remittances', async (req,res)=>{
  const db = await readDB();
  const { start, end, country, productId } = req.query || {};
  let list = db.remittances;
  if (start || end) list = list.filter(r => inRange(r.start, start, end) || inRange(r.end, start, end));
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);
  res.json({ remittances: list });
});
app.post('/api/remittances', async (req,res)=>{
  const db = await readDB();
  const {
    start, end, country, productId,
    orders=0, pieces=0, revenue=0, adSpend=0,
    extraCostPerPiece=0 // replaces "costPerDelivery"
  } = req.body || {};
  if (!start || !end || !country || !productId){
    return res.status(400).json({ ok:false, error:'Missing fields' });
  }
  const row = {
    id: uuid(),
    start, end, country, productId,
    orders:+orders||0, pieces:+pieces||0,
    revenue:+revenue||0, adSpend:+adSpend||0,
    extraCostPerPiece:+extraCostPerPiece||0
  };
  db.remittances.push(row);
  // subtract delivered pieces from "stock" approximation (implicit, reported via lists)
  await writeDB(db);
  res.json({ ok:true, remittance: row });
});
app.delete('/api/remittances/:id', async (req,res)=>{
  const db = await readDB();
  db.remittances = db.remittances.filter(x => x.id !== req.params.id);
  await writeDB(db);
  res.json({ ok:true });
});

// ---------- finance ----------
app.get('/api/finance/categories', async (req,res)=>{
  const db = await readDB();
  res.json(db.finance.categories);
});
app.post('/api/finance/categories', async (req,res)=>{
  const db = await readDB();
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ ok:false, error:'Missing fields' });
  const t = type === 'credit' ? 'credits' : 'debits';
  const set = db.finance.categories[t] || [];
  if (!set.includes(name)) set.push(name);
  db.finance.categories[t] = set;
  await writeDB(db);
  res.json({ ok:true, categories: db.finance.categories });
});

app.get('/api/finance/entries', async (req,res)=>{
  const db = await readDB();
  const { start, end, categories='' } = req.query || {};
  let list = db.finance.entries;
  if (start || end) list = list.filter(e => inRange(e.date, start, end));
  if (categories) {
    const set = new Set(categories.split(',').map(s=>s.trim()).filter(Boolean));
    list = list.filter(e => set.has(e.category));
  }
  const balance = list.reduce((acc, e)=> acc + (e.type==='credit' ? +e.amount : -e.amount), 0);
  res.json({ entries: list, balance });
});
app.post('/api/finance/entries', async (req,res)=>{
  const db = await readDB();
  const { date, category, amount=0, note='' } = req.body || {};
  if (!date || !category) return res.status(400).json({ ok:false, error:'Missing fields' });

  // infer type from category groups automatically
  const isCredit = (db.finance.categories.credits || []).includes(category);
  const isDebit  = (db.finance.categories.debits  || []).includes(category);
  const type = isCredit ? 'credit' : 'debit';

  const row = { id: uuid(), date, type, category, amount:+amount||0, note };
  db.finance.entries.push(row);
  await writeDB(db);
  res.json({ ok:true, entry: row });
});
app.delete('/api/finance/entries/:id', async (req,res)=>{
  const db = await readDB();
  db.finance.entries = db.finance.entries.filter(e => e.id !== req.params.id);
  await writeDB(db);
  res.json({ ok:true });
});

// ---------- manual snapshots (save/restore/delete) ----------
app.get('/api/snapshots', async (req,res)=>{
  const db = await readDB();
  res.json({ snapshots: db.snapshots });
});
app.post('/api/snapshots', async (req,res)=>{
  const db = await readDB();
  const { label } = req.body || {};
  const id = uuid();
  const fname = `${id}.json`;
  const filepath = path.join(SNAP_DIR, fname);
  await fse.ensureDir(SNAP_DIR);
  await fse.writeJson(filepath, db, { spaces: 2 });
  const rec = { id, label: (label||'Manual Save'), createdAt: new Date().toISOString(), filepath };
  db.snapshots.push(rec);
  await writeDB(db);
  res.json({ ok:true, snapshot: { id: rec.id, label: rec.label, createdAt: rec.createdAt } });
});
app.post('/api/snapshots/:id/restore', async (req,res)=>{
  const db = await readDB();
  const s = db.snapshots.find(x => x.id === req.params.id);
  if (!s || !(await fse.pathExists(s.filepath))) return res.status(404).json({ ok:false, error:'Snapshot not found' });
  const snap = await fse.readJson(s.filepath);
  // keep snapshots list; replace rest
  const keep = db.snapshots;
  await writeDB({ ...snap, snapshots: keep });
  res.json({ ok:true, restoredFrom: s.label || s.id });
});
app.delete('/api/snapshots/:id', async (req,res)=>{
  const db = await readDB();
  const s = db.snapshots.find(x => x.id === req.params.id);
  db.snapshots = db.snapshots.filter(x => x.id !== req.params.id);
  if (s && s.filepath) { try { await fse.remove(s.filepath); } catch {} }
  await writeDB(db);
  res.json({ ok:true });
});

// ---------- SPA fallback ----------
app.get('/', (req,res)=> res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('*', (req,res)=> res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---------- start ----------
app.listen(PORT, ()=> {
  console.log(`EAS Tracker running on :${PORT}`);
});
