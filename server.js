// server.js
// EAS Tracker Backend – aligned with final frontend (index.html / product.html / public/app.js)

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'eastafricashop';
const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

/* ----------------------------- Helpers ----------------------------- */
function initDBIfMissing() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(
      DATA_FILE,
      {
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
      },
      { spaces: 2 }
    );
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

/* --------------------------- Middleware ---------------------------- */
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

/* ------------------------------ Auth -------------------------------- */
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'eastafricashop';

  // logout
  if (password === 'logout') {
    res.clearCookie('auth', { path: '/' });
    return res.json({ ok: true });
  }

  // login
  if (password === ADMIN_PASSWORD) {
    res.cookie('auth', '1', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    return res.json({ ok: true });
  }

  return res.status(403).json({ error: 'Wrong password' });
});

function requireAuth(req, res, next) {
  if (req.cookies && req.cookies.auth === '1') return next();
  return res.status(403).json({ error: 'Unauthorized' });
}

// Used by app.js boot() to detect login + prefetch minimal data
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ ok: true, countries: db.countries || [] });
});

/* ----------------------------- Countries ---------------------------- */
app.get('/api/countries', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

app.post('/api/countries', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const db = loadDB();
  db.countries = db.countries || [];
  const lower = String(name).toLowerCase();
  if (!db.countries.includes(lower)) db.countries.push(lower);
  saveDB(db);

  res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const n = (req.params.name || '').toLowerCase();
  if (n === 'china') return res.status(400).json({ error: 'China cannot be deleted' });

  const db = loadDB();
  db.countries = (db.countries || []).filter(c => c !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

/* ----------------------------- Products ----------------------------- */
app.get('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products || [] });
});

app.post('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  const p = {
    id: uuidv4(),
    name: req.body.name || '',
    sku: req.body.sku || '',
    status: 'active',
    cost_china: +req.body.cost_china || 0,
    ship_china_to_kenya: +req.body.ship_china_to_kenya || 0,
    margin_budget: +req.body.margin_budget || 0,
    budgets: req.body.budgets || {}
  };
  if (!p.name) return res.status(400).json({ error: 'Product name required' });
  db.products = db.products || [];
  db.products.push(p);
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });

  const allowed = ['name', 'sku', 'cost_china', 'ship_china_to_kenya', 'margin_budget', 'budgets', 'status'];
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      p[k] = (k === 'cost_china' || k === 'ship_china_to_kenya' || k === 'margin_budget')
        ? (+req.body[k] || 0)
        : req.body[k];
    }
  });

  saveDB(db);
  res.json({ ok: true, product: p });
});

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'paused'].includes(status)) return res.status(400).json({ error: 'Bad status' });

  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Product not found' });

  p.status = status;
  saveDB(db);
  res.json({ ok: true, product: p });
});

// Full cascade delete across the system
app.delete('/api/products/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const db = loadDB();

  db.products = (db.products || []).filter(p => p.id !== id);
  db.adspend = (db.adspend || []).filter(a => a.productId !== id);
  db.shipments = (db.shipments || []).filter(s => s.productId !== id);
  db.remittances = (db.remittances || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(i => i.productId !== id);

  saveDB(db);
  res.json({ ok: true });
});

/* ------------------------------ Ad Spend ---------------------------- */
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adspend: db.adspend || [] });
});

// Upsert per (productId, country, platform)
app.post('/api/adspend', requireAuth, (req, res) => {
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform)
    return res.status(400).json({ error: 'Missing productId/country/platform' });

  const db = loadDB();
  db.adspend = db.adspend || [];
  const existing = db.adspend.find(
    a => a.productId === productId && a.country === country && a.platform === platform
  );

  if (existing) existing.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });

  saveDB(db);
  res.json({ ok: true });
});

/* ----------------------------- Deliveries --------------------------- */
app.get('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries || [] });
});

app.post('/api/deliveries', requireAuth, (req, res) => {
  const { date, country, delivered } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });

  const db = loadDB();
  db.deliveries = db.deliveries || [];
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0 });
  saveDB(db);
  res.json({ ok: true });
});

/* ----------------------------- Shipments ---------------------------- */
app.get('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const {
    productId, fromCountry, toCountry, qty,
    shipCost, departedAt, arrivedAt
  } = req.body || {};

  if (!productId || !fromCountry || !toCountry)
    return res.status(400).json({ error: 'Missing fields' });

  const s = {
    id: uuidv4(),
    productId,
    fromCountry,
    toCountry,
    qty: +qty || 0,
    shipCost: +shipCost || 0,
    departedAt: departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: arrivedAt || null
  };

  const db = loadDB();
  db.shipments = db.shipments || [];
  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Shipment not found' });

  if (req.body.arrivedAt !== undefined) s.arrivedAt = req.body.arrivedAt;
  if (req.body.qty !== undefined) s.qty = +req.body.qty;
  if (req.body.shipCost !== undefined) s.shipCost = +req.body.shipCost;

  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = (db.shipments || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

/* ---------------------------- Remittances --------------------------- */
app.get('/api/remittances', requireAuth, (req, res) => {
  const { start, end, country } = req.query || {};
  const db = loadDB();
  let list = db.remittances || [];

  if (start) list = list.filter(r => r.start >= start);
  if (end)   list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);

  res.json({ remittances: list });
});

