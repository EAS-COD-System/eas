const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "db.json");
const SNAPSHOT_DIR = path.join(__dirname, "data", "snapshots");

app.use(bodyParser.json());
app.use(cookieParser());
app.use("/public", express.static(path.join(__dirname, "public")));

// ------------------- helpers -------------------
function loadDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {
      password: "eastafricashop",
      countries: ["china", "kenya", "tanzania", "uganda", "zambia", "zimbabwe"],
      products: [],
      adspend: [],
      deliveries: [],
      shipments: [],
      remittances: [],
      finance: { categories: { debit: [], credit: [] }, entries: [] },
      influencers: [],
      snapshots: []
    });
  }
  return fs.readJsonSync(DATA_FILE);
}
function saveDB(data) {
  fs.writeJsonSync(DATA_FILE, data, { spaces: 2 });
}
function snapshotDB(name) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapFile = path.join(SNAPSHOT_DIR, `${Date.now()}-${name || "manual"}.json`);
  fs.copyFileSync(DATA_FILE, snapFile);
  return snapFile;
}
function restoreDB(filename) {
  const filePath = path.join(SNAPSHOT_DIR, filename);
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, DATA_FILE);
}

// ------------------- auth -------------------
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  const db = loadDB();
  if (password === "logout") {
    res.clearCookie("auth");
    return res.json({ ok: true });
  }
  if (password === db.password) {
    res.cookie("auth", "1", { httpOnly: true });
    return res.json({ ok: true });
  }
  res.status(403).json({ error: "Wrong password" });
});

function requireAuth(req, res, next) {
  if (req.cookies.auth === "1") return next();
  res.status(403).json({ error: "Unauthorized" });
}

// ------------------- meta -------------------
app.get("/api/meta", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});

// ------------------- countries -------------------
app.get("/api/countries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});
app.post("/api/countries", requireAuth, (req, res) => {
  const db = loadDB();
  const { name } = req.body;
  if (name && !db.countries.includes(name)) db.countries.push(name);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ------------------- products -------------------
app.get("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ products: db.products });
});
app.post("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  const newP = { id: uuidv4(), status: "active", ...req.body };
  db.products.push(newP);
  saveDB(db);
  res.json({ ok: true, product: newP });
});
app.delete("/api/products/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});
app.post("/api/products/:id/status", requireAuth, (req, res) => {
  const db = loadDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (p) p.status = req.body.status;
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- ad spend -------------------
app.get("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend });
});
app.post("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, platform, amount } = req.body;
  const existing = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (existing) existing.amount = amount;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount });
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- deliveries -------------------
app.get("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ deliveries: db.deliveries });
});
app.post("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  db.deliveries.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- shipments -------------------
app.get("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ shipments: db.shipments });
});
app.post("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok: true });
});
app.put("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const s = db.shipments.find(x => x.id === req.params.id);
  if (s) Object.assign(s, req.body);
  saveDB(db);
  res.json({ ok: true });
});
app.delete("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments.filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- remittances -------------------
app.get("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ remittances: db.remittances });
});
app.post("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- finance -------------------
app.get("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.finance.categories);
});
app.post("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.body;
  if (type && name && !db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok: true });
});
app.get("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ entries: db.finance.entries });
});
app.post("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok: true });
});
app.delete("/api/finance/entries/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries = db.finance.entries.filter(e => e.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- snapshots (manual save/restore) -------------------
app.get("/api/snapshots", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots });
});
app.post("/api/snapshots", requireAuth, (req, res) => {
  const db = loadDB();
  const { name } = req.body;
  const file = snapshotDB(name);
  db.snapshots.push({ id: uuidv4(), name, file });
  saveDB(db);
  res.json({ ok: true, file });
});
app.post("/api/snapshots/restore", requireAuth, (req, res) => {
  const { file } = req.body;
  restoreDB(path.basename(file));
  res.json({ ok: true });
});
app.delete("/api/snapshots/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const snap = db.snapshots.find(s => s.id === req.params.id);
  if (snap && fs.existsSync(snap.file)) fs.removeSync(snap.file);
  db.snapshots = db.snapshots.filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ------------------- pages -------------------
app.get("/product.html", (req, res) => {
  res.sendFile(path.join(__dirname, "product.html"));
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ------------------- server -------------------
app.listen(PORT, () => console.log(`✅ EAS Tracker running on port ${PORT}`));
