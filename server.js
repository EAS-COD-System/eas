// server.js
// EAS Tracker – Express backend using a single JSON file (db.json) for storage.
// Password-protected; cookie-based; works on Render with a mounted /data volume.

import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import morgan from 'morgan';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- Config ----------
const PORT            = process.env.PORT || 10000;
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || 'eastafricashop';
const TZ              = process.env.TZ || 'Africa/Casablanca';

process.env.TZ = TZ;

// Data paths
const DATA_DIR   = path.join(__dirname, 'data');      // Render disk mount should point here
const DB_FILE    = path.join(__dirname, 'db.json');   // We keep db.json in repo root; copy to DATA_DIR on boot
const LIVE_DB    = path.join(DATA_DIR, 'db.json');    // The live/persistent copy used by the app
const SNAP_DIR   = path.join(DATA_DIR, 'snapshots');  // snapshot.js will populate this

// Ensure dirs exist
await fs.ensureDir(DATA_DIR);
await fs.ensureDir(SNAP_DIR);

// If there is no live db yet, seed from repo db.json or create fresh
if (!(await fs.pathExists(LIVE_DB))) {
  if (await fs.pathExists(DB_FILE)) {
    await fs.copy(DB_FILE, LIVE_DB);
  } else {
    await fs.writeJson(LIVE_DB, freshDB(), { spaces: 2 });
  }
}

// ---------- Util ----------
const loadDB = async () => (await fs.readJson(LIVE_DB).catch(()=>freshDB()));
const saveDB = async (db) => fs.writeJson(LIVE_DB, db, { spaces: 2 });

const todayISO = () => new Date().toISOString().slice(0,10);
const toDate = (d) => new Date(d);
const clampDate = (d) => new Date(new Date(d).toDateString()); // strip time
const diffDays = (a,b) => Math.round((clampDate(b)-clampDate(a))/86400000);

function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay()+6)%7; // Monday=0
  d.setDate(d.getDate()-day);
  d.setHours(0,0,0,0);
  return d;
}
function sundayOf(date) {
  const m = mondayOf(date);
  const s = new Date(m);
  s.setDate(m.getDate()+6);
  s.setHours(23,59,59,999);
  return s;
}
function weekKey(date=new Date()) {
  return mondayOf(date).toISOString().slice(0,10); // YYYY-MM-DD (monday)
}
function ensureWeeklyGrid(db, wk, countries) {
  if (!db.deliveriesWeekly[wk]) {
    db.deliveriesWeekly[wk] = {};
  }
  countries.forEach(c=>{
    if (!db.deliveriesWeekly[wk][c]) {
      db.deliveriesWeekly[wk][c] = { Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0, Sun:0 };
    }
  });
  return db.deliveriesWeekly[wk];
}
function dayKeyFromDate(dateStr) {
  const d = new Date(dateStr);
  const map = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return map[d.getDay()];
}

// Fresh DB shape
function freshDB(){
  return {
    meta: { currency:'USD', theme:{primary:'#0E9F6E', bg:'#fff'}, createdAt: new Date().toISOString() },
    countries: ["china","kenya","tanzania","uganda","zambia","zimbabwe"],
    products: [],                  // {id,name,sku,cost_china,ship_china_to_kenya,margin_budget,status}
    shipments: [],                 // {id,productId,fromCountry,toCountry,qty,shipCost,departedAt,arrivedAt,daysInTransit}
    remittances: [],               // {id,start,end,country,productId,orders,pieces,revenue,adSpend,extraCostPerPiece}
    adSpends: [],                  // daily upsert rows: {id,date,country,productId,platform,amount}
    deliveries: [],                // legacy list: {date,country,delivered}
    deliveriesWeekly: {},          // { weekKey: { country: {Mon..Sun} } }
    financeCategories: {debits:["Facebook Ads","TikTok Ads","Google Ads","Shipping","Salaries"], credits:["Revenue Boxleo","Other Revenue"]},
    financeEntries: [],            // {id,date,type('debit'|'credit'),category,amount,note}
    influencers: [],               // {id,name,social,country}
    influencersSpend: [],          // {id,date,influencerId,amount,country,productId?}
    allowlistIPs: []               // IPs passed login
  };
}

// ---------- App ----------
const app = express();
app.use(morgan('tiny'));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());
app.use(cookieParser());

// Static frontend
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// ---------- Auth ----------
function clientIP(req){
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim())
      || req.headers['x-real-ip']
      || req.ip
      || 'unknown';
}

