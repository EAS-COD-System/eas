// server.js (hardened for Render)
const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 10000;

// --- Paths
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "db.json");
const SNAPSHOT_DIR = path.join(ROOT, "data", "snapshots");
const PUBLIC_DIR = path.join(ROOT, "public");

// --- Middleware
app.use(bodyParser.json());
app.use(cookieParser());
app.use("/public", express.static(PUBLIC_DIR));

// --- Utilities: DB load/save (never crash)
function defaultDB() {
  return {
    password: "eastafricashop",
    countries: ["china","kenya","tanzania","uganda","zambia","zimbabwe"],
    products: [],
    adspend: [],
    deliveries: [],
    shipments: [],
    remittances: [],
    finance: { categories: { debit: [], credit: [] }, entries: [] },
    influencers: [],
    snapshots: []
  };
}

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const d = defaultDB();
      fs.writeJsonSync(DATA_FILE, d, { spaces: 2 });
      return d;
    }
    // Try read; if file has comments/invalid JSON, repair with default
    try {
      return fs.readJsonSync(DATA_FILE);
    } catch (e) {
      console.error("db.json invalid JSON, auto-repairing:", e.message);
      const backup = DATA_FILE + ".bad-" + Date.now();
      try { fs.copyFileSync(DATA_FILE, backup); } catch {}
      const d = defaultDB();
      fs.writeJsonSync(DATA_FILE, d, { spaces: 2 });
      return d;
    }
  } catch (e) {
    console.error("loadDB() fatal error; falling back to in-memory DB:", e);
    return defaultDB();
  }
}
function saveDB(db) {
  try {
    fs.writeJsonSync(DATA_FILE, db, { spaces: 2 });
  } catch (e) {
    console.error("saveDB() failed:", e);
  }
}
function snapshotDB(name) {
  try {
    fs.mkdirpSync(SNAPSHOT_DIR);
    const file = path.join(SNAPSHOT_DIR, `${Date.now()}-${(name||"manual").replace(/[^a-z0-9-_]+/gi,"_")}.json`);
    fs.copyFileSync(DATA_FILE, file);
    return file;
  } catch (e) {
    console.error("snapshotDB error:", e);
    return null;
  }
}
function restoreDB(fileBasename) {
  try {
    const src = path.join(SNAPSHOT_DIR, fileBasename);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, DATA_FILE);
      return true;
    }
  } catch (e) {
    console.error("restoreDB error:", e);
  }
  return false;
}

// --- Auth
app.post("/api/auth", (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();
  if (password === "logout") {
    res.clearCookie("auth");
    return res.json({ ok: true });
  }
  if (password === db.password) {
    res.cookie("auth", "1", { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true });
  }
  res.status(403).json({ ok:false, error: "Wrong password" });
});

function requireAuth(req, res, next) {
  if (req.cookies && req.cookies.auth === "1") return next();
  return res.status(403).json({ ok:false, error: "Unauthorized" });
}

// --- Meta & Countries
app.get("/api/meta", requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries });
});
app.get("/api/countries", requireAuth, (req, res) => {
  res.json({ countries: loadDB().countries });
});
app.post("/api/countries", requireAuth, (req, res) => {
  const db = loadDB();
  const name = (req.body?.name || "").trim();
  if (name && !db.countries.includes(name)) db.countries.push(name);
  saveDB(db);
  res.json({ ok:true, countries: db.countries });
});

// --- Products
app.get("/api/products", requireAuth, (req, res) => {
  res.json({ products: loadDB().products });
});
app.post("/api/products", requireAuth, (req, res) => {
  const db = loadDB();
  const p = { id: uuidv4(), status: "active", ...req.body };
  db.products.push(p);
  saveDB(db);
  res.json({ ok:true, product: p });
});
app.post("/api/products/:id/status", requireAuth, (req, res) => {
  const db = loadDB();
  const item = db.products.find(x => x.id === req.params.id);
  if (item) item.status = req.body?.status || item.status;
  saveDB(db);
  res.json({ ok:true });
});
app.delete("/api/products/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok:true });
});

// --- Ad spend (date-less; replace per product+country+platform)
app.get("/api/adspend", requireAuth, (req, res) => {
  res.json({ adSpends: loadDB().adspend });
});
app.post("/api/adspend", requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ ok:false, error:"Missing fields" });
  const ex = db.adspend.find(a => a.productId===productId && a.country===country && a.platform===platform);
  if (ex) ex.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount:+amount||0 });
  saveDB(db);
  res.json({ ok:true });
});

