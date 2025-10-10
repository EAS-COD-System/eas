// server.js — EAS Tracker backend (Express + JSON DB)
// - Password: process.env.ADMIN_PASSWORD (default: "eastafricashop")
// - Data:     DATA_DIR=/data (Render persistent storage)
// - DB file:  <DATA_DIR>/db.json
// - Snapshots directory: <DATA_DIR>/snapshots/  (used by scripts/snapshot.js)

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fse from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

// ------------------------ config ------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PORT            = process.env.PORT || 3000;
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || 'eastafricashop';
const DATA_DIR        = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE         = path.join(DATA_DIR, 'db.json');
const SNAPSHOT_DIR    = path.join(DATA_DIR, 'snapshots');

// default countries
const DEFAULT_COUNTRIES = ["china","kenya","tanzania","uganda","zambia","zimbabwe"];

// ------------------------ helpers ------------------------
async function ensureDirs() {
  await fse.ensureDir(DATA_DIR);
  await fse.ensureDir(SNAPSHOT_DIR);
}

async function loadDB() {
  await ensureDirs();
  if (!(await fse.pathExists(DB_FILE))) {
    const initial = {
      meta: { currency: "USD", theme: { primary: "#0E9F6E", bg: "#ffffff" }, createdAt: new Date().toISOString() },
      countries: [...DEFAULT_COUNTRIES],
      products: [],               // {id,name,sku,status, cost_china, ship_china_to_kenya, margin_budget}
      deliveries: [],             // {id,date,country,delivered}
      adSpends: [],               // {id,date,platform,productId,country,amount}
      shipments: [],              // {id,productId,fromCountry,toCountry,qty,shipCost,departedAt,arrivedAt}
      remittances: [],            // {id,start,end,country,productId,orders,pieces,revenue,adSpend,costPerDelivery}
      financeCategories: { debits:["Facebook Ads","TikTok Ads","Google Ads","Shipping","Salaries"], credits:["Revenue Boxleo","Other Revenue"] },
      financeEntries: [],         // {id,date,type,debit|credit,category,amount,note}
      allowlistIPs: []            // optional: keep whitelisted IPs if you want (not required with cookie)
    };
    await fse.writeJson(DB_FILE, initial, { spaces: 2 });
  }
  return fse.readJson(DB_FILE);
}

async function saveDB(db) {
  await fse.writeJson(DB_FILE, db, { spaces: 2 });
}

function getClientIP(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim())
      || req.headers['x-real-ip']
      || req.ip
      || '';
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map(s=>s.trim());
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    if (k === name) return rest.join('=');
  }
  return '';
}

function setAuthCookie(res) {
  // Lax + HttpOnly for simple session
  const cookie = `eas_auth=1; Path=/; SameSite=Lax; HttpOnly`;
  res.setHeader('Set-Cookie', cookie);
}

function clearAuthCookie(res) {
  const cookie = `eas_auth=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`;
  res.setHeader('Set-Cookie', cookie);
}

function mondayOf(dateStr) {
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  d.setHours(0,0,0,0);
  return d;
}

function inRange(dateStr, start, end) {
  const t  = new Date(dateStr).getTime();
  if (start && t < new Date(start).getTime()) return false;
  if (end   && t > new Date(end).getTime())   return false;
  return true;
}

// ------------------------ app ------------------------
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json());

// health for Render
app.get('/healthz', (_req,res)=> res.status(200).send('ok'));

