// server.js
// EAS Tracker backend (Node 18+, works fine on Render)
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "db.json");
const SNAPSHOT_DIR = path.join(ROOT, "data", "snapshots");

// ---------- middleware ----------
app.use(morgan("dev"));
app.use(bodyParser.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/public", express.static(path.join(ROOT, "public")));

// ---------- helpers ----------
function initDBIfMissing() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(
      DATA_FILE,
      {
        password: "eastafricashop",
        countries: ["china", "kenya", "tanzania", "uganda", "zambia", "zimbabwe"],
        products: [],
        adspend: [],
        deliveries: [],
        shipments: [],
        remittances: [],
        finance: { categories: { debit: [], credit: [] }, entries: [] },
        influencers: [],
        influencerSpends: [],
        snapshots: [],
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

// ---------- auth ----------
app.post("/api/auth", (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  if (password === "logout") {
    res.clearCookie("auth");
    return res.json({ ok: true });
  }

  if (password && password === db.password) {
    res.cookie("auth", "1", {
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      path: "/",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days persistent login
    });
    return res.json({ ok: true });
  }

  return res.status(403).json({ error: "Wrong password" });
});

function requireAuth(req, res, next) {
  if (req.cookies.auth === "1") return next();
  return res.status(403).json({ error: "Unauthorized" });
}

// ---------- meta ----------
app.get("/api/meta", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});

// ---------- countries ----------
app.get("/api/countries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});

app.post("/api/countries", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  const db = loadDB();
  if (!db.countries.includes(name.toLowerCase())) db.countries.push(name.toLowerCase());
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

app.delete("/api/countries/:name", requireAuth, (req, res) => {
  const db = loadDB();
  const n = req.params.name.toLowerCase();
  if (n === "china") return res.status(400).json({ error: "China cannot be deleted" });
  db.countries = db.countries.filter((c) => c !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ---------- products ----------
app.get("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products });
});

app.post("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  const p = {
    id: uuidv4(),
    name: req.body.name,
    sku: req.body.sku,
    cost_china: +req.body.cost_china || 0,
    ship_china_to_kenya: +req.body.ship_china_to_kenya || 0,
    margin_budget: +req.body.margin_budget || 0,
    budgets: {},
  };
  db.products.push(p);
  saveDB(db);
  res.json({ ok: true, product: p });
});

app.delete("/api/products/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const pid = req.params.id;
  db.products = db.products.filter((p) => p.id !== pid);
  db.adspend = db.adspend.filter((a) => a.productId !== pid);
  db.shipments = db.shipments.filter((s) => s.productId !== pid);
  db.remittances = db.remittances.filter((r) => r.productId !== pid);
  db.influencerSpends = db.influencerSpends.filter((s) => s.productId !== pid);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- shipments ----------
app.get("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments });
});

app.post("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry,
    toCountry: req.body.toCountry,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: null,
  };
  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.put("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const s = db.shipments.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });

  if (req.body.arrivedAt) {
    s.arrivedAt = req.body.arrivedAt;
    // adjust stocks
    db.deliveries = db.deliveries || [];
    db.deliveries.push({
      id: uuidv4(),
      date: s.arrivedAt,
      country: s.toCountry,
      delivered: s.qty,
    });
    // deduct from source
    db.deliveries.push({
      id: uuidv4(),
      date: s.arrivedAt,
      country: s.fromCountry,
      delivered: -s.qty,
    });
  } else {
    if (req.body.qty !== undefined) s.qty = +req.body.qty || 0;
    if (req.body.shipCost !== undefined) s.shipCost = +req.body.shipCost || 0;
  }
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

app.delete("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments.filter((x) => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- ad spend (replace/upsert) ----------
app.get("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend });
});

app.post("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, platform, amount } = req.body;
  const found = db.adspend.find(
    (a) => a.productId === productId && a.country === country && a.platform === platform
  );
  if (found) found.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ---------- deliveries ----------
app.get("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries });
});

app.post("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  db.deliveries.push({
    id: uuidv4(),
    date: req.body.date,
    country: req.body.country,
    delivered: +req.body.delivered || 0,
  });
  saveDB(db);
  res.json({ ok: true });
});

// ---------- remittances ----------
app.get("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  let list = db.remittances;
  const { country } = req.query;
  if (country) list = list.filter((r) => r.country === country);
  res.json({ remittances: list });
});

app.post("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  const c = req.body.country?.toLowerCase();
  if (c === "china") return res.status(400).json({ error: "China cannot be used in remittance" });
  const r = {
    id: uuidv4(),
    start: req.body.start,
    end: req.body.end,
    country: c,
    productId: req.body.productId,
    orders: +req.body.orders || 0,
    pieces: +req.body.pieces || 0,
    revenue: +req.body.revenue || 0,
    adSpend: +req.body.adSpend || 0,
    extraPerPiece: +req.body.extraPerPiece || 0,
  };
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

// ---------- finance ----------
app.get("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance.categories);
});

app.post("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.body;
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok: true });
});

