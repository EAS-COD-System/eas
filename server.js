// ------------------ server.js ------------------
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

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = path.join(DATA_DIR, "db.json");

// Load or initialize JSON DB
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ products: [], deliveries: [], adspend: [], shipments: [], remittances: [], countries: ["china", "kenya", "tanzania", "uganda", "zambia", "zimbabwe"] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(cors());
app.use(morgan("dev"));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ------------------ AUTH ------------------
app.post("/api/auth", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.cookie("auth", "ok", { httpOnly: false });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong password" });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api") && req.path !== "/api/auth") {
    if (req.cookies.auth !== "ok") return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ------------------ BASIC API ------------------

// Get meta info (countries, etc.)
app.get("/api/meta", (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries, products: db.products });
});

// CRUD: Products
app.get("/api/products", (req, res) => res.json({ products: loadDB().products }));

app.post("/api/products", (req, res) => {
  const db = loadDB();
  const id = Date.now().toString();
  db.products.push({ id, status: "active", ...req.body });
  saveDB(db);
  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Daily delivered
app.get("/api/deliveries", (req, res) => res.json({ deliveries: loadDB().deliveries }));
app.post("/api/deliveries", (req, res) => {
  const db = loadDB();
  db.deliveries.push(req.body);
  saveDB(db);
  res.json({ ok: true });
});

// Ad spend
app.get("/api/adspend", (req, res) => res.json({ adSpends: loadDB().adspend }));
app.post("/api/adspend", (req, res) => {
  const db = loadDB();
  db.adspend.push(req.body);
  saveDB(db);
  res.json({ ok: true });
});

// Shipments
app.get("/api/shipments", (req, res) => res.json({ shipments: loadDB().shipments }));
app.post("/api/shipments", (req, res) => {
  const db = loadDB();
  const id = Date.now().toString();
  db.shipments.push({ id, ...req.body });
  saveDB(db);
  res.json({ ok: true });
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

// Countries
app.get("/api/countries", (req, res) => res.json({ countries: loadDB().countries }));
app.post("/api/countries", (req, res) => {
  const db = loadDB();
  if (!db.countries.includes(req.body.name)) db.countries.push(req.body.name);
  saveDB(db);
  res.json({ ok: true });
});
app.delete("/api/countries/:name", (req, res) => {
  const db = loadDB();
  db.countries = db.countries.filter(c => c !== req.params.name);
  saveDB(db);
  res.json({ ok: true });
});

// ------------------ DEFAULT ------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ------------------ START ------------------
app.listen(PORT, () => console.log(`✅ EAS system running on port ${PORT}`));
