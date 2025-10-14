// server.js
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Middleware - ORDER MATTERS!
app.use(morgan('dev'));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

// Database functions
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

function loadDB() { 
  initDBIfMissing(); 
  return fs.readJsonSync(DATA_FILE); 
}

function saveDB(db) { 
  fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); 
}

function ensureSnapshotDir() { 
  fs.ensureDirSync(SNAPSHOT_DIR); 
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

// FIXED AUTH ENDPOINT
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  console.log('🔐 Auth attempt received');

  // SIMPLIFIED COOKIE SETTINGS - This should work everywhere
  const cookieOpts = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false, // Set to false to work on both HTTP and HTTPS
    maxAge: 365 * 24 * 60 * 60 * 1000
  };

  if (password === 'logout') {
    res.clearCookie('auth', cookieOpts);
    return res.json({ ok: true });
  }

  if (password && password === db.password) {
    console.log('✅ Login successful');
    res.cookie('auth', '1', cookieOpts);
    return res.json({ ok: true });
  }

  console.log('❌ Login failed - wrong password');
  return res.status(401).json({ error: 'Wrong password' });
});

// Check auth status
app.get('/api/auth/check', (req, res) => {
  if (req.cookies.auth === '1') {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
});

// Meta data
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ 
    countries: (db.countries || []).filter(c => c !== 'china')
  });
});

// Countries endpoints
app.get('/api/countries', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

app.post('/api/countries', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const db = loadDB();
  db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const db = loadDB();
  const n = (req.params.name || '').toLowerCase();
  if (n === 'china') return res.status(400).json({ error: 'china cannot be deleted' });
  db.countries = (db.countries || []).filter(c => c.toLowerCase() !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// Products endpoints
app.get('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products || [] });
});

app.post('/api/products', requireAuth, (req, res) => {
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

app.put('/api/products/:id', requireAuth, (req, res) => {
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

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.status = req.body.status || 'active';
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  db.products = (db.products || []).filter(p => p.id !== id);
  db.adspend = (db.adspend || []).filter(a => a.productId !== id);
  db.shipments = (db.shipments || []).filter(s => s.productId !== id);
  db.remittances = (db.remittances || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.productId !== id);
  saveDB(db);
  res.json({ ok: true });
});

// Adspend endpoints
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend || [] });
});

app.post('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  db.adspend = db.adspend || [];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Missing fields' });
  const f = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (f) f.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// Deliveries endpoints
app.get('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries || [] });
});

app.post('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB();
  db.deliveries = db.deliveries || [];
  const { date, country, delivered } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// Shipments endpoints
app.get('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments || [];
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry || req.body.from,
    toCountry: req.body.toCountry || req.body.to,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: req.body.arrivedAt || null
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error: 'Missing fields' });
  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.qty !== undefined) s.qty = +up.qty || 0;
  if (up.shipCost !== undefined) s.shipCost = +up.shipCost || 0;
  if (up.departedAt !== undefined) s.departedAt = up.departedAt;
  if (up.arrivedAt !== undefined) s.arrivedAt = up.arrivedAt;
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = (db.shipments || []).filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Remittances endpoints
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.remittances || [];
  const { start, end, country, productId } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);
  res.json({ remittances: list });
});

app.post('/api/remittances', requireAuth, (req, res) => {
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
  if ((r.country || '').toLowerCase() === 'china') return res.status(400).json({ error: 'china not allowed for remittances' });
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances = (db.remittances || []).filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Finance endpoints
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
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

app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if ((db.finance?.categories?.[type] || []).includes(name)) {
    db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
    saveDB(db);
  }
  res.json({ ok: true, categories: db.finance.categories });
});

app.get('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.finance?.entries || [];
  const { start, end } = req.query || {};
  if (start) list = list.filter(e => e.date >= start);
  if (end) list = list.filter(e => e.date <= end);
  
  const running = (db.finance?.entries || []).reduce((t, e) => t + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)), 0);
  const balance = list.reduce((t, e) => t + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)), 0);
  
  res.json({ entries: list, running, balance });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
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

app.delete('/api/finance/entries/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries = (db.finance.entries || []).filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Influencers endpoints
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = db.influencers || [];
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const inf = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers.push(inf);
  saveDB(db);
  res.json({ ok: true, influencer: inf });
});

app.delete('/api/influencers/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.influencerId !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ spends: db.influencerSpends || [] });
});

app.post('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencerSpends = db.influencerSpends || [];
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId) return res.status(400).json({ error: 'Missing influencerId' });
  const sp = { id: uuidv4(), date: date || new Date().toISOString().slice(0, 10), influencerId, country: country || '', productId: productId || '', amount: +amount || 0 };
  db.influencerSpends.push(sp);
  saveDB(db);
  res.json({ ok: true, spend: sp });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Snapshots endpoints
app.get('/api/snapshots', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots || [] });
});

app.post('/api/snapshots', requireAuth, async (req, res) => {
  ensureSnapshotDir();
  const db = loadDB();
  const name = (req.body?.name || '').trim() || `Manual ${new Date().toLocaleString()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g, '_')}.json`);
  await fs.copy(DATA_FILE, file);
  const entry = { id: uuidv4(), name, file, createdAt: new Date().toISOString(), kind: 'manual' };
  db.snapshots = db.snapshots || [];
  db.snapshots.unshift(entry);
  saveDB(db);
  res.json({ ok: true, file, snapshot: entry });
});

app.post('/api/snapshots/restore', requireAuth, async (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: 'Missing file' });
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: 'Snapshot not found' });
  await fs.copy(safe, DATA_FILE);
  res.json({ ok: true, restoredFrom: safe });
});

app.delete('/api/snapshots/:id', requireAuth, async (req, res) => {
  const db = loadDB();
  const snap = (db.snapshots || []).find(s => s.id === req.params.id);
  if (snap && snap.file && fs.existsSync(snap.file)) { 
    try { await fs.remove(snap.file); } catch {} 
  }
  db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/product.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 EAS Tracker running on port ${PORT}`);
  console.log(`🔐 Default password: eastafricashop`);
});