// ------------- auth -------------
app.post('/api/auth', async (req, res) => {
  try {
    const { password } = req.body || {};
    if (password === ADMIN_PASSWORD) {
      setAuthCookie(res);
      return res.json({ ok: true });
    }
    // special-case a sloppy "logout" from older UI
    if (password === 'logout') {
      clearAuthCookie(res);
      return res.json({ ok: true });
    }
    return res.status(401).json({ ok:false, error:'Invalid password' });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// auth guard for the rest of APIs
app.use('/api', (req, res, next) => {
  if (req.path === '/auth') return next();
  const cookie = getCookie(req, 'eas_auth');
  if (cookie === '1') return next();
  return res.status(401).json({ ok:false, error:'Unauthorized' });
});

// ------------- meta -------------
app.get('/api/meta', async (_req, res) => {
  const db = await loadDB();
  const today = new Date();
  const weekStart = mondayOf(today.toISOString());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate()+6); weekEnd.setHours(23,59,59,999);
  res.json({
    meta: db.meta,
    countries: db.countries,
    week: { start: weekStart, end: weekEnd }
  });
});

// ------------- countries -------------
app.get('/api/countries', async (_req, res) => {
  const db = await loadDB();
  res.json({ countries: db.countries });
});

app.post('/api/countries', async (req, res) => {
  const db = await loadDB();
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'Missing name' });
  if (!db.countries.includes(name)) db.countries.push(name);
  await saveDB(db);
  res.json({ ok:true, countries: db.countries });
});

// ------------- products -------------
app.get('/api/products', async (_req, res) => {
  const db = await loadDB();
  res.json({ products: db.products });
});

app.post('/api/products', async (req, res) => {
  const db = await loadDB();
  const { name, sku, cost_china=0, ship_china_to_kenya=0, margin_budget=0 } = req.body || {};
  if (!name) return res.status(400).json({ ok:false, error:'Missing product name' });
  const p = { id: uuid(), name, sku, status:'active', cost_china:+cost_china||0, ship_china_to_kenya:+ship_china_to_kenya||0, margin_budget:+margin_budget||0 };
  db.products.push(p);
  await saveDB(db);
  res.json({ ok:true, product: p });
});

app.post('/api/products/:id/status', async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  const { status } = req.body || {};
  const p = db.products.find(x=>x.id===id);
  if (!p) return res.status(404).json({ ok:false, error:'Not found' });
  if (!['active','paused'].includes(status)) return res.status(400).json({ ok:false, error:'Invalid status' });
  p.status = status;
  await saveDB(db);
  res.json({ ok:true, product: p });
});

app.delete('/api/products/:id', async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  const i = db.products.findIndex(x=>x.id===id);
  if (i === -1) return res.status(404).json({ ok:false, error:'Not found' });
  db.products.splice(i,1);
  await saveDB(db);
  res.json({ ok:true });
});

// ------------- deliveries -------------
app.get('/api/deliveries', async (req, res) => {
  const db = await loadDB();
  let { start, end } = req.query || {};
  let list = db.deliveries || [];

  if (start || end) {
    list = list.filter(d => inRange(d.date, start, end));
  } else {
    // default: last 8 distinct days, newest first
    const byDate = {};
    (db.deliveries||[]).forEach(d=>{
      if (!byDate[d.date]) byDate[d.date] = [];
      byDate[d.date].push(d);
    });
    const dates = Object.keys(byDate).sort((a,b)=> new Date(b)-new Date(a)).slice(0,8);
    list = dates.flatMap(d=> byDate[d].map(x=>x)).sort((a,b)=> new Date(a.date)-new Date(b.date));
  }

  res.json({ deliveries: list });
});

app.get('/api/deliveries/current-week', async (_req, res) => {
  const db = await loadDB();
  const today = new Date();
  const start = mondayOf(today.toISOString());
  const end = new Date(start); end.setDate(start.getDate()+6); end.setHours(23,59,59,999);

  const days = { Monday:0, Tuesday:0, Wednesday:0, Thursday:0, Friday:0, Saturday:0, Sunday:0 };
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  (db.deliveries||[]).forEach(d=>{
    const t = new Date(d.date);
    if (t >= start && t <= end) {
      const wname = names[t.getDay()];
      // remap to Monday..Sunday keys
      const key = wname === 'Sunday' ? 'Sunday' : wname;
      days[key] = (days[key]||0) + (+d.delivered||0);
    }
  });
  res.json({ days });
});