async function authed(req,res,next){
  try{
    const db = await loadDB();
    const ip = clientIP(req);
    const hasCookie = req.cookies.eas_auth === '1';
    const whitelisted = db.allowlistIPs.includes(ip);
    if (hasCookie || whitelisted) return next();
    return res.status(401).json({ ok:false, error:'Unauthorized' });
  }catch(e){
    return res.status(500).json({ ok:false, error:'Auth check failed' });
  }
}

// Login (password -> cookie + IP allow)
app.post('/api/auth', async (req,res)=>{
  const { password } = req.body || {};
  const db = await loadDB();
  const ip = clientIP(req);

  if (password === ADMIN_PASSWORD) {
    if (!db.allowlistIPs.includes(ip)) {
      db.allowlistIPs.push(ip);
      await saveDB(db);
    }
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('eas_auth', '1', { httpOnly:true, sameSite:'lax', secure:isProd, path:'/' });
    return res.json({ ok:true, ip });
  }
  // soft logout support (some old frontends used password:'logout')
  if (password === 'logout') {
    db.allowlistIPs = db.allowlistIPs.filter(x=>x!==ip);
    await saveDB(db);
    res.clearCookie('eas_auth');
    return res.json({ ok:true, loggedOut:true });
  }
  return res.status(401).json({ ok:false, error:'Invalid password' });
});

// ---------- Meta ----------
app.get('/api/meta', authed, async (req,res)=>{
  const db = await loadDB();
  const wkStart = mondayOf(new Date());
  const wkEnd   = sundayOf(new Date());
  return res.json({
    meta: db.meta,
    countries: db.countries,
    week: { start: wkStart, end: wkEnd }
  });
});

// ---------- Countries ----------
app.get('/api/countries', authed, async (req,res)=>{
  const db = await loadDB();
  res.json({ countries: db.countries });
});
app.post('/api/countries', authed, async (req,res)=>{
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'Missing name' });
  const db = await loadDB();
  if (!db.countries.includes(name)) db.countries.push(name);
  await saveDB(db);
  res.json({ ok:true, countries: db.countries });
});
app.delete('/api/countries/:name', authed, async (req,res)=>{
  const db = await loadDB();
  db.countries = db.countries.filter(c=>c!==req.params.name);
  await saveDB(db);
  res.json({ ok:true, countries: db.countries });
});

// ---------- Products ----------
app.get('/api/products', authed, async (req,res)=>{
  const db = await loadDB();
  res.json({ products: db.products });
});
app.post('/api/products', authed, async (req,res)=>{
  const { name, sku, cost_china=0, ship_china_to_kenya=0, margin_budget=0 } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'Missing name' });
  const db = await loadDB();
  const p = { id: uuid(), name, sku: sku||'', cost_china:+cost_china||0, ship_china_to_kenya:+ship_china_to_kenya||0, margin_budget:+margin_budget||0, status:'active' };
  db.products.push(p);
  await saveDB(db);
  res.json({ ok:true, product:p });
});
app.post('/api/products/:id/status', authed, async (req,res)=>{
  const db = await loadDB();
  const p = db.products.find(x=>x.id===req.params.id);
  if (!p) return res.status(404).json({ ok:false, error:'Not found' });
  p.status = req.body?.status==='paused' ? 'paused' : 'active';
  await saveDB(db);
  res.json({ ok:true, product:p });
});
app.delete('/api/products/:id', authed, async (req,res)=>{
  const db = await loadDB();
  db.products = db.products.filter(x=>x.id!==req.params.id);
  await saveDB(db);
  res.json({ ok:true });
});

