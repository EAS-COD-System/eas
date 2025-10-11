// server.js
// EAS Tracker – backend API + auth + static serving
// Fixes included:
// - Solid cookie-based login (no form hiccups)
// - Country rules: China cannot be deleted; China blocked in remittances
// - Product delete = hard cascade (adspend, shipments, remittances removed)
// - Ad spend POST works in "replace" mode (productId+country+platform)
// - Snapshot restore keeps snapshot file (no auto-delete)
// - Filter endpoints accept start/end/country and ignore China in remittance list

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- helpers ----------
const DB_FILE = path.join(__dirname, 'db.json');
function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const db = JSON.parse(raw || '{}');
    // ensure shapes
    db.countries    = db.countries    || ['China', 'Kenya'];
    db.products     = db.products     || [];
    db.adSpends     = db.adSpends     || [];
    db.shipments    = db.shipments    || [];
    db.remittances  = db.remittances  || [];
    db.deliveries   = db.deliveries   || [];
    db.financeCats  = db.financeCats  || { debit: [], credit: [] };
    db.finance      = db.finance      || { entries: [] };
    db.influencers  = db.influencers  || [];
    db.infSpends    = db.infSpends    || [];
    return db;
  } catch (e) {
    return {
      countries: ['China', 'Kenya'],
      products: [],
      adSpends: [],
      shipments: [],
      remittances: [],
      deliveries: [],
      financeCats: { debit: [], credit: [] },
      finance: { entries: [] },
      influencers: [],
      infSpends: []
    };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function uid(prefix='id') {
  return `${prefix}_${Math.random().toString(36).slice(2,8)}${Date.now().toString(36)}`;
}
function isChina(name='') {
  return String(name).toLowerCase() === 'china';
}

// ---------- middleware ----------
app.use(express.json());
app.use(cookieParser());

// CORS (optional – fine for Render)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// static
app.use('/public', express.static(path.join(__dirname, 'public')));

// ---------- auth ----------
const COOKIE_NAME = 'eas_auth';
const PASSWORD = process.env.EAS_PASSWORD || 'eas123';

function authed(req) {
  return req.cookies && req.cookies[COOKIE_NAME] === '1';
}
function requireAuth(req, res, next) {
  if (authed(req)) return next();
  return res.status(403).json({ error: 'Forbidden' });
}

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  if (password === 'logout') {
    res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax' });
    return res.json({ ok: true });
  }
  if (!password) return res.status(400).json({ error: 'Password required' });
  if (password !== PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  res.cookie(COOKIE_NAME, '1', { httpOnly: true, sameSite: 'lax' });
  return res.json({ ok: true });
});

app.get('/api/meta', (req, res) => {
  if (!authed(req)) return res.status(403).json({ error: 'Forbidden' });
  const db = loadDB();
  res.json({ countries: db.countries });
});

// Everything below needs auth
app.use('/api', requireAuth);