app.post('/api/deliveries', async (req, res) => {
  const db = await loadDB();
  const { date, country, delivered=0 } = req.body || {};
  if (!date || !country) return res.status(400).json({ ok:false, error:'Missing date or country' });
  db.deliveries.push({ id: uuid(), date, country, delivered:+delivered||0 });
  await saveDB(db);
  res.json({ ok:true });
});

// ------------- ad spend -------------
app.get('/api/adspend', async (_req, res) => {
  const db = await loadDB();
  res.json({ adSpends: db.adSpends || [] });
});

app.post('/api/adspend', async (req, res) => {
  const db = await loadDB();
  const { date, platform, productId, country, amount=0 } = req.body || {};
  if (!date || !platform || !productId || !country) return res.status(400).json({ ok:false, error:'Missing fields' });

  // Replace existing for same (date,platform,productId,country) or append if none
  const i = (db.adSpends||[]).findIndex(x =>
    x.date===date && x.platform===platform && x.productId===productId && x.country===country
  );
  if (i>=0) db.adSpends[i] = { ...db.adSpends[i], amount:+amount||0 };
  else db.adSpends.push({ id: uuid(), date, platform, productId, country, amount:+amount||0 });

  await saveDB(db);
  res.json({ ok:true });
});

// ------------- shipments (movements) -------------
app.get('/api/shipments', async (_req, res) => {
  const db = await loadDB();
  res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', async (req, res) => {
  const db = await loadDB();
  const { productId, fromCountry, toCountry, qty=0, shipCost=0, departedAt, arrivedAt=null } = req.body || {};
  if (!productId || !fromCountry || !toCountry) return res.status(400).json({ ok:false, error:'Missing fields' });

  const sh = {
    id: uuid(),
    productId,
    fromCountry, toCountry,
    qty:+qty||0,
    shipCost:+shipCost||0,
    departedAt: departedAt || new Date().toISOString().slice(0,10),
    arrivedAt: arrivedAt
  };
  db.shipments.push(sh);
  await saveDB(db);
  res.json({ ok:true, shipment: sh });
});

app.put('/api/shipments/:id', async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  const { arrivedAt, ...rest } = req.body || {};
  const s = (db.shipments||[]).find(x=>x.id===id);
  if (!s) return res.status(404).json({ ok:false, error:'Not found' });
  if (arrivedAt !== undefined) s.arrivedAt = arrivedAt;
  Object.assign(s, rest);
  await saveDB(db);
  res.json({ ok:true, shipment: s });
});

app.delete('/api/shipments/:id', async (req, res) => {
  const db = await loadDB();
  const { id } = req.params;
  const i = (db.shipments||[]).findIndex(x=>x.id===id);
  if (i === -1) return res.status(404).json({ ok:false, error:'Not found' });
  db.shipments.splice(i,1);
  await saveDB(db);
  res.json({ ok:true });
});

// ------------- remittances -------------
app.get('/api/remittances', async (req, res) => {
  const db = await loadDB();
  const { start, end, country, productId } = req.query || {};
  let list = db.remittances || [];
  if (start || end) list = list.filter(r => inRange(r.start, start, end) || inRange(r.end, start, end));
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);
  res.json({ remittances: list });
});

app.post('/api/remittances', async (req, res) => {
  const db = await loadDB();
  const { start, end, country, productId, orders=0, pieces=0, revenue=0, adSpend=0, costPerDelivery=0 } = req.body || {};
  if (!start || !end || !country || !productId) return res.status(400).json({ ok:false, error:'Missing fields' });

  const r = {
    id: uuid(),
    start, end, country, productId,
    orders:+orders||0, pieces:+pieces||0,
    revenue:+revenue||0, adSpend:+adSpend||0,
    costPerDelivery:+costPerDelivery||0
  };
  db.remittances.push(r);

  // subtract delivered pieces from available stock in destination implicitly (used client-side)
  await saveDB(db);
  res.json({ ok:true, remittance: r });
});

// ------------- finance -------------
app.get('/api/finance/categories', async (_req, res) => {
  const db = await loadDB();
  res.json(db.financeCategories || { debits:[], credits:[] });
});

