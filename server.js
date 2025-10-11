// server.js — EAS Tracker (clean rebuild, cookie auth + /api/meta)
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

/* ---------- helpers ---------- */
function ensureDB() {
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
function readDB() { ensureDB(); return fs.readJsonSync(DATA_FILE); }
function writeDB(db) { fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); }
function ensureSnapDir() { fs.ensureDirSync(SNAPSHOT_DIR); }

/* ---------- middleware ---------- */
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

/* ---------- auth ---------- */
app.post('/api/auth', (req, res) => {
  const db = readDB();
  const pw = (req.body?.password || '').trim();

  if (pw === 'logout') {
    res.clearCookie('auth', { path: '/' });
    return res.json({ ok: true });
  }
  if (pw && pw === db.password) {
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

/* Used by frontend to check session + prefetch */
app.get('/api/meta', requireAuth, (req, res) => {
  const db = readDB();
  res.json({ ok: true, countries: db.countries || [] });
});

/* ---------- countries ---------- */
app.get('/api/countries', requireAuth, (req, res) => {
  const db = readDB(); res.json({ countries: db.countries || [] });
});

app.post('/api/countries', requireAuth, (req, res) => {
  const name = (req.body?.name || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const db = readDB();
  db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  writeDB(db);
  res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const n = (req.params.name || '').toLowerCase();
  if (n === 'china') return res.status(400).json({ error: 'China cannot be deleted' });
  const db = readDB();
  db.countries = (db.countries || []).filter(c => c !== n);
  writeDB(db);
  res.json({ ok: true, countries: db.countries });
});

/* ---------- products ---------- */
app.get('/api/products', requireAuth, (req, res) => {
  const db = readDB(); res.json({ products: db.products || [] });
});

app.post('/api/products', requireAuth, (req, res) => {
  const body = req.body || {};
  const p = {
    id: uuid(),
    name: (body.name || '').trim(),
    sku: (body.sku || '').trim(),
    status: 'active',
    cost_china: +body.cost_china || 0,
    ship_china_to_kenya: +body.ship_china_to_kenya || 0,
    margin_budget: +body.margin_budget || 0,
    budgets: body.budgets || {}
  };
  if (!p.name) return res.status(400).json({ error: 'Product name required' });
  const db = readDB(); db.products.push(p); writeDB(db);
  res.json({ ok: true, product: p });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const db = readDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const num = k => (+body[k] || 0);
  if (body.name !== undefined) p.name = (body.name || '').trim();
  if (body.sku !== undefined) p.sku = (body.sku || '').trim();
  if (body.cost_china !== undefined) p.cost_china = num('cost_china');
  if (body.ship_china_to_kenya !== undefined) p.ship_china_to_kenya = num('ship_china_to_kenya');
  if (body.margin_budget !== undefined) p.margin_budget = num('margin_budget');
  if (body.budgets !== undefined) p.budgets = body.budgets || {};
  if (body.status !== undefined && ['active','paused'].includes(body.status)) p.status = body.status;

  writeDB(db);
  res.json({ ok: true, product: p });
});

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const db = readDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const status = req.body?.status;
  if (!['active','paused'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  p.status = status; writeDB(db);
  res.json({ ok: true, product: p });
});

/* full cascade delete across the system */
app.delete('/api/products/:id', requireAuth, (req, res) => {
  const id = req.params.id;
  const db = readDB();
  db.products         = (db.products || []).filter(p => p.id !== id);
  db.adspend          = (db.adspend || []).filter(a => a.productId !== id);
  db.shipments        = (db.shipments || []).filter(s => s.productId !== id);
  db.remittances      = (db.remittances || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(i => i.productId !== id);
  writeDB(db);
  res.json({ ok: true });
});

/* ---------- ad spend (replace mode) ---------- */
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = readDB(); res.json({ adspend: db.adspend || [] });
});
app.post('/api/adspend', requireAuth, (req, res) => {
  const { productId, country, platform } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Missing fields' });
  const amount = +req.body.amount || 0;
  const db = readDB();
  db.adspend = db.adspend || [];
  const hit = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (hit) hit.amount = amount;
  else db.adspend.push({ id: uuid(), productId, country, platform, amount });
  writeDB(db);
  res.json({ ok: true });
});

/* ---------- deliveries (weekly grid) ---------- */
app.get('/api/deliveries', requireAuth, (req, res) => {
  const db = readDB(); res.json({ deliveries: db.deliveries || [] });
});
app.post('/api/deliveries', requireAuth, (req, res) => {
  const { date, country } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });
  const delivered = +req.body.delivered || 0;
  const db = readDB();
  db.deliveries = db.deliveries || [];
  db.deliveries.push({ id: uuid(), date, country, delivered });
  writeDB(db);
  res.json({ ok: true });
});

/* ---------- shipments ---------- */
app.get('/api/shipments', requireAuth, (req, res) => {
  const db = readDB(); res.json({ shipments: db.shipments || [] });
});
app.post('/api/shipments', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.productId || !b.fromCountry || !b.toCountry)
    return res.status(400).json({ error: 'Missing fields' });
  const s = {
    id: uuid(),
    productId: b.productId,
    fromCountry: b.fromCountry,
    toCountry: b.toCountry,
    qty: +b.qty || 0,
    shipCost: +b.shipCost || 0,
    departedAt: b.departedAt || new Date().toISOString().slice(0,10),
    arrivedAt: b.arrivedAt || null
  };
  const db = readDB();
  db.shipments.push(s); writeDB(db);
  res.json({ ok: true, shipment: s });
});
app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = readDB();
  const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (req.body.arrivedAt !== undefined) s.arrivedAt = req.body.arrivedAt;
  if (req.body.qty !== undefined) s.qty = +req.body.qty;
  if (req.body.shipCost !== undefined) s.shipCost = +req.body.shipCost;
  writeDB(db); res.json({ ok: true, shipment: s });
});
app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.shipments = (db.shipments || []).filter(s => s.id !== req.params.id);
  writeDB(db); res.json({ ok: true });
});