// ---------- countries ----------
app.get('/api/countries', (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});
app.post('/api/countries', (req, res) => {
  const db = loadDB();
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  if (db.countries.some(c => c.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Country exists' });
  db.countries.push(name);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});
app.delete('/api/countries/:name', (req, res) => {
  const db = loadDB();
  const name = decodeURIComponent(req.params.name || '');
  if (isChina(name)) return res.status(400).json({ error: 'China cannot be deleted' });
  const idx = db.countries.findIndex(c => c.toLowerCase() === name.toLowerCase());
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.countries.splice(idx, 1);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ---------- products ----------
app.get('/api/products', (req, res) => {
  const db = loadDB();
  res.json({ products: db.products });
});
app.post('/api/products', (req, res) => {
  const db = loadDB();
  const p = req.body || {};
  const prod = {
    id: uid('prod'),
    name: p.name?.trim() || 'Product',
    sku: p.sku?.trim() || '',
    status: 'active',
    cost_china: +p.cost_china || 0,
    ship_china_to_kenya: +p.ship_china_to_kenya || 0,
    margin_budget: +p.margin_budget || 0,
    budgets: p.budgets || {} // manual product-country budgets
  };
  db.products.push(prod);
  saveDB(db);
  res.json({ ok: true, product: prod });
});
app.put('/api/products/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const p = db.products.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  Object.assign(p, {
    name: req.body?.name ?? p.name,
    sku: req.body?.sku ?? p.sku,
    cost_china: +req.body?.cost_china || 0,
    ship_china_to_kenya: +req.body?.ship_china_to_kenya || 0,
    margin_budget: +req.body?.margin_budget || 0,
    budgets: req.body?.budgets ?? p.budgets
  });
  saveDB(db);
  res.json({ ok: true, product: p });
});
app.post('/api/products/:id/status', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const p = db.products.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const status = req.body?.status === 'paused' ? 'paused' : 'active';
  p.status = status;
  saveDB(db);
  res.json({ ok: true, product: p });
});
app.delete('/api/products/:id', (req, res) => {
  // HARD CASCADE DELETE across the DB
  const db = loadDB();
  const id = req.params.id;
  const idx = db.products.findIndex(x => x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.products.splice(idx, 1);

  db.adSpends    = db.adSpends.filter(x => x.productId !== id);
  db.shipments   = db.shipments.filter(x => x.productId !== id);
  db.remittances = db.remittances.filter(x => x.productId !== id);
  db.infSpends   = db.infSpends.filter(x => x.productId !== id);
  // deliveries are country-only, so no product key to filter

  saveDB(db);
  res.json({ ok: true });
});

// ---------- ad spend ----------
app.get('/api/adspend', (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adSpends });
});
app.post('/api/adspend', (req, res) => {
  // REPLACE mode by (productId + country + platform)
  const db = loadDB();
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Fields required' });
  const key = (r) => `${r.productId}|${r.country}|${(r.platform||'').toLowerCase()}`;
  const k = `${productId}|${country}|${(platform||'').toLowerCase()}`;
  const i = db.adSpends.findIndex(r => key(r) === k);
  const row = { id: i >= 0 ? db.adSpends[i].id : uid('ad'), productId, country, platform, amount: +amount || 0 };
  if (i >= 0) db.adSpends[i] = row; else db.adSpends.push(row);
  saveDB(db);
  res.json({ ok: true, adSpends: db.adSpends });
});

// ---------- shipments ----------
app.get('/api/shipments', (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments });
});
app.post('/api/shipments', (req, res) => {
  const db = loadDB();
  const p = req.body || {};
  if (!p.productId || !p.fromCountry || !p.toCountry) {
    return res.status(400).json({ error: 'productId, fromCountry, toCountry required' });
  }
  const row = {
    id: uid('ship'),
    productId: p.productId,
    fromCountry: p.fromCountry,
    toCountry: p.toCountry,
    qty: +p.qty || 0,
    shipCost: +p.shipCost || 0,
    departedAt: p.departedAt || null,
    arrivedAt: p.arrivedAt || null
  };
  db.shipments.push(row);
  saveDB(db);
  res.json({ ok: true, shipment: row });
});
app.put('/api/shipments/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const s = db.shipments.find(x => x.id === id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const p = req.body || {};
  if (p.qty != null) s.qty = +p.qty || 0;
  if (p.shipCost != null) s.shipCost = +p.shipCost || 0;
  if (p.departedAt !== undefined) s.departedAt = p.departedAt;
  if (p.arrivedAt !== undefined) s.arrivedAt = p.arrivedAt;
  saveDB(db);
  res.json({ ok: true, shipment: s });
});
app.delete('/api/shipments/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const i = db.shipments.findIndex(x => x.id === id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  db.shipments.splice(i, 1);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- remittances ----------
app.get('/api/remittances', (req, res) => {
  const db = loadDB();
  let list = db.remittances.slice();
  const { start, end, country } = req.query;
  if (start) list = list.filter(x => x.start >= start);
  if (end) list = list.filter(x => x.end <= end);
  if (country) list = list.filter(x => x.country === country);
  res.json({ remittances: list });
});
app.post('/api/remittances', (req, res) => {
  const db = loadDB();
  const p = req.body || {};
  if (!p.start || !p.end || !p.country || !p.productId) {
    return res.status(400).json({ error: 'start, end, country, productId required' });
  }
  if (isChina(p.country)) return res.status(400).json({ error: 'China cannot be used in remittances' });
  const row = {
    id: uid('rem'),
    start: p.start,
    end: p.end,
    country: p.country,
    productId: p.productId,
    orders: +p.orders || 0,
    pieces: +p.pieces || 0,
    revenue: +p.revenue || 0,
    adSpend: +p.adSpend || 0,
    extraPerPiece: +p.extraPerPiece || 0
  };
  db.remittances.push(row);
  saveDB(db);
  res.json({ ok: true, remittance: row });
});
app.delete('/api/remittances/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const i = db.remittances.findIndex(x => x.id === id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  db.remittances.splice(i, 1);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- deliveries (weekly grid, country only) ----------
app.get('/api/deliveries', (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries });
});
app.post('/api/deliveries', (req, res) => {
  const db = loadDB();
  const p = req.body || {};
  if (!p.date || !p.country) return res.status(400).json({ error: 'date and country required' });
  const row = { id: uid('del'), date: p.date, country: p.country, delivered: +p.delivered || 0 };
  db.deliveries.push(row);
  saveDB(db);
  res.json({ ok: true, delivery: row });
});

