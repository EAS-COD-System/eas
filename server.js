// server.js — EAS Tracker (Node 18+ / Render)
// Cookie-based auth + full API used by the frontend

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express(); 
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'db.json');
const SNAP_DIR = path.join(ROOT, 'data', 'snapshots');

// ---------------- middleware ----------------
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

// ---------------- helpers ----------------
function initDBIfMissing() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeJsonSync(DB_FILE, {
      password: 'eastafricashop',
      countries: ['china','kenya','tanzania','uganda','zambia','zimbabwe'],
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
function loadDB() { initDBIfMissing(); return fs.readJsonSync(DB_FILE); }
function saveDB(db) { fs.writeJsonSync(DB_FILE, db, { spaces: 2 }); }
fs.ensureDirSync(SNAP_DIR);

function runningBalance(db) {
  return (db.finance?.entries || []).reduce(
    (t,e) => t + (e.type === 'credit' ? +e.amount||0 : -(+e.amount||0)), 0
  );
}
function periodBalance(list) {
  return list.reduce(
    (t,e) => t + (e.type === 'credit' ? +e.amount||0 : -(+e.amount||0)), 0
  );
}

// ---------------- auth ----------------
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  if (password === 'logout') {
    res.clearCookie('auth', { httpOnly: true, sameSite: 'Lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    return res.json({ ok: true });
  }

  if (password && password === db.password) {
    res.cookie('auth', '1', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  }
  return res.status(403).json({ error: 'Wrong password' });
});

function requireAuth(req,res,next){
  if (req.cookies?.auth === '1') return next();
  return res.status(403).json({ error: 'Unauthorized' });
}

// Small meta used by gate() in app.js
app.get('/api/meta', requireAuth, (req,res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

// ---------------- countries ----------------
app.get('/api/countries', requireAuth, (req,res) => {
  res.json({ countries: loadDB().countries || [] });
});

app.post('/api/countries', requireAuth, (req,res) => {
  const db = loadDB();
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing name' });
  db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req,res) => {
  const db = loadDB();
  const n = (req.params.name || '').toLowerCase();
  if (n === 'china') return res.status(400).json({ error: 'China cannot be deleted' });
  db.countries = (db.countries || []).filter(c => c.toLowerCase() !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ---------------- products ----------------
app.get('/api/products', requireAuth, (req,res) => {
  res.json({ products: loadDB().products || [] });
});

app.post('/api/products', requireAuth, (req,res) => {
  const db = loadDB();
  db.products = db.products || [];
  const p = {
    id: uuidv4(),
    status: 'active',
    name: req.body.name || '',
    sku: req.body.sku || '',
    cost_china: +req.body.cost_china || 0,
    ship_china_to_kenya: +req.body.ship_china_to_kenya || 0,
    margin_budget: +req.body.margin_budget || 0,
    budgets: req.body.budgets || {}
  };
  if (!p.name) return res.status(400).json({ error: 'Name required' });
  db.products.push(p);
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.put('/api/products/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.name !== undefined) p.name = up.name;
  if (up.sku !== undefined) p.sku = up.sku;
  if (up.cost_china !== undefined) p.cost_china = +up.cost_china || 0;
  if (up.ship_china_to_kenya !== undefined) p.ship_china_to_kenya = +up.ship_china_to_kenya || 0;
  if (up.margin_budget !== undefined) p.margin_budget = +up.margin_budget || 0;
  if (up.budgets !== undefined) p.budgets = up.budgets || {};
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.post('/api/products/:id/status', requireAuth, (req,res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.status = req.body?.status || 'active';
  saveDB(db);
  res.json({ ok: true, product: p });
});

// cascade delete product + all related data
app.delete('/api/products/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  db.products = (db.products || []).filter(p => p.id !== id);
  db.adspend = (db.adspend || []).filter(a => a.productId !== id);
  db.shipments = (db.shipments || []).filter(s => s.productId !== id);
  db.remittances = (db.remittances || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.productId !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- ad spend (upsert by product+country+platform) ----------------
app.get('/api/adspend', requireAuth, (req,res) => {
  res.json({ adSpends: loadDB().adspend || [] });
});

app.post('/api/adspend', requireAuth, (req,res) => {
  const db = loadDB();
  db.adspend = db.adspend || [];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Missing productId/country/platform' });
  const found = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (found) found.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- deliveries (weekly grid) ----------------
app.get('/api/deliveries', requireAuth, (req,res) => {
  res.json({ deliveries: loadDB().deliveries || [] });
});

app.post('/api/deliveries', requireAuth, (req,res) => {
  const db = loadDB();
  db.deliveries = db.deliveries || [];
  const { date, country, delivered } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- shipments ----------------
app.get('/api/shipments', requireAuth, (req,res) => {
  res.json({ shipments: loadDB().shipments || [] });
});

app.post('/api/shipments', requireAuth, (req,res) => {
  const db = loadDB();
  db.shipments = db.shipments || [];
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
  if (!s.productId || !s.fromCountry || !s.toCountry) {
    return res.status(400).json({ error: 'Missing productId/fromCountry/toCountry' });
  }
  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  const s = (db.shipments || []).find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.qty !== undefined) s.qty = +up.qty || 0;
  if (up.shipCost !== undefined) s.shipCost = +up.shipCost || 0;
  if (up.departedAt !== undefined) s.departedAt = up.departedAt;
  if (up.arrivedAt !== undefined) s.arrivedAt = up.arrivedAt;
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  db.shipments = (db.shipments || []).filter(x => x.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- remittances ----------------
app.get('/api/remittances', requireAuth, (req,res) => {
  const db = loadDB();
  let list = db.remittances || [];
  const { start, end, country } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end)   list = list.filter(r => r.end   <= end);
  if (country) list = list.filter(r => r.country === country);
  res.json({ remittances: list });
});

app.post('/api/remittances', requireAuth, (req,res) => {
  const db = loadDB();
  db.remittances = db.remittances || [];
  const r = {
    id: uuidv4(),
    start: req.body.start,
    end: req.body.end,
    country: req.body.country,
    productId: req.body.productId,
    orders: +req.body.orders || 0,
    pieces: +req.body.pieces || 0,
    revenue: +req.body.revenue || 0,
    adSpend: +req.body.adSpend || 0,
    extraPerPiece: +req.body.extraPerPiece || 0
  };
  if (!r.start || !r.end || !r.country || !r.productId) return res.status(400).json({ error: 'Missing required fields' });
  if ((r.country || '').toLowerCase() === 'china') return res.status(400).json({ error: 'China cannot be used for remittances' });
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

app.delete('/api/remittances/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  db.remittances = (db.remittances || []).filter(r => r.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- finance ----------------
app.get('/api/finance/categories', requireAuth, (req,res) => {
  res.json(loadDB().finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req,res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.categories = db.finance.categories || { debit: [], credit: [] };
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (!Array.isArray(db.finance.categories[type])) db.finance.categories[type] = [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok: true, categories: db.finance.categories });
});

app.delete('/api/finance/categories', requireAuth, (req,res) => {
  const db = loadDB();
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (db.finance?.categories?.[type]) {
    db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
    // also delete any entries that used this category
    db.finance.entries = (db.finance.entries || []).filter(e => e.category !== name);
    saveDB(db);
  }
  res.json({ ok: true, categories: db.finance.categories });
});

app.get('/api/finance/entries', requireAuth, (req,res) => {
  const db = loadDB();
  let list = db.finance?.entries || [];
  const { start, end } = req.query || {};
  let periodList = list;
  if (start) periodList = periodList.filter(e => e.date >= start);
  if (end)   periodList = periodList.filter(e => e.date <= end);
  res.json({ entries: periodList, running: runningBalance(db), balance: periodBalance(periodList) });
});

app.post('/api/finance/entries', requireAuth, (req,res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.entries = db.finance.entries || [];
  const { date, type, category, amount, note } = req.body || {};
  if (!date || !category || !type) return res.status(400).json({ error: 'Missing date/type/category' });
  const entry = { id: uuidv4(), date, type, category, amount: +amount || 0, note: note || '' };
  db.finance.entries.push(entry);
  saveDB(db);
  res.json({ ok: true, entry });
});

app.delete('/api/finance/entries/:id', requireAuth, (req,res) => {
  const db = loadDB();
  db.finance.entries = (db.finance.entries || []).filter(e => e.id !== (req.params.id || '').trim());
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- influencers ----------------
app.get('/api/influencers', requireAuth, (req,res) => {
  res.json({ influencers: loadDB().influencers || [] });
});

app.post('/api/influencers', requireAuth, (req,res) => {
  const db = loadDB();
  db.influencers = db.influencers || [];
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const inf = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers.push(inf);
  saveDB(db);
  res.json({ ok: true, influencer: inf });
});

app.delete('/api/influencers/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  db.influencers = (db.influencers || []).filter(i => i.id !== id);
  // also remove their spends
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.influencerId !== id);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/influencers/spend', requireAuth, (req,res) => {
  res.json({ spends: loadDB().influencerSpends || [] });
});

app.post('/api/influencers/spend', requireAuth, (req,res) => {
  const db = loadDB();
  db.influencerSpends = db.influencerSpends || [];
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId) return res.status(400).json({ error: 'Missing influencerId' });
  const sp = {
    id: uuidv4(),
    date: date || new Date().toISOString().slice(0,10),
    influencerId,
    country: country || '',
    productId: productId || '',
    amount: +amount || 0
  };
  db.influencerSpends.push(sp);
  saveDB(db);
  res.json({ ok: true, spend: sp });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req,res) => {
  const db = loadDB();
  const id = (req.params.id || '').trim();
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- snapshots (manual save/restore) ----------------
app.get('/api/snapshots', requireAuth, (req,res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots || [] });
});

app.post('/api/snapshots', requireAuth, async (req,res) => {
  const db = loadDB();
  const name = (req.body?.name || '').trim() || `Manual ${new Date().toLocaleString()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAP_DIR, `${stamp}-${name.replace(/\s+/g,'_')}.json`);
  await fs.copy(DB_FILE, file);
  const entry = { id: uuidv4(), name, file, createdAt: new Date().toISOString(), kind: 'manual' };
  db.snapshots = db.snapshots || [];
  db.snapshots.push(entry);
  db.snapshots.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt));
  saveDB(db);
  res.json({ ok: true, snapshot: entry });
});

app.post('/api/snapshots/restore', requireAuth, async (req,res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: 'Missing file' });
  const safe = path.join(SNAP_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: 'Snapshot not found' });
  await fs.copy(safe, DB_FILE);
  // keep snapshot (do NOT delete after push)
  res.json({ ok: true, restoredFrom: safe });
});

app.delete('/api/snapshots/:id', requireAuth, async (req,res) => {
  const db = loadDB();
  const snap = (db.snapshots || []).find(s => s.id === (req.params.id || '').trim());
  if (snap && snap.file && fs.existsSync(snap.file)) {
    try { await fs.remove(snap.file); } catch {}
  }
  db.snapshots = (db.snapshots || []).filter(s => s.id !== (req.params.id || '').trim());
  saveDB(db);
  res.json({ ok: true });
});

// ---------------- pages ----------------
app.get('/', (req,res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/product.html', (req,res) => res.sendFile(path.join(ROOT, 'product.html')));

// ---------------- start ----------------
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
  console.log(`📄 DB: ${DB_FILE}`);
  console.log(`💾 Snapshots: ${SNAP_DIR}`);
});
