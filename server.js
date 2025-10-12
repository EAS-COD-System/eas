const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');

app.use(cors());
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

// Helper functions
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Authentication middleware
function requireAuth(req, res, next) {
  const pass = req.headers['x-auth'] || req.body.password;
  const db = loadDB();
  if (pass === db.auth?.password) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ---------- AUTH ----------
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  const db = loadDB();
  if (password === db.auth?.password) res.json({ ok: true });
  else res.status(403).json({ error: 'Incorrect password' });
});

// ---------- COUNTRIES ----------
app.get('/api/countries', (req, res) => res.json(loadDB().countries || []));
app.post('/api/countries', requireAuth, (req, res) => {
  const db = loadDB();
  const c = req.body.name?.trim();
  if (c && !db.countries.includes(c)) db.countries.push(c);
  saveDB(db);
  res.json({ ok: true });
});
app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const db = loadDB();
  const c = req.params.name;
  if (c === 'China') return res.status(400).json({ error: 'Cannot delete China' });
  db.countries = db.countries.filter(x => x !== c);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- PRODUCTS ----------
app.get('/api/products', (req, res) => res.json(loadDB().products || []));
app.post('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  const p = req.body;
  p.id = p.id || Date.now().toString();
  db.products = db.products || [];
  const i = db.products.findIndex(x => x.id === p.id);
  if (i >= 0) db.products[i] = p; else db.products.push(p);
  saveDB(db);
  res.json({ ok: true });
});
app.delete('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- REMITTANCES ----------
app.get('/api/remittances', (req, res) => res.json(loadDB().remittances || []));
app.post('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB();
  const entry = { id: Date.now().toString(), ...req.body };
  db.remittances.push(entry);
  saveDB(db);
  res.json({ ok: true });
});
app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- SNAPSHOTS ----------
const SNAP_DIR = path.join(__dirname, 'snapshots');
fs.ensureDirSync(SNAP_DIR);

app.get('/api/snapshots', (req, res) => {
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));
  const snaps = files.map(f => ({
    name: JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f))).name,
    file: f
  }));
  res.json(snaps);
});

app.post('/api/snapshots', requireAuth, (req, res) => {
  const db = loadDB();
  const name = req.body.name || `snapshot-${Date.now()}`;
  const file = `${Date.now()}.json`;
  const snap = { name, date: new Date().toISOString(), db };
  fs.writeFileSync(path.join(SNAP_DIR, file), JSON.stringify(snap, null, 2));
  res.json({ ok: true });
});

app.post('/api/snapshots/:file/restore', requireAuth, (req, res) => {
  const file = req.params.file;
  const fpath = path.join(SNAP_DIR, file);
  if (!fs.existsSync(fpath)) return res.status(404).json({ error: 'Not found' });
  const snap = JSON.parse(fs.readFileSync(fpath));
  saveDB(snap.db);
  res.json({ ok: true });
});

app.delete('/api/snapshots/:file', requireAuth, (req, res) => {
  const file = req.params.file;
  const fpath = path.join(SNAP_DIR, file);
  if (fs.existsSync(fpath)) fs.removeSync(fpath);
  res.json({ ok: true });
});

// ---------- ROOT ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/product.html', (req, res) => res.sendFile(path.join(__dirname, 'product.html')));

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ EAS Tracker running on port ${PORT}`));