app.post('/api/remittances', requireAuth, (req, res) => {
  const { start, end, country, productId } = req.body || {};
  if (!start || !end || !country || !productId)
    return res.status(400).json({ error: 'Missing fields' });
  if (String(country).toLowerCase() === 'china')
    return res.status(400).json({ error: 'China cannot have remittance entries' });

  const db = loadDB();
  const r = {
    id: uuidv4(),
    start,
    end,
    country,
    productId,
    orders: +req.body.orders || 0,
    pieces: +req.body.pieces || 0,
    revenue: +req.body.revenue || 0,
    adSpend: +req.body.adSpend || 0,
    extraPerPiece: +req.body.extraPerPiece || 0,
    createdAt: new Date().toISOString()
  };
  db.remittances = db.remittances || [];
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

/* ------------------------------ Finance ---------------------------- */
// Categories
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing fields' });

  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.categories[type] = db.finance.categories[type] || [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);

  res.json({ ok: true, categories: db.finance.categories });
});

app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });

  const db = loadDB();
  if (db.finance?.categories?.[type]) {
    db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
    saveDB(db);
  }
  res.json({ ok: true });
});

// Entries
app.get('/api/finance/entries', requireAuth, (req, res) => {
  const { start, end } = req.query || {};
  const db = loadDB();
  const all = db.finance?.entries || [];

  // running all-time
  const running = all.reduce((acc, e) => acc + ((e.type === 'credit' ? 1 : -1) * (+e.amount || 0)), 0);

  // filtered period
  let entries = all;
  if (start) entries = entries.filter(e => e.date >= start);
  if (end)   entries = entries.filter(e => e.date <= end);

  const balance = entries.reduce((acc, e) => acc + ((e.type === 'credit' ? 1 : -1) * (+e.amount || 0)), 0);

  res.json({ entries, running, balance });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
  const { date, type, category, amount, note } = req.body || {};
  if (!date || !type || !category) return res.status(400).json({ error: 'Missing fields' });

  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  const e = { id: uuidv4(), date, type, category, amount: +amount || 0, note: note || '' };
  db.finance.entries.push(e);
  saveDB(db);

  res.json({ ok: true, entry: e });
});

app.delete('/api/finance/entries/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.entries = (db.finance.entries || []).filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

/* ---------------------------- Influencers --------------------------- */
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const db = loadDB();
  const i = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers = db.influencers || [];
  db.influencers.push(i);
  saveDB(db);

  res.json({ ok: true, influencer: i });
});

app.delete('/api/influencers/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Influencer Spend
app.get('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ spends: db.influencerSpends || [] });
});

app.post('/api/influencers/spend', requireAuth, (req, res) => {
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId || !productId) return res.status(400).json({ error: 'Missing influencerId/productId' });

  const db = loadDB();
  db.influencerSpends = db.influencerSpends || [];
  const rec = {
    id: uuidv4(),
    date: date || new Date().toISOString().slice(0, 10),
    influencerId,
    country: country || '',
    productId,
    amount: +amount || 0
  };
  db.influencerSpends.push(rec);
  saveDB(db);

  res.json({ ok: true, spend: rec });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

/* ----------------------------- Snapshots ---------------------------- */
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

  const entry = {
    id: uuidv4(),
    name,
    file,
    createdAt: new Date().toISOString(),
    kind: 'manual'
  };

  db.snapshots = db.snapshots || [];
  db.snapshots.push(entry);
  db.snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveDB(db);

  res.json({ ok: true, snapshot: entry });
});

app.post('/api/snapshots/restore', requireAuth, async (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: 'Missing file' });

  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: 'Snapshot not found' });

  await fs.copy(safe, DATA_FILE); // Snapshot persists; not deleted
  res.json({ ok: true, restoredFrom: safe });
});

app.delete('/api/snapshots/:id', requireAuth, async (req, res) => {
  const db = loadDB();
  db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

/* -------------------------------- Pages ----------------------------- */
app.get('/product.html', (req, res) => {
  res.sendFile(path.join(ROOT, 'product.html'));
});
app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

/* ------------------------------ Start ------------------------------ */
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
});
