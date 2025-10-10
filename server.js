const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 10000; // Render uses this
const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA_FILE = path.join(ROOT, "db.json");
const SNAPSHOT_DIR = path.join(ROOT, "data", "snapshots");

/* ------------------- middleware ------------------- */
app.use(bodyParser.json());
app.use(cookieParser());

// serve /public first, then root (so /public overrides)
if (fs.existsSync(PUB)) app.use(express.static(PUB));
app.use(express.static(ROOT));

/* --------- tiny helpers to see what’s on Render ----- */
function list(dir) {
  try { return fs.readdirSync(dir).join(", "); } catch { return "(missing)"; }
}
function indexPath() {
  const p1 = path.join(PUB, "index.html");
  const p2 = path.join(ROOT, "index.html");
  if (fs.existsSync(p1)) return p1;
  if (fs.existsSync(p2)) return p2;
  return null;
}

/* ------------------- DB helpers ------------------- */
function ensureDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {
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
    }, { spaces: 2 });
  }
}
function loadDB(){ ensureDB(); return fs.readJsonSync(DATA_FILE); }
function saveDB(db){ fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); }
function snapshotDB(name){
  fs.mkdirpSync(SNAPSHOT_DIR);
  const file = path.join(SNAPSHOT_DIR, `${Date.now()}-${name||"manual"}.json`);
  fs.copyFileSync(DATA_FILE, file);
  return file;
}

/* ------------------- AUTH ------------------- */
app.post("/api/auth", (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();
  if (password === "logout") { res.clearCookie("auth"); return res.json({ ok:true }); }
  if (password === db.password) { res.cookie("auth","1",{ httpOnly:true }); return res.json({ ok:true }); }
  return res.status(403).json({ ok:false, error:"Wrong password" });
});
function requireAuth(req,res,next){ return req.cookies.auth==="1" ? next() : res.status(403).json({ ok:false, error:"Unauthorized" }); }

/* ------------------- API (short version kept) ------------------- */
app.get("/api/meta", requireAuth, (req,res)=> res.json({ countries: loadDB().countries }));
app.get("/api/countries", requireAuth, (req,res)=> res.json({ countries: loadDB().countries }));
app.post("/api/countries", requireAuth, (req,res)=>{
  const db = loadDB(); const { name } = req.body || {};
  if (name && !db.countries.includes(name)) db.countries.push(name);
  saveDB(db); res.json({ ok:true, countries: db.countries });
});

