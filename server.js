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

// ===================== MIDDLEWARE - FIXED ORDER =====================
app.use(morgan('dev'));
app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());

// ===================== STATIC FILE SERVING - FIXED =====================
app.use('/public', express.static(PUBLIC_DIR));
app.use(express.static(PUBLIC_DIR)); // Serve from root as well

// ===================== DATABASE FUNCTIONS =====================
function initDB() {
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
    console.log('🆕 Created new database');
  }
}

function loadDB() { initDB(); return fs.readJsonSync(DATA_FILE); }
function saveDB(db) { fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); }
function ensureSnapshotDir() { fs.ensureDirSync(SNAPSHOT_DIR); }

// ===================== AUTHENTICATION =====================
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  const cookieOpts = {
    httpOnly: true, path: '/', sameSite: 'lax', secure: false,
    maxAge: 365 * 24 * 60 * 60 * 1000
  };

  if (password === 'logout') {
    res.clearCookie('auth', cookieOpts);
    return res.json({ ok: true });
  }

  if (password && password === db.password) {
    res.cookie('auth', '1', cookieOpts);
    return res.json({ ok: true });
  }

  return res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: req.cookies.auth === '1' });
});

function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') return next();
  return res.status(401).json({ error: 'Authentication required' });
}

// ===================== COUNTRIES API =====================
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
  const name = (req.params.name || '').toLowerCase();
  if (name === 'china') return res.status(400).json({ error: 'china cannot be deleted' });
  db.countries = (db.countries || []).filter(c => c.toLowerCase() !== name);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ===================== PRODUCTS API =====================
app.get('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products || [] });
});

app.post('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  db.products = db.products || [];
  const product = {
    id: uuidv4(), status: 'active', name: req.body.name || '',
    sku: req.body.sku || '', cost_china: +req.body.cost_china || 0,
    ship_china_to_kenya: +req.body.ship_china_to_kenya || 0,
    margin_budget: +req.body.margin_budget || 0, budgets: {}
  };
  if (!product.name) return res.status(400).json({ error: 'Name required' });
  db.products.push(product);
  saveDB(db);
  res.json({ ok: true, product });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const product = (db.products || []).find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const update = req.body || {};
  if (update.name !== undefined) product.name = update.name;
  if (update.sku !== undefined) product.sku = update.sku;
  if (update.cost_china !== undefined) product.cost_china = +update.cost_china || 0;
  if (update.ship_china_to_kenya !== undefined) product.ship_china_to_kenya = +update.ship_china_to_kenya || 0;
  if (update.margin_budget !== undefined) product.margin_budget = +update.margin_budget || 0;
  if (update.budgets !== undefined) product.budgets = update.budgets || {};
  saveDB(db);
  res.json({ ok: true, product });
});

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const db = loadDB();
  const product = (db.products || []).find(p => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  product.status = req.body.status || 'active';
  saveDB(db);
  res.json({ ok: true, product });
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

// ===================== AD SPEND API =====================
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend || [] });
});

app.post('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  db.adspend = db.adspend || [];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Missing fields' });
  const existing = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (existing) existing.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ===================== DELIVERIES API =====================
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

// ===================== SHIPMENTS API =====================
app.get('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments || [];
  const shipment = {
    id: uuidv4(), productId: req.body.productId,
    fromCountry: req.body.fromCountry, toCountry: req.body.toCountry,
    qty: +req.body.qty || 0, shipCost: +req.body.shipCost || 0,
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: req.body.arrivedAt || null
  };
  if (!shipment.productId || !shipment.fromCountry || !shipment.toCountry) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  db.shipments.push(shipment);
  saveDB(db);
  res.json({ ok: true, shipment });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const shipment = (db.shipments || []).find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Not found' });
  const update = req.body || {};
  if (update.qty !== undefined) shipment.qty = +update.qty || 0;
  if (update.shipCost !== undefined) shipment.shipCost = +update.shipCost || 0;
  if (update.departedAt !== undefined) shipment.departedAt = update.departedAt;
  if (update.arrivedAt !== undefined) shipment.arrivedAt = update.arrivedAt;
  saveDB(db);
  res.json({ ok: true, shipment });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = (db.shipments || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ===================== REMITTANCES API =====================
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB();
  let remittances = db.remittances || [];
  const { start, end, country, productId } = req.query || {};
  if (start) remittances = remittances.filter(r => r.start >= start);
  if (end) remittances = remittances.filter(r => r.end <= end);
  if (country) remittances = remittances.filter(r => r.country === country);
  if (productId) remittances = remittances.filter(r => r.productId === productId);
  res.json({ remittances });
});

app.post('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances = db.remittances || [];
  const remittance = {
    id: uuidv4(), start: req.body.start, end: req.body.end,
    country: req.body.country, productId: req.body.productId,
    orders: +req.body.orders || 0, pieces: +req.body.pieces || 0,
    revenue: +req.body.revenue || 0, adSpend: +req.body.adSpend || 0,
    extraPerPiece: +req.body.extraPerPiece || 0
  };
  if (!remittance.start || !remittance.end || !remittance.country || !remittance.productId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (remittance.country.toLowerCase() === 'china') {
    return res.status(400).json({ error: 'china not allowed for remittances' });
  }
  db.remittances.push(remittance);
  saveDB(db);
  res.json({ ok: true, remittance });
});

app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ===================== FINANCE API =====================
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
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
  let entries = db.finance?.entries || [];
  const { start, end } = req.query || {};
  if (start) entries = entries.filter(e => e.date >= start);
  if (end) entries = entries.filter(e => e.date <= end);
  
  const running = (db.finance?.entries || []).reduce((total, entry) => {
    return total + (entry.type === 'credit' ? +entry.amount : -(+entry.amount));
  }, 0);
  
  const balance = entries.reduce((total, entry) => {
    return total + (entry.type === 'credit' ? +entry.amount : -(+entry.amount));
  }, 0);
  
  res.json({ entries, running, balance });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
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

// ===================== INFLUENCERS API =====================
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = db.influencers || [];
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const influencer = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers.push(influencer);
  saveDB(db);
  res.json({ ok: true, influencer });
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
  const spend = {
    id: uuidv4(), date: date || new Date().toISOString().slice(0, 10),
    influencerId, country: country || '', productId: productId || '', amount: +amount || 0
  };
  db.influencerSpends.push(spend);
  saveDB(db);
  res.json({ ok: true, spend });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ===================== SNAPSHOTS API =====================
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
  const snapshot = { id: uuidv4(), name, file, createdAt: new Date().toISOString(), kind: 'manual' };
  db.snapshots = db.snapshots || [];
  db.snapshots.unshift(snapshot);
  saveDB(db);
  res.json({ ok: true, file, snapshot });
});

app.post('/api/snapshots/restore', requireAuth, async (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: 'Missing file' });
  const safeFile = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safeFile)) return res.status(404).json({ error: 'Snapshot not found' });
  await fs.copy(safeFile, DATA_FILE);
  res.json({ ok: true, restoredFrom: safeFile });
});

app.delete('/api/snapshots/:id', requireAuth, async (req, res) => {
  const db = loadDB();
  const snapshot = (db.snapshots || []).find(s => s.id === req.params.id);
  if (snapshot && snapshot.file && fs.existsSync(snapshot.file)) {
    try { await fs.remove(snapshot.file); } catch {} 
  }
  db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ===================== FRONTEND ROUTES =====================
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/product.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product.html'));
});

// ===================== START SERVER =====================
app.listen(PORT, () => {
  console.log(`🚀 EAS Tracker running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${PUBLIC_DIR}`);
  console.log(`🔐 Default password: eastafricashop`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
});
