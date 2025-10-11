// ============================================================
// EAS Tracker – Backend API (Node.js / Express)
// Compatible with Render hosting
// ============================================================

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

// ---------- Middleware ----------
app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

// ---------- Helpers ----------
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

function computeRunningBalance(db) {
  const entries = db.finance?.entries || [];
  return entries.reduce(
    (acc, e) => acc + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)),
    0
  );
}

function computePeriodBalance(list) {
  return list.reduce(
    (acc, e) => acc + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)),
    0
  );
}

// ---------- Authentication ----------
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  if (password === 'logout') {
    res.clearCookie('auth', {
      httpOnly: true,
      sameSite: 'Lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
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

function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') return next();
  return res.status(403).json({ error: 'Unauthorized' });
}

// ---------- META ----------
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

// ---------- COUNTRIES ----------
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
  const n = req.params.name;
  db.countries = (db.countries || []).filter(c => c !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ---------- PRODUCTS ----------
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
  Object.assign(p, up);
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.products = (db.products || []).filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- DAILY AD SPEND ----------
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend || [] });
});

app.post('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  db.adspend = db.adspend || [];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) {
    return res.status(400).json({ error: 'Missing productId/country/platform' });
  }
  const found = db.adspend.find(
    a => a.productId === productId && a.country === country && a.platform === platform
  );
  if (found) found.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ---------- DELIVERIES ----------
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

// ---------- SHIPMENTS ----------
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
    fromCountry: req.body.fromCountry,
    toCountry: req.body.toCountry,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: req.body.arrivedAt || null
  };
  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

// ---------- REMITTANCES ----------
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.remittances || [];
  const { start, end, country } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
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
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

// ---------- FINANCE ----------
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok: true, categories: db.finance.categories });
});

app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.query || {};
  if (db.finance?.categories?.[type]) {
    db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
    saveDB(db);
  }
  res.json({ ok: true, categories: db.finance.categories });
});

app.get('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.finance?.entries || [];
  const { start, end } = req.query || {};
  let periodList = list;
  if (start) periodList = periodList.filter(e => e.date >= start);
  if (end) periodList = periodList.filter(e => e.date <= end);

  const running = computeRunningBalance(db);
  const balance = computePeriodBalance(periodList);

  res.json({ entries: periodList, running, balance });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries = db.finance.entries || [];
  const { date, type, category, amount, note } = req.body || {};
  const entry = { id: uuidv4(), date, type, category, amount: +amount || 0, note: note || '' };
  db.finance.entries.push(entry);
  saveDB(db);
  res.json({ ok: true, entry });
});

// ---------- INFLUENCERS ----------
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = db.influencers || [];
  const { name, social, country } = req.body || {};
  const inf = { id: uuidv4(), name, social, country };
  db.influencers.push(inf);
  saveDB(db);
  res.json({ ok: true, influencer: inf });
});

// ---------- SNAPSHOTS ----------
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
  db.snapshots.push(entry);
  saveDB(db);
  res.json({ ok: true, snapshot: entry });
});

// ---------- STATIC PAGES ----------
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
  console.log(`📦 Data file: ${DATA_FILE}`);
});