app.post('/api/finance/categories', async (req, res) => {
  const db = await loadDB();
  const { type, name } = req.body || {};
  if (!['debit','credit'].includes(type) || !name) return res.status(400).json({ ok:false, error:'Invalid' });
  if (type === 'debit') {
    if (!db.financeCategories.debits.includes(name)) db.financeCategories.debits.push(name);
  } else {
    if (!db.financeCategories.credits.includes(name)) db.financeCategories.credits.push(name);
  }
  await saveDB(db);
  res.json({ ok:true, ...db.financeCategories });
});

app.get('/api/finance/entries', async (req, res) => {
  const db = await loadDB();
  const { start, end, categories } = req.query || {};
  let list = db.financeEntries || [];
  if (start || end) list = list.filter(x => inRange(x.date, start, end));
  if (categories) {
    const set = new Set(categories.split(',').map(s=>s.trim()).filter(Boolean));
    if (set.size) list = list.filter(x => set.has(x.category));
  }
  const balance = (list||[]).reduce((acc, x) => {
    if (x.type === 'credit') return acc + (+x.amount||0);
    if (x.type === 'debit')  return acc - (+x.amount||0);
    return acc;
  }, 0);
  res.json({ entries: list, balance });
});

app.post('/api/finance/entries', async (req, res) => {
  const db = await loadDB();
  const { date, type, category, amount=0, note='' } = req.body || {};
  if (!date || !type || !category) return res.status(400).json({ ok:false, error:'Missing fields' });
  if (!['debit','credit'].includes(type)) return res.status(400).json({ ok:false, error:'Invalid type' });
  const e = { id: uuid(), date, type, category, amount:+amount||0, note };
  db.financeEntries.push(e);
  await saveDB(db);
  res.json({ ok:true, entry:e });
});

// ------------- restore from snapshots -------------
app.post('/api/restore', async (req, res) => {
  try {
    const { window } = req.body || {};
    const now = Date.now();
    let deltaMs;
    if (window === '10m') deltaMs = 10*60*1000;
    else if (window === '1h') deltaMs = 60*60*1000;
    else if (window === '24h') deltaMs = 24*60*60*1000;
    else if (window === '3d') deltaMs = 3*24*60*60*1000;
    else return res.status(400).json({ ok:false, error:'Invalid window' });

    const files = (await fse.pathExists(SNAPSHOT_DIR)) ? await fse.readdir(SNAPSHOT_DIR) : [];
    const jsons = files.filter(f => f.endsWith('.json')).map(f => path.join(SNAPSHOT_DIR, f));
    if (!jsons.length) return res.status(404).json({ ok:false, error:'No snapshots found' });

    // pick the most recent snapshot whose mtime is within window
    let chosen = null;
    for (const full of jsons) {
      const st = await fse.stat(full);
      const age = now - st.mtimeMs;
      if (age <= deltaMs) {
        if (!chosen) chosen = full;
        else {
          const stChosen = await fse.stat(chosen);
          if (st.mtimeMs > stChosen.mtimeMs) chosen = full;
        }
      }
    }
    if (!chosen) return res.status(404).json({ ok:false, error:'No snapshot in that window' });

    const snap = await fse.readJson(chosen);
    // validate minimal shape
    if (!snap || typeof snap !== 'object' || !snap.meta) {
      return res.status(400).json({ ok:false, error:'Bad snapshot file' });
    }
    await fse.writeJson(DB_FILE, snap, { spaces: 2 });
    res.json({ ok:true, restoredFrom: path.basename(chosen) });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ------------------------ static frontend ------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use('/public', express.static(PUBLIC_DIR, { maxAge: '1h' }));

// serve index.html for root and client-side routes
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ------------------------ start ------------------------
app.listen(PORT, async () => {
  await ensureDirs();
  await loadDB(); // initialize if needed
  console.log(`EAS Tracker listening on port ${PORT}`);
  console.log(`Data dir: ${DATA_DIR}`);
});