/* ---------- remittances ---------- */
app.get('/api/remittances', requireAuth, (req, res) => {
  const { start, end, country } = req.query || {};
  const db = readDB();
  let list = db.remittances || [];
  if (start)   list = list.filter(r => r.start >= start);
  if (end)     list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  res.json({ remittances: list });
});
app.post('/api/remittances', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.start || !b.end || !b.country || !b.productId)
    return res.status(400).json({ error: 'Missing fields' });
  if (String(b.country).toLowerCase() === 'china')
    return res.status(400).json({ error: 'China cannot have remittance entries' });

  const rec = {
    id: uuid(),
    start: b.start,
    end: b.end,
    country: b.country,
    productId: b.productId,
    orders: +b.orders || 0,
    pieces: +b.pieces || 0,
    revenue: +b.revenue || 0,
    adSpend: +b.adSpend || 0,
    extraPerPiece: +b.extraPerPiece || 0,
    createdAt: new Date().toISOString()
  };
  const db = readDB();
  db.remittances.push(rec); writeDB(db);
  res.json({ ok: true, remittance: rec });
});

/* ---------- finance ---------- */
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = readDB(); res.json(db.finance?.categories || { debit: [], credit: [] });
});
app.post('/api/finance/categories', requireAuth, (req, res) => {
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing fields' });
  const db = readDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.categories[type] = db.finance.categories[type] || [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  writeDB(db);
  res.json({ ok: true, categories: db.finance.categories });
});
app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  const db = readDB();
  if (db.finance?.categories?.[type]) {
    db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
  }
  writeDB(db); res.json({ ok: true });
});

app.get('/api/finance/entries', requireAuth, (req, res) => {
  const { start, end } = req.query || {};
  const db = readDB(); const all = db.finance?.entries || [];
  let entries = all;
  if (start) entries = entries.filter(e => e.date >= start);
  if (end)   entries = entries.filter(e => e.date <= end);
  const sum = list => list.reduce((t,e)=>t + ((e.type==='credit'?1:-1) * (+e.amount||0)), 0);
  res.json({ entries, running: sum(all), balance: sum(entries) });
});
app.post('/api/finance/entries', requireAuth, (req, res) => {
  const { date, type, category } = req.body || {};
  if (!date || !type || !category) return res.status(400).json({ error: 'Missing fields' });
  const e = { id: uuid(), date, type, category, amount: +req.body.amount || 0, note: req.body.note || '' };
  const db = readDB();
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  db.finance.entries.push(e); writeDB(db);
  res.json({ ok: true, entry: e });
});
app.delete('/api/finance/entries/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.finance.entries = (db.finance.entries || []).filter(x => x.id !== req.params.id);
  writeDB(db); res.json({ ok: true });
});

/* ---------- influencers ---------- */
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = readDB(); res.json({ influencers: db.influencers || [] });
});
app.post('/api/influencers', requireAuth, (req, res) => {
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const db = readDB();
  const i = { id: uuid(), name, social: social || '', country: country || '' };
  db.influencers.push(i); writeDB(db);
  res.json({ ok: true, influencer: i });
});
app.delete('/api/influencers/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
  writeDB(db); res.json({ ok: true });
});
app.get('/api/influencers/spend', requireAuth, (req, res) => {
  const db = readDB(); res.json({ spends: db.influencerSpends || [] });
});
app.post('/api/influencers/spend', requireAuth, (req, res) => {
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId || !productId) return res.status(400).json({ error: 'Missing influencerId/productId' });
  const db = readDB();
  const rec = { id: uuid(), date: date || new Date().toISOString().slice(0,10), influencerId, country: country || '', productId, amount: +amount || 0 };
  db.influencerSpends = db.influencerSpends || [];
  db.influencerSpends.push(rec); writeDB(db);
  res.json({ ok: true, spend: rec });
});
app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  writeDB(db); res.json({ ok: true });
});

/* ---------- snapshots (persist until user deletes) ---------- */
app.get('/api/snapshots', requireAuth, (req, res) => {
  const db = readDB(); res.json({ snapshots: db.snapshots || [] });
});
app.post('/api/snapshots', requireAuth, async (req, res) => {
  ensureSnapDir();
  const db = readDB();
  const name = (req.body?.name || '').trim() || `Manual ${new Date().toLocaleString()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g,'_')}.json`);
  await fs.copy(DATA_FILE, file);
  const entry = { id: uuid(), name, file, createdAt: new Date().toISOString(), kind: 'manual' };
  db.snapshots = db.snapshots || [];
  db.snapshots.push(entry);
  db.snapshots.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  writeDB(db);
  res.json({ ok: true, snapshot: entry });
});
app.post('/api/snapshots/restore', requireAuth, async (req, res) => {
  const file = req.body?.file;
  if (!file) return res.status(400).json({ error: 'Missing file' });
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: 'Snapshot not found' });
  await fs.copy(safe, DATA_FILE);
  res.json({ ok: true, restoredFrom: safe });
});
app.delete('/api/snapshots/:id', requireAuth, (req, res) => {
  const db = readDB();
  db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
  writeDB(db); res.json({ ok: true });
});

/* ---------- pages ---------- */
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));

/* ---------- start ---------- */
app.listen(PORT, () => console.log(`✅ EAS Tracker running on :${PORT}`));
