// ============================================================
// EAS Tracker - Backend (server.js)
// ============================================================

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

// ============================================================
// Helpers
// ============================================================
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

// ============================================================
// Middleware
// ============================================================
app.use(morgan("dev"));
app.use(bodyParser.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/public", express.static(path.join(ROOT, "public")));
app.use(express.static(ROOT));

// ============================================================
// Auth
// ============================================================
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
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    return res.json({ ok: true });
  }

  return res.status(403).json({ error: "Wrong password" });
});

function requireAuth(req, res, next) {
  if (req.cookies.auth === "1") return next();
  return res.status(403).json({ error: "Unauthorized" });
}

// ============================================================
// Countries
// ============================================================
app.get("/api/countries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

app.post("/api/countries", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  const db = loadDB();

  db.countries = db.countries || [];
  const lower = name.toLowerCase();
  if (!db.countries.includes(lower)) db.countries.push(lower);

  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

app.delete("/api/countries/:name", requireAuth, (req, res) => {
  const n = req.params.name.toLowerCase();
  if (n === "china") return res.status(400).json({ error: "China cannot be deleted" });

  const db = loadDB();
  db.countries = (db.countries || []).filter((c) => c !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ============================================================
// Products
// ============================================================
app.get("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products || [] });
});

app.post("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  const p = {
    id: uuidv4(),
    name: req.body.name || "",
    sku: req.body.sku || "",
    status: "active",
    cost_china: +req.body.cost_china || 0,
    ship_china_to_kenya: +req.body.ship_china_to_kenya || 0,
    margin_budget: +req.body.margin_budget || 0,
    budgets: req.body.budgets || {}
  };

  if (!p.name) return res.status(400).json({ error: "Product name required" });

  db.products.push(p);
  saveDB(db);
  res.json({ ok: true, product: p });
});

// ✅ Delete product from entire system
app.delete("/api/products/:id", requireAuth, (req, res) => {
  const id = req.params.id;
  const db = loadDB();

  db.products = db.products.filter((p) => p.id !== id);
  db.adspend = db.adspend.filter((a) => a.productId !== id);
  db.shipments = db.shipments.filter((s) => s.productId !== id);
  db.remittances = db.remittances.filter((r) => r.productId !== id);
  db.influencerSpends = db.influencerSpends.filter((i) => i.productId !== id);

  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Ad Spend
// ============================================================
app.get("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adspend: db.adspend || [] });
});

app.post("/api/adspend", requireAuth, (req, res) => {
  const { productId, country, platform, amount } = req.body || {};
  const db = loadDB();

  if (!productId || !country || !platform)
    return res.status(400).json({ error: "Missing productId/country/platform" });

  db.adspend = db.adspend || [];
  const existing = db.adspend.find(
    (a) => a.productId === productId && a.country === country && a.platform === platform
  );

  if (existing) existing.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });

  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Deliveries
// ============================================================
app.get("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries || [] });
});

app.post("/api/deliveries", requireAuth, (req, res) => {
  const { date, country, delivered } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: "Missing date/country" });

  const db = loadDB();
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0 });
  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Shipments
// ============================================================
app.get("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments || [] });
});

app.post("/api/shipments", requireAuth, (req, res) => {
  const { productId, fromCountry, toCountry, qty, shipCost } = req.body || {};
  const db = loadDB();
  if (!productId || !fromCountry || !toCountry)
    return res.status(400).json({ error: "Missing fields" });

  const s = {
    id: uuidv4(),
    productId,
    fromCountry,
    toCountry,
    qty: +qty || 0,
    shipCost: +shipCost || 0,
    departedAt: new Date().toISOString().slice(0, 10),
    arrivedAt: null
  };

  db.shipments.push(s);
  saveDB(db);
  res.json({ ok: true, shipment: s });
});

// Mark shipment as arrived
app.put("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const s = db.shipments.find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: "Shipment not found" });

  if (req.body.arrivedAt) s.arrivedAt = req.body.arrivedAt;
  if (req.body.qty !== undefined) s.qty = +req.body.qty;
  if (req.body.shipCost !== undefined) s.shipCost = +req.body.shipCost;

  saveDB(db);
  res.json({ ok: true, shipment: s });
});

// Delete shipment
app.delete("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments.filter((s) => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Remittances
// ============================================================
app.get("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ remittances: db.remittances || [] });
});

app.post("/api/remittances", requireAuth, (req, res) => {
  const { start, end, country, productId } = req.body || {};
  if (!start || !end || !country || !productId)
    return res.status(400).json({ error: "Missing fields" });
  if (country === "china")
    return res.status(400).json({ error: "China cannot have remittance entries" });

  const db = loadDB();
  const r = { id: uuidv4(), ...req.body };
  db.remittances.push(r);
  saveDB(db);
  res.json({ ok: true, remittance: r });
});

// ============================================================
// Finance
// ============================================================
app.get("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post("/api/finance/categories", requireAuth, (req, res) => {
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: "Missing fields" });

  const db = loadDB();
  if (!db.finance.categories[type]) db.finance.categories[type] = [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok: true, categories: db.finance.categories });
});

app.delete("/api/finance/categories", requireAuth, (req, res) => {
  const { type, name } = req.query || {};
  const db = loadDB();
  if (!type || !name) return res.status(400).json({ error: "Missing type/name" });

  if (db.finance.categories[type])
    db.finance.categories[type] = db.finance.categories[type].filter((c) => c !== name);

  saveDB(db);
  res.json({ ok: true });
});

app.get("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ entries: db.finance.entries || [] });
});

app.post("/api/finance/entries", requireAuth, (req, res) => {
  const { date, type, category, amount, note } = req.body || {};
  if (!date || !type || !category)
    return res.status(400).json({ error: "Missing fields" });

  const db = loadDB();
  const e = { id: uuidv4(), date, type, category, amount: +amount || 0, note: note || "" };
  db.finance.entries.push(e);
  saveDB(db);
  res.json({ ok: true, entry: e });
});

// ============================================================
// Influencers
// ============================================================
app.get("/api/influencers", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post("/api/influencers", requireAuth, (req, res) => {
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  const db = loadDB();

  const i = { id: uuidv4(), name, social: social || "", country: country || "" };
  db.influencers.push(i);
  saveDB(db);
  res.json({ ok: true, influencer: i });
});

app.delete("/api/influencers/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = db.influencers.filter((i) => i.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Snapshots
// ============================================================
app.get("/api/snapshots", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots || [] });
});

app.post("/api/snapshots", requireAuth, async (req, res) => {
  ensureSnapshotDir();
  const db = loadDB();

  const name = (req.body?.name || "").trim() || `Manual ${new Date().toLocaleString()}`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g, "_")}.json`);
  await fs.copy(DATA_FILE, file);

  const entry = {
    id: uuidv4(),
    name,
    file,
    createdAt: new Date().toISOString(),
    kind: "manual"
  };

  db.snapshots.push(entry);
  db.snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  saveDB(db);

  res.json({ ok: true, snapshot: entry });
});

app.post("/api/snapshots/restore", requireAuth, async (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ error: "Missing file" });

  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error: "Snapshot not found" });

  await fs.copy(safe, DATA_FILE);
  res.json({ ok: true, restoredFrom: safe });
});

app.delete("/api/snapshots/:id", requireAuth, async (req, res) => {
  const db = loadDB();
  db.snapshots = db.snapshots.filter((s) => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ============================================================
// Pages
// ============================================================
app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/product.html", (req, res) => res.sendFile(path.join(ROOT, "product.html")));

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => console.log(`✅ EAS Tracker running on port ${PORT}`));