// ---------- Shipments (movements + transit) ----------
app.get('/api/shipments', authed, async (req,res)=>{
  const db = await loadDB();
  res.json({ shipments: db.shipments });
});
app.post('/api/shipments', authed, async (req,res)=>{
  const { productId, fromCountry, toCountry, qty=0, shipCost=0, departedAt, arrivedAt=null } = req.body || {};
  if (!productId || !fromCountry || !toCountry) return res.status(400).json({ ok:false, error:'Missing fields' });
  const db = await loadDB();
  const s = {
    id: uuid(),
    productId,
    fromCountry,
    toCountry,
    qty:+qty||0,
    shipCost:+shipCost||0,
    departedAt: departedAt || todayISO(),
    arrivedAt: arrivedAt || null,
    daysInTransit: arrivedAt ? diffDays(departedAt||todayISO(), arrivedAt) : null
  };
  db.shipments.push(s);
  await saveDB(db);
  res.json({ ok:true, shipment: s });
});
app.put('/api/shipments/:id', authed, async (req,res)=>{
  const db = await loadDB();
  const s = db.shipments.find(x=>x.id===req.params.id);
  if (!s) return res.status(404).json({ ok:false, error:'Not found' });

  // Editable fields: qty, shipCost, departedAt, arrivedAt
  if (req.body.hasOwnProperty('qty'))      s.qty = +req.body.qty || 0;
  if (req.body.hasOwnProperty('shipCost')) s.shipCost = +req.body.shipCost || 0;
  if (req.body.departedAt) s.departedAt = req.body.departedAt;
  if (req.body.arrivedAt !== undefined) {
    s.arrivedAt = req.body.arrivedAt || null;
    s.daysInTransit = s.arrivedAt ? diffDays(s.departedAt || todayISO(), s.arrivedAt) : null;
  }
  await saveDB(db);
  res.json({ ok:true, shipment: s });
});
app.delete('/api/shipments/:id', authed, async (req,res)=>{
  const db = await loadDB();
  db.shipments = db.shipments.filter(x=>x.id!==req.params.id);
  await saveDB(db);
  res.json({ ok:true });
});

// ---------- Daily Delivered (Weekly grid) ----------
// Returns current week grid + totals
app.get('/api/deliveries/current-week', authed, async (req,res)=>{
  const db = await loadDB();
  const wk = weekKey(new Date());
  const grid = ensureWeeklyGrid(db, wk, db.countries);
  // totals by weekday
  const days = { Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0, Sun:0 };
  Object.values(grid).forEach(row=>{
    Object.keys(days).forEach(k=> days[k] += (+row[k]||0));
  });
  await saveDB(db);
  return res.json({ ok:true, week:wk, grid, days });
});

// Upsert a single cell in the weekly table: {week, country, dayKey('Mon'...'Sun'), value}
app.post('/api/deliveries/week-cell', authed, async (req,res)=>{
  const { week, country, day, value } = req.body || {};
  if (!week || !country || !day) return res.status(400).json({ ok:false, error:'Missing fields' });
  const db = await loadDB();
  ensureWeeklyGrid(db, week, db.countries);
  if (!db.deliveriesWeekly[week][country]) {
    db.deliveriesWeekly[week][country] = { Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0, Sun:0 };
  }
  db.deliveriesWeekly[week][country][day] = +value || 0;

  // Also mirror to legacy "deliveries" list with a concrete date (for charts/filters):
  // Map day -> actual date within week
  const base = mondayOf(week);
  const mapIdx = {Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6};
  const d = new Date(base); d.setDate(base.getDate() + (mapIdx[day]||0));
  const dateISO = d.toISOString().slice(0,10);
  // Remove any previous entry for that date/country, then push new
  db.deliveries = db.deliveries.filter(x=> !(x.date===dateISO && x.country===country));
  db.deliveries.push({ date: dateISO, country, delivered: (+value||0) });

  await saveDB(db);
  res.json({ ok:true, grid: db.deliveriesWeekly[week][country] });
});

// Reset the whole current week (all countries Mon..Sun -> 0)
app.post('/api/deliveries/reset-week', authed, async (req,res)=>{
  const db = await loadDB();
  const wk = req.body?.week || weekKey(new Date());
  ensureWeeklyGrid(db, wk, db.countries);
  Object.keys(db.deliveriesWeekly[wk]).forEach(country=>{
    db.deliveriesWeekly[wk][country] = { Mon:0, Tue:0, Wed:0, Thu:0, Fri:0, Sat:0, Sun:0 };
  });
  // Also clear legacy deliveries within that week window
  const start = mondayOf(wk), end = sundayOf(wk);
  db.deliveries = db.deliveries.filter(x=>{
    const dx = new Date(x.date);
    return !(dx >= start && dx <= end);
  });
  await saveDB(db);
  res.json({ ok:true });
});

// Legacy list/filter for compatibility with UI filterDeliveries()
app.get('/api/deliveries', authed, async (req,res)=>{
  const { start, end } = req.query;
  const db = await loadDB();
  let list = db.deliveries.slice().sort((a,b)=> a.date.localeCompare(b.date));
  if (start) list = list.filter(x => new Date(x.date) >= new Date(start));
  if (end)   list = list.filter(x => new Date(x.date) <= new Date(end));
  // limit to last 8 rows if no filter (as per original requirement to avoid many lines)
  if (!start && !end) list = list.slice(-8);
  res.json({ ok:true, deliveries: list });
});