// ---------- finance ----------
app.get('/api/finance/categories', (req, res) => {
  const db = loadDB();
  res.json(db.financeCats);
});
app.post('/api/finance/categories', (req, res) => {
  const db = loadDB();
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'type and name required' });
  const list = type === 'credit' ? db.financeCats.credit : db.financeCats.debit;
  if (list.includes(name)) return res.status(409).json({ error: 'exists' });
  list.push(name);
  saveDB(db);
  res.json(db.financeCats);
});
app.delete('/api/finance/categories', (req, res) => {
  const db = loadDB();
  const { type, name } = req.query;
  if (!type || !name) return res.status(400).json({ error: 'type and name required' });
  const list = type === 'credit' ? db.financeCats.credit : db.financeCats.debit;
  const i = list.indexOf(name);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  list.splice(i, 1);
  saveDB(db);
  res.json(db.financeCats);
});

app.get('/api/finance/entries', (req, res) => {
  const db = loadDB();
  const { start, end } = req.query;
  let entries = db.finance.entries.slice();
  if (start) entries = entries.filter(x => x.date >= start);
  if (end) entries = entries.filter(x => x.date <= end);

  const balance = entries.reduce((acc, it) => acc + (it.type === 'credit' ? (+it.amount||0) : -(+it.amount||0)), 0);
  const running = db.finance.entries.reduce((acc, it) => acc + (it.type === 'credit' ? (+it.amount||0) : -(+it.amount||0)), 0);
  res.json({ entries, balance, running });
});
app.post('/api/finance/entries', (req, res) => {
  const db = loadDB();
  const { date, type, category, amount, note } = req.body || {};
  if (!date || !type || !category) return res.status(400).json({ error: 'date, type, category required' });
  db.finance.entries.push({
    id: uid('fin'),
    date, type, category,
    amount: +amount || 0,
    note: note || ''
  });
  saveDB(db);
  res.json({ ok: true });
});
app.delete('/api/finance/entries/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const i = db.finance.entries.findIndex(x => x.id === id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  db.finance.entries.splice(i, 1);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- influencers ----------
app.get('/api/influencers', (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers });
});
app.post('/api/influencers', (req, res) => {
  const db = loadDB();
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const row = { id: uid('inf'), name, social: social || '', country: country || '' };
  db.influencers.push(row);
  saveDB(db);
  res.json({ ok: true, influencer: row });
});
app.get('/api/influencers/spend', (req, res) => {
  const db = loadDB();
  res.json({ spends: db.infSpends });
});
app.post('/api/influencers/spend', (req, res) => {
  const db = loadDB();
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId) return res.status(400).json({ error: 'influencerId required' });
  const row = { id: uid('is'), date: date || null, influencerId, country: country || '', productId, amount: +amount || 0 };
  db.infSpends.push(row);
  saveDB(db);
  res.json({ ok: true, spend: row });
});
app.delete('/api/influencers/spend/:id', (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const i = db.infSpends.findIndex(x => x.id === id);
  if (i < 0) return res.status(404).json({ error: 'Not found' });
  db.infSpends.splice(i, 1);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- snapshots ----------
const { ensureSnapshotDir, listSnapshots, createSnapshot, restoreSnapshot, deleteSnapshot } =
  require('./utils/snapshot');

app.get('/api/snapshots', (req, res) => {
  ensureSnapshotDir();
  res.json({ snapshots: listSnapshots() });
});
app.post('/api/snapshots', (req, res) => {
  ensureSnapshotDir();
  const name = (req.body?.name || '').trim() || `snapshot-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}`;
  const file = createSnapshot(DB_FILE, name);
  res.json({ ok: true, file, name });
});
app.post('/api/snapshots/restore', (req, res) => {
  ensureSnapshotDir();
  const file = req.body?.file;
  if (!file) return res.status(400).json({ error: 'file required' });
  restoreSnapshot(DB_FILE, file); // NOTE: does NOT delete source snapshot
  res.json({ ok: true });
});
app.delete('/api/snapshots/:id', (req, res) => {
  ensureSnapshotDir();
  const id = req.params.id;
  const ok = deleteSnapshot(id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

// ---------- pages ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/product.html', (req, res) => res.sendFile(path.join(__dirname, 'product.html')));

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`EAS server running on :${PORT}`);
});
