// ------------------ server.js (with snapshots + restore) ------------------
import express from "express";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "eastafricashop";

// ----- Paths -----
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SNAP_DIR = path.join(__dirname, "snapshots");

// ensure folders
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });

// ----- DB helpers -----
function initDB() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      countries: ["china", "kenya", "tanzania", "uganda", "zambia", "zimbabwe"],
      products: [],
      deliveries: [],
      adspend: [],
      shipments: [],
      remittances: [],
      financeCategories: {
        debits: ["Facebook Ads", "TikTok Ads", "Google Ads", "Shipping", "Salaries"],
        credits: ["Revenue Boxleo", "Other Revenue"]
      },
      financeEntries: [],
      influencers: [],
      influencersSpend: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
}
initDB();

const loadDB = () => JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
const saveDB = (db) => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

// ----- Snapshots -----
function snapFilename(tag = "auto") {
  // Use millisecond epoch for easy sorting and selection.
  return path.join(SNAP_DIR, `${Date.now()}_${tag}.json`);
}
function writeSnapshot(tag = "auto") {
  try {
    fs.copyFileSync(DB_FILE, snapFilename(tag));
  } catch (e) {
    console.error("Snapshot failed:", e.message);
  }
}
function listSnapshots() {
  // returns [{ts, file, tag}]
  const files = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith(".json"));
  return files
    .map(f => {
      const [tsStr, tagWithExt] = f.split("_");
      const tag = tagWithExt.replace(".json", "");
      const ts = Number(tsStr);
      return { ts, file: f, tag };
    })
    .filter(x => Number.isFinite(x.ts))
    .sort((a, b) => b.ts - a.ts);
}
function pickSnapshotForWindow(msBack) {
  const target = Date.now() - msBack;
  // choose the latest snapshot <= target
  const snaps = listSnapshots().sort((a, b) => a.ts - b.ts); // ascending
  let chosen = null;
  for (const s of snaps) {
    if (s.ts <= target) chosen = s;
    else break;
  }
  return chosen;
}

// schedule: every 10 minutes (rolling restore points)
setInterval(() => writeSnapshot("10m"), 10 * 60 * 1000);

// schedule: daily snapshot (once per 24h)
setInterval(() => writeSnapshot("daily"), 24 * 60 * 60 * 1000);

// do one snapshot at boot so there’s at least one restore point
writeSnapshot("boot");

// ----- middleware -----
app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ----- auth -----
app.post("/api/auth", (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    // httpOnly false so the frontend can read/write? We only need it to be sent.
    res.cookie("auth", "ok", { httpOnly: false, sameSite: "lax" });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong password" });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api") && req.path !== "/api/auth") {
    if (req.cookies?.auth !== "ok") return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ----- meta -----
app.get("/api/meta", (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries, products: db.products });
});

// ----- products -----
app.get("/api/products", (req, res) => res.json({ products: loadDB().products }));

app.post("/api/products", (req, res) => {
  const db = loadDB();
  const id = "p_" + Math.random().toString(36).slice(2);
  db.products.push({ id, status: "active", ...req.body });
  saveDB(db);
  res.json({ ok: true, id });
});

app.delete("/api/products/:id", (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/products/:id/status", (req, res) => {
  const db = loadDB();
  const p = db.products.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ ok: false, error: "Not found" });
  p.status = req.body?.status || "active";
  saveDB(db);
  res.json({ ok: true });
});

// ----- deliveries -----
app.get("/api/deliveries", (req, res) => res.json({ deliveries: loadDB().deliveries }));
app.post("/api/deliveries", (req, res) => {
  const db = loadDB();
  const rec = { id: "d_" + Math.random().toString(36).slice(2), ...req.body };
  db.deliveries.push(rec);
  saveDB(db);
  res.json({ ok: true });
});
app.get("/api/deliveries/current-week", (req, res) => {
  const db = loadDB();
  // compute Mon-Sun in server timezone
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Monday=0
  const start = new Date(now);
  start.setDate(now.getDate() - dow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  const iso = d => new Date(d).toISOString().slice(0, 10);
  const days = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days[iso(d)] = 0;
  }
  db.deliveries.forEach(x => {
    const t = new Date(x.date).getTime();
    if (t >= start.getTime() && t <= end.getTime()) days[iso(x.date)] = (days[iso(x.date)] || 0) + (+x.delivered || 0);
  });
  res.json({ start: iso(start), end: iso(end), days });
});

// ----- ad spend -----
app.get("/api/adspend", (req, res) => res.json({ adSpends: loadDB().adspend }));
app.post("/api/adspend", (req, res) => {
  const db = loadDB();
  const rec = { id: "a_" + Math.random().toString(36).slice(2), ...req.body };
  // replace same day/platform/product/country if exists (your rule)
  const key = (r) => [r.date, r.platform, r.productId, r.country].join("|");
  db.adspend = db.adspend.filter(r => key(r) !== key(rec));
  db.adspend.push(rec);
  saveDB(db);
  res.json({ ok: true });
});