// ---------- Daily Ad Spend (no date pick; upsert per day/platform/product/country) ----------
app.get('/api/adspend', authed, async (req,res)=>{
  const db = await loadDB();
  res.json({ ok:true, adSpends: db.adSpends });
});

// body: {platform, productId, country, amount}
app.post('/api/adspend', authed, async (req,res)=>{
  const { platform, productId, country, amount=0 } = req.body || {};
  if (!platform || !productId || !country) return res.status(400).json({ ok:false, error:'Missing fields' });
  const db = await loadDB();
  const date = todayISO();

  // Replace any existing spend for (date, platform, productId, country)
  db.adSpends = db.adSpends.filter(x=> !(x.date===date && x.platform===platform && x.productId===productId && x.country===country));
  db.adSpends.push({ id: uuid(), date, platform, productId, country, amount:+amount||0 });

  await saveDB(db);
  res.json({ ok:true });
});

// ---------- Remittances (used for profits, top delivered, stock deduction) ----------
// GET with optional filters: start, end, country, productId
app.get('/api/remittances', authed, async (req,res)=>{
  const db = await loadDB();
  let list = db.remittances.slice();
  const { start, end, country, productId } = req.query || {};
  if (start)   list = list.filter(x => new Date(x.end || x.start) >= new Date(start));
  if (end)     list = list.filter(x => new Date(x.start) <= new Date(end));
  if (country) list = list.filter(x => x.country === country);
  if (productId) list = list.filter(x => x.productId === productId);
  res.json({ ok:true, remittances: list });
});

// POST body: {start,end,country,productId,orders,pieces,revenue,adSpend,extraCostPerPiece}
app.post('/api/remittances', authed, async (req,res)=>{
  const {
    start, end, country, productId,
    orders=0, pieces=0, revenue=0, adSpend=0, extraCostPerPiece=0
  } = req.body || {};
  if (!start || !end || !country || !productId) return res.status(400).json({ ok:false, error:'Missing fields' });

  const db = await loadDB();
  const r = {
    id: uuid(),
    start, end, country, productId,
    orders:+orders||0, pieces:+pieces||0,
    revenue:+revenue||0, adSpend:+adSpend||0,
    extraCostPerPiece:+extraCostPerPiece||0
  };
  db.remittances.push(r);

  // Stock deduction is computed dynamically (arrived shipments - pieces sold).
  await saveDB(db);
  res.json({ ok:true, remittance: r });
});

// ---------- Finance ----------
app.get('/api/finance/categories', authed, async (req,res)=>{
  const db = await loadDB();
  res.json(db.financeCategories);
});

// Add category {type:'debit'|'credit', name}
app.post('/api/finance/categories', authed, async (req,res)=>{
  const { type, name } = req.body || {};
  if (!['debit','credit'].includes(type) || !name) return res.status(400).json({ ok:false, error:'Bad input' });
  const db = await loadDB();
  const list = type==='debit' ? db.financeCategories.debits : db.financeCategories.credits;
  if (!list.includes(name)) list.push(name);
  await saveDB(db);
  res.json({ ok:true, financeCategories: db.financeCategories });
});

// List entries with optional filter (start, end, categories="A,B")
app.get('/api/finance/entries', authed, async (req,res)=>{
  const db = await loadDB();
  let list = db.financeEntries.slice().sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  const { start, end, categories } = req.query || {};
  if (start) list = list.filter(x => new Date(x.date) >= new Date(start));
  if (end)   list = list.filter(x => new Date(x.date) <= new Date(end));
  if (categories) {
    const set = new Set(String(categories).split(',').map(s=>s.trim()).filter(Boolean));
    if (set.size) list = list.filter(x => set.has(x.category));
  }
  const balance = list.reduce((acc,x)=> acc + (x.type==='credit'? +x.amount : -x.amount), 0);
  res.json({ ok:true, entries:list, balance });
});

// Add entry {date,type,category,amount,note}
app.post('/api/finance/entries', authed, async (req,res)=>{
  const { date, type, category, amount=0, note='' } = req.body || {};
  if (!date || !category || !['debit','credit'].includes(type)) return res.status(400).json({ ok:false, error:'Bad input' });
  const db = await loadDB();
  db.financeEntries.push({ id:uuid(), date, type, category, amount:+amount||0, note });
  await saveDB(db);
  res.json({ ok:true });
});