// --- Deliveries
app.get("/api/deliveries", requireAuth, (req, res) => {
  res.json({ deliveries: loadDB().deliveries });
});
app.post("/api/deliveries", requireAuth, (req, res) => {
  const db = loadDB();
  db.deliveries.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok:true });
});

// --- Shipments
app.get("/api/shipments", requireAuth, (req, res) => {
  res.json({ shipments: loadDB().shipments });
});
app.post("/api/shipments", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok:true });
});
app.put("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const s = db.shipments.find(x => x.id === req.params.id);
  if (s) Object.assign(s, req.body);
  saveDB(db);
  res.json({ ok:true });
});
app.delete("/api/shipments/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments.filter(x => x.id !== req.params.id);
  saveDB(db);
  res.json({ ok:true });
});

// --- Remittances
app.get("/api/remittances", requireAuth, (req, res) => {
  res.json({ remittances: loadDB().remittances });
});
app.post("/api/remittances", requireAuth, (req, res) => {
  const db = loadDB();
  db.remittances.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok:true });
});

// --- Finance
app.get("/api/finance/categories", requireAuth, (req, res) => {
  res.json(loadDB().finance.categories);
});
app.post("/api/finance/categories", requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ ok:false, error:"Missing fields" });
  if (!db.finance.categories[type]) db.finance.categories[type] = [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db);
  res.json({ ok:true, categories: db.finance.categories });
});
app.get("/api/finance/entries", requireAuth, (req, res) => {
  res.json({ entries: loadDB().finance.entries });
});
app.post("/api/finance/entries", requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries.push({ id: uuidv4(), ...req.body });
  saveDB(db);
  res.json({ ok:true });
});
app.delete("/api/finance/entries/:id", requireAuth, (req, res) => {
  const db = loadDB();
  db.finance.entries = db.finance.entries.filter(e=>e.id!==req.params.id);
  saveDB(db);
  res.json({ ok:true });
});

// --- Snapshots
app.get("/api/snapshots", requireAuth, (req, res) => {
  res.json({ snapshots: loadDB().snapshots });
});
app.post("/api/snapshots", requireAuth, (req, res) => {
  const db = loadDB();
  const name = (req.body?.name || "").trim() || "manual";
  const file = snapshotDB(name);
  if (!file) return res.status(500).json({ ok:false, error:"Snapshot failed" });
  const rec = { id: uuidv4(), name, file: path.basename(file), createdAt: new Date().toISOString() };
  db.snapshots.push(rec);
  saveDB(db);
  res.json({ ok:true, snapshot: rec });
});
app.post("/api/snapshots/restore", requireAuth, (req, res) => {
  const { file } = req.body || {};
  if (!file) return res.status(400).json({ ok:false, error:"file required" });
  const ok = restoreDB(path.basename(file));
  if (!ok) return res.status(404).json({ ok:false, error:"snapshot not found" });
  res.json({ ok:true });
});
app.delete("/api/snapshots/:id", requireAuth, (req, res) => {
  const db = loadDB();
  const s = db.snapshots.find(x=>x.id===req.params.id);
  if (s) {
    try { fs.removeSync(path.join(SNAPSHOT_DIR, s.file)); } catch {}
    db.snapshots = db.snapshots.filter(x=>x.id!==s.id);
    saveDB(db);
  }
  res.json({ ok:true });
});

// --- HTML routes (works whether index.html is in root or /public)
function sendFileIfExists(res, p) {
  try {
    if (fs.existsSync(p)) return res.sendFile(p);
  } catch {}
  return false;
}
app.get("/product.html", (req, res) => {
  const rootProduct = path.join(ROOT, "product.html");
  const publicProduct = path.join(PUBLIC_DIR, "product.html");
  if (sendFileIfExists(res, rootProduct)) return;
  if (sendFileIfExists(res, publicProduct)) return;
  res.status(404).send("product.html not found");
});
app.get("/", (req, res) => {
  const rootIndex = path.join(ROOT, "index.html");
  const publicIndex = path.join(PUBLIC_DIR, "index.html");
  if (sendFileIfExists(res, rootIndex)) return;
  if (sendFileIfExists(res, publicIndex)) return;
  res.status(404).send("index.html not found");
});

// --- Start
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
  console.log("ROOT:", ROOT);
  console.log("Serving index.html from:", fs.existsSync(path.join(ROOT,"index.html")) ? "root" :
                                      fs.existsSync(path.join(PUBLIC_DIR,"index.html")) ? "/public" : "NOT FOUND");
});