// ----- shipments (transit) -----
app.get("/api/shipments", (req, res) => res.json({ shipments: loadDB().shipments }));

app.post("/api/shipments", (req, res) => {
  const db = loadDB();
  const id = "s_" + Math.random().toString(36).slice(2);
  db.shipments.push({ id, ...req.body });
  saveDB(db);
  res.json({ ok: true, id });
});

app.put("/api/shipments/:id", (req, res) => {
  const db = loadDB();
  const item = db.shipments.find(s => s.id === req.params.id);
  if (item) Object.assign(item, req.body);
  saveDB(db);
  res.json({ ok: true });
});

app.delete("/api/shipments/:id", (req, res) => {
  const db = loadDB();
  db.shipments = db.shipments.filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ----- countries -----
app.get("/api/countries", (req, res) => res.json({ countries: loadDB().countries }));
app.post("/api/countries", (req, res) => {
  const db = loadDB();
  const n = String(req.body?.name || "").toLowerCase();
  if (n && !db.countries.includes(n)) db.countries.push(n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});
app.delete("/api/countries/:name", (req, res) => {
  const db = loadDB();
  const n = String(req.params.name || "").toLowerCase();
  db.countries = db.countries.filter(c => c !== n);
  saveDB(db);
  res.json({ ok: true, countries: db.countries });
});

// ----- finance -----
app.get("/api/finance/categories", (req, res) => {
  const db = loadDB();
  res.json(db.financeCategories || { debits: [], credits: [] });
});
app.post("/api/finance/categories", (req, res) => {
  const db = loadDB();
  const { type, name } = req.body || {};
  const key = type === "debit" ? "debits" : "credits";
  if (name && !db.financeCategories[key].includes(name)) db.financeCategories[key].push(name);
  saveDB(db);
  res.json(db.financeCategories);
});
app.post("/api/finance/entries", (req, res) => {
  const db = loadDB();
  const rec = { id: "fe_" + Math.random().toString(36).slice(2), ...req.body };
  db.financeEntries.push(rec);
  saveDB(db);
  res.json({ ok: true });
});
app.get("/api/finance/entries", (req, res) => {
  const db = loadDB();
  const { start, end, categories } = req.query;
  let list = db.financeEntries;
  const inRange = (d, s, e) => {
    const t = new Date(d).getTime();
    if (s && t < new Date(s).getTime()) return false;
    if (e && t > new Date(e).getTime()) return false;
    return true;
  };
  if (start || end) list = list.filter(x => inRange(x.date, start, end));
  if (categories) {
    const arr = categories.split(",").filter(Boolean);
    if (arr.length) list = list.filter(x => arr.includes(x.category));
  }
  const balance = list.reduce((a, x) => (x.type === "credit" ? a + (+x.amount || 0) : a - (+x.amount || 0)), 0);
  res.json({ entries: list, balance });
});

// ----- remittances -----
app.get("/api/remittances", (req, res) => res.json({ remittances: loadDB().remittances }));
app.post("/api/remittances", (req, res) => {
  const db = loadDB();
  const rec = { id: "r_" + Math.random().toString(36).slice(2), ...req.body };
  db.remittances.push(rec);
  saveDB(db);
  res.json({ ok: true });
});

// ----- snapshots API (list + restore) -----
app.get("/api/snapshots", (req, res) => {
  res.json({ snapshots: listSnapshots() });
});

// window: one of '10m' | '1h' | '24h' | '3d'  OR pass { file: "<exact snapshot filename>" }
app.post("/api/restore", (req, res) => {
  try {
    const { window, file } = req.body || {};
    let chosen = null;

    if (file) {
      const p = path.join(SNAP_DIR, file);
      if (fs.existsSync(p)) chosen = { file };
    } else if (window) {
      const map = { "10m": 10 * 60 * 1000, "1h": 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "3d": 3 * 24 * 60 * 60 * 1000 };
      const ms = map[window];
      if (!ms) return res.status(400).json({ ok: false, error: "Invalid window" });
      const s = pickSnapshotForWindow(ms);
      if (s) chosen = s;
    }

    if (!chosen) return res.status(404).json({ ok: false, error: "No matching snapshot found" });

    fs.copyFileSync(path.join(SNAP_DIR, chosen.file), DB_FILE);
    return res.json({ ok: true, restoredFrom: chosen.file });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Restore failed" });
  }
});

// ----- SPA fallback -----
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ----- start -----
app.listen(PORT, () => console.log(`✅ EAS system running on port ${PORT}`));