// Delete finance entry
app.delete('/api/finance/entries/:id', authed, async (req,res)=>{
  const db = await loadDB();
  db.financeEntries = db.financeEntries.filter(x=>x.id!==req.params.id);
  await saveDB(db);
  res.json({ ok:true });
});

// Running balance (all-time) for the big header box
app.get('/api/finance/balance', authed, async (req,res)=>{
  const db = await loadDB();
  const bal = db.financeEntries.reduce((acc,x)=> acc + (x.type==='credit'? +x.amount : -x.amount), 0);
  res.json({ ok:true, balance: bal });
});

// ---------- Lifetime Performance helper (server-side compute) ----------
app.get('/api/lifetime', authed, async (req,res)=>{
  const db = await loadDB();
  const { start, end, productId } = req.query || {};
  const productsById = Object.fromEntries(db.products.map(p=>[p.id,p]));
  // filter remittances by date/product
  let rem = db.remittances.slice();
  if (start) rem = rem.filter(x=> new Date(x.end||x.start) >= new Date(start));
  if (end)   rem = rem.filter(x=> new Date(x.start) <= new Date(end));
  if (productId) rem = rem.filter(x=> x.productId===productId);

  // sum shipping costs per product (arrived shipments only)
  let ship = db.shipments.filter(s=> s.arrivedAt);
  if (productId) ship = ship.filter(s=> s.productId===productId);

  const byP = {};
  rem.forEach(r=>{
    const base = (+productsById[r.productId]?.cost_china||0) + (+productsById[r.productId]?.ship_china_to_kenya||0);
    const pieces = +r.pieces||0;
    if (!byP[r.productId]) byP[r.productId] = { revenue:0, ad:0, ship:0, base:0, pieces:0 };
    byP[r.productId].revenue += +r.revenue||0;
    byP[r.productId].ad      += +r.adSpend||0;
    byP[r.productId].base    += base * pieces;
    byP[r.productId].pieces  += pieces;
    // include extra cost per piece (new requirement replaces old CPD)
    byP[r.productId].base    += (+r.extraCostPerPiece||0) * pieces;
  });
  ship.forEach(s=>{
    if (!byP[s.productId]) byP[s.productId] = { revenue:0, ad:0, ship:0, base:0, pieces:0 };
    byP[s.productId].ship += +s.shipCost||0;
  });

  const rows = Object.entries(byP).map(([pid,v])=>{
    const profit = v.revenue - v.ad - v.ship - v.base;
    return {
      productId: pid,
      productName: productsById[pid]?.name || pid,
      revenue: v.revenue, adSpend: v.ad, shipping: v.ship, baseCost: v.base, pieces: v.pieces, profit
    };
  });
  res.json({ ok:true, items: rows });
});

// ---------- Restore from snapshots ----------
app.post('/api/restore', authed, async (req,res)=>{
  try{
    const { window } = req.body || {}; // '10m'|'1h'|'24h'|'3d'
    const now = new Date();
    const cutoff = new Date(now);

    const map = { '10m': 10*60e3, '1h': 60*60e3, '24h': 24*60*60e3, '3d': 3*24*60*60e3 };
    const ms = map[window] || map['24h'];
    cutoff.setTime(now.getTime() - ms);

    // Find latest snapshot folder newer than cutoff that contains db.json
    const entries = await fs.readdir(SNAP_DIR).catch(()=>[]);
    let candidates = [];
    for (const name of entries) {
      const p = path.join(SNAP_DIR, name);
      const stat = await fs.stat(p).catch(()=>null);
      if (!stat || !stat.isDirectory()) continue;
      const dbp = path.join(p, 'db.json');
      if (await fs.pathExists(dbp)) {
        candidates.push({ name, path: p, time: stat.mtime });
      }
    }
    candidates = candidates
      .filter(c => c.time >= cutoff)
      .sort((a,b)=> b.time - a.time);

    if (!candidates.length) {
      return res.status(404).json({ ok:false, error:'No snapshots found' });
    }

    const pick = candidates[0];
    await fs.copy(path.join(pick.path, 'db.json'), LIVE_DB);
    return res.json({ ok:true, restoredFrom: pick.name });
  }catch(e){
    return res.status(500).json({ ok:false, error: 'Restore failed' });
  }
});

// ---------- Fallback to SPA ----------
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

// ---------- Start ----------
app.listen(PORT, ()=> {
  console.log(`EAS Tracker listening on ${PORT} (TZ=${TZ})`);
});