app.get("/api/products", requireAuth, (req,res)=> res.json({ products: loadDB().products }));
app.post("/api/products", requireAuth, (req,res)=>{
  const db = loadDB(); const p = { id: uuidv4(), status:"active", ...req.body };
  db.products.push(p); saveDB(db); res.json({ ok:true, product:p });
});
app.post("/api/products/:id/status", requireAuth, (req,res)=>{
  const db = loadDB(); const it = db.products.find(x=>x.id===req.params.id);
  if (it) it.status = req.body.status; saveDB(db); res.json({ ok:true });
});
app.delete("/api/products/:id", requireAuth, (req,res)=>{
  const db = loadDB(); db.products = db.products.filter(x=>x.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

app.get("/api/adspend", requireAuth, (req,res)=> res.json({ adSpends: loadDB().adspend }));
app.post("/api/adspend", requireAuth, (req,res)=>{
  const db = loadDB();
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ ok:false, error:"Missing fields" });
  const ex = db.adspend.find(a=>a.productId===productId && a.country===country && a.platform===platform);
  if (ex) ex.amount = +amount || 0; else db.adspend.push({ id:uuidv4(), productId, country, platform, amount:+amount||0 });
  saveDB(db); res.json({ ok:true });
});

app.get("/api/deliveries", requireAuth, (req,res)=> res.json({ deliveries: loadDB().deliveries }));
app.post("/api/deliveries", requireAuth, (req,res)=>{
  const db = loadDB(); db.deliveries.push({ id:uuidv4(), ...req.body });
  saveDB(db); res.json({ ok:true });
});

app.get("/api/shipments", requireAuth, (req,res)=> res.json({ shipments: loadDB().shipments }));
app.post("/api/shipments", requireAuth, (req,res)=>{
  const db = loadDB(); db.shipments.push({ id:uuidv4(), ...req.body });
  saveDB(db); res.json({ ok:true });
});
app.put("/api/shipments/:id", requireAuth, (req,res)=>{
  const db = loadDB(); const s = db.shipments.find(x=>x.id===req.params.id);
  if (s) Object.assign(s, req.body); saveDB(db); res.json({ ok:true });
});
app.delete("/api/shipments/:id", requireAuth, (req,res)=>{
  const db = loadDB(); db.shipments = db.shipments.filter(x=>x.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

app.get("/api/remittances", requireAuth, (req,res)=> res.json({ remittances: loadDB().remittances }));
app.post("/api/remittances", requireAuth, (req,res)=>{
  const db = loadDB(); db.remittances.push({ id:uuidv4(), ...req.body });
  saveDB(db); res.json({ ok:true });
});

app.get("/api/finance/categories", requireAuth, (req,res)=> res.json(loadDB().finance.categories));
app.post("/api/finance/categories", requireAuth, (req,res)=>{
  const db = loadDB(); const { type, name } = req.body || {};
  if (type && name && !db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db); res.json({ ok:true, categories: db.finance.categories });
});
app.get("/api/finance/entries", requireAuth, (req,res)=> res.json({ entries: loadDB().finance.entries }));
app.post("/api/finance/entries", requireAuth, (req,res)=>{
  const db = loadDB(); db.finance.entries.push({ id:uuidv4(), ...req.body });
  saveDB(db); res.json({ ok:true });
});
app.delete("/api/finance/entries/:id", requireAuth, (req,res)=>{
  const db = loadDB(); db.finance.entries = db.finance.entries.filter(e=>e.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

app.get("/api/snapshots", requireAuth, (req,res)=> res.json({ snapshots: loadDB().snapshots }));
app.post("/api/snapshots", requireAuth, (req,res)=>{
  const db = loadDB(); const { name } = req.body || {};
  const file = snapshotDB(name||"manual"); db.snapshots.push({ id:uuidv4(), name:name||"manual", file });
  saveDB(db); res.json({ ok:true, file });
});
app.post("/api/snapshots/restore", requireAuth, (req,res)=>{
  const { file } = req.body || {};
  if (!file || !fs.existsSync(file)) return res.status(400).json({ ok:false, error:"Snapshot not found" });
  fs.copyFileSync(file, DATA_FILE);
  res.json({ ok:true });
});

/* ------------------- pages ------------------- */
app.get("/product.html", (req,res)=>{
  const file = fs.existsSync(path.join(PUB,"product.html"))
    ? path.join(PUB,"product.html")
    : path.join(ROOT,"product.html");
  if (fs.existsSync(file)) return res.sendFile(file);
  res.status(404).send("product.html not found");
});
app.get("/", (req,res)=>{
  const idx = indexPath();
  if (idx) return res.sendFile(idx);
  res
    .status(200)
    .send(`<h1>index.html not found</h1>
      <pre>Looked in:
- ${path.join(PUB, "index.html")}
- ${path.join(ROOT, "index.html")}

ROOT files:  ${list(ROOT)}
PUBLIC files: ${list(PUB)}</pre>`);
});

/* ------------------- boot ------------------- */
app.listen(PORT, () => {
  console.log(`✅ EAS Tracker running on port ${PORT}`);
  console.log(`ROOT:   ${ROOT}`);
  console.log(`PUBLIC: ${fs.existsSync(PUB) ? PUB : "(missing)"}`);
  console.log(`ROOT files:   ${list(ROOT)}`);
  console.log(`PUBLIC files: ${list(PUB)}`);
  const idx = indexPath();
  console.log(idx ? `Serving index.html from: ${idx}` : "⚠️ index.html not found in root or /public");
});