app.delete("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.query;
  db.finance.categories[type] = db.finance.categories[type].filter((c) => c !== name);
  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end } = req.query;
  let list = db.finance.entries;
  if (start) list = list.filter((e) => e.date >= start);
  if (end) list = list.filter((e) => e.date <= end);
  const running = db.finance.entries.reduce(
    (a, e) => a + (e.type === "credit" ? +e.amount : -e.amount),
    0
  );
  const period = list.reduce(
    (a, e) => a + (e.type === "credit" ? +e.amount : -e.amount),
    0
  );
  res.json({ entries: list, running, balance: period });
});

app.post("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  const e = {
    id: uuidv4(),
    date: req.body.date,
    type: req.body.type,
    category: req.body.category,
    amount: +req.body.amount || 0,
    note: req.body.note || "",
  };
  db.finance.entries.push(e);
  saveDB(db);
  res.json({ ok: true, entry: e });
});

app.delete("/api/finance/entries/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries = db.finance.entries.filter((e) => e.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- influencers ----------
app.get("/api/influencers", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers });
});

app.post("/api/influencers", requireAuth, (req, res) => {
  const db = loadDB();
  const inf = {
    id: uuidv4(),
    name: req.body.name,
    social: req.body.social,
    country: req.body.country,
  };
  db.influencers.push(inf);
  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/influencers/spend", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ spends: db.influencerSpends });
});

app.post("/api/influencers/spend", requireAuth, (req, res) => {
  const db = loadDB();
  const s = {
    id: uuidv4(),
    date: req.body.date || new Date().toISOString().slice(0, 10),
    influencerId: req.body.influencerId,
    productId: req.body.productId,
    country: req.body.country,
    amount: +req.body.amount || 0,
  };
  db.influencerSpends.push(s);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- snapshots ----------
app.get("/api/snapshots", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots });
});

app.post("/api/snapshots", requireAuth, async (req, res) => {
  ensureSnapshotDir();
  const db = loadDB();
  const name = req.body.name?.trim() || `Manual ${new Date().toLocaleString()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g, "_")}.json`);
  await fs.copy(DATA_FILE, file);
  const entry = { id: uuidv4(), name, file, createdAt: new Date().toISOString(), kind: "manual" };
  db.snapshots.push(entry);
  saveDB(db);
  res.json({ ok: true, snapshot: entry });
});

app.post("/api/snapshots/restore", requireAuth, async (req, res) => {
  const { file } = req.body;
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: "Snapshot not found" });
  await fs.copy(safe, DATA_FILE);
  res.json({ ok: true, restoredFrom: safe });
});

app.delete("/api/snapshots/:id", requireAuth, async (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  const snap = db.snapshots.find((s) => s.id === id);
  if (snap && fs.existsSync(snap.file)) await fs.remove(snap.file);
  db.snapshots = db.snapshots.filter((s) => s.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ---------- static pages ----------
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/product.html", (req, res) => res.sendFile(path.join(ROOT, "product.html")));

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
  console.log(`📁 Data: ${DATA_FILE}`);
});
