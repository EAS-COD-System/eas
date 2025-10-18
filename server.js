// server.js – EAS Tracker backend - Enhanced Version
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');

/* ---------------- middleware ---------------- */
app.use(morgan('dev'));
app.use(bodyParser.json({ limit:'1mb' }));
app.use(cookieParser());

// FIX: Correct static file serving
app.use('/public', express.static(path.join(ROOT, 'public')));
app.use(express.static(ROOT)); // Serve static files from root for HTML files

/* ---------------- helpers ---------------- */
function ensureDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {
      password: 'eastafricashop',
      countries: ['china','kenya','tanzania','uganda','zambia','zimbabwe'],
      products: [],
      adspend: [],
      deliveries: [],
      shipments: [],
      remittances: [],
      orders: [],
      productNotes: [],
      testedProducts: [],
      brainstorming: [],
      finance: { categories: { debit:[], credit:[] }, entries: [] },
      influencers: [],
      influencerSpends: [],
      snapshots: []
    }, { spaces: 2 });
  }
}
function loadDB(){ ensureDB(); return fs.readJsonSync(DATA_FILE); }
function saveDB(db){ fs.writeJsonSync(DATA_FILE, db, { spaces:2 }); }
function ensureSnapDir(){ fs.ensureDirSync(SNAPSHOT_DIR); }

function runningBalance(db) {
  return (db.finance?.entries||[]).reduce((acc,e)=> acc + (e.type==='credit' ? +e.amount||0 : -(+e.amount||0)), 0);
}

/* ---------------- auth ---------------- */
app.post('/api/auth', (req,res)=>{
  const { password } = req.body || {};
  const db = loadDB();
  if (password === 'logout') {
    res.clearCookie('auth', { httpOnly:true, sameSite:'Lax', secure:process.env.NODE_ENV==='production', path:'/' });
    return res.json({ ok:true });
  }
  if (password && password === db.password) {
    res.cookie('auth','1', { httpOnly:true, sameSite:'Lax', secure:process.env.NODE_ENV==='production', path:'/', maxAge: 365*24*60*60*1000 });
    return res.json({ ok:true });
  }
  return res.status(403).json({ error:'Wrong password' });
});

function requireAuth(req,res,next){
  if (req.cookies.auth === '1') return next();
  return res.status(403).json({ error:'Unauthorized' });
}

/* ---------------- meta ---------------- */
app.get('/api/meta', requireAuth, (req,res)=>{
  const db = loadDB();
  res.json({ countries: db.countries||[] });
});

/* ---------------- countries ---------------- */
app.get('/api/countries', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ countries: db.countries||[] });
});
app.post('/api/countries', requireAuth, (req,res)=>{
  const { name } = req.body||{};
  if (!name) return res.status(400).json({ error:'Missing name' });
  const db = loadDB(); db.countries = db.countries||[];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db); res.json({ ok:true, countries: db.countries });
});
app.delete('/api/countries/:name', requireAuth, (req,res)=>{
  const n = req.params.name;
  const db = loadDB(); db.countries = (db.countries||[]).filter(c=>c!==n);
  saveDB(db); res.json({ ok:true, countries: db.countries });
});

/* ---------------- products ---------------- */
app.get('/api/products', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ products: db.products||[] });
});
app.post('/api/products', requireAuth, (req,res)=>{
  const db = loadDB(); db.products = db.products||[];
  const p = {
    id: uuidv4(),
    status: 'active',
    name: req.body.name||'',
    sku: req.body.sku||'',
    selling_prices: req.body.selling_prices||{},
    margin_budget: +req.body.margin_budget||0,
    budgets: req.body.budgets||{}
  };
  if (!p.name) return res.status(400).json({ error:'Name required' });
  db.products.push(p); saveDB(db); res.json({ ok:true, product:p });
});
app.put('/api/products/:id', requireAuth, (req,res)=>{
  const db = loadDB();
  const p = (db.products||[]).find(x=>x.id===req.params.id);
  if (!p) return res.status(404).json({ error:'Not found' });
  const up = req.body||{};
  if (up.name!==undefined) p.name=up.name;
  if (up.sku!==undefined) p.sku=up.sku;
  if (up.selling_prices!==undefined) p.selling_prices=up.selling_prices;
  if (up.margin_budget!==undefined) p.margin_budget=+up.margin_budget||0;
  if (up.budgets!==undefined) p.budgets=up.budgets||{};
  saveDB(db); res.json({ ok:true, product:p });
});
app.post('/api/products/:id/status', requireAuth, (req,res)=>{
  const db = loadDB(); const p = (db.products||[]).find(x=>x.id===req.params.id);
  if (!p) return res.status(404).json({ error:'Not found' });
  p.status = req.body.status||'active'; saveDB(db); res.json({ ok:true, product:p });
});
app.delete('/api/products/:id', requireAuth, (req,res)=>{
  const db = loadDB();
  const id = req.params.id;
  db.products = (db.products||[]).filter(p=>p.id!==id);
  db.adspend = (db.adspend||[]).filter(a=>a.productId!==id);
  db.shipments = (db.shipments||[]).filter(s=>s.productId!==id);
  db.remittances = (db.remittances||[]).filter(r=>r.productId!==id);
  db.influencerSpends = (db.influencerSpends||[]).filter(sp=>sp.productId!==id);
  db.productNotes = (db.productNotes||[]).filter(n=>n.productId!==id);
  saveDB(db);
  res.json({ ok:true });
});

/* ---------------- product notes ---------------- */
app.get('/api/product-notes/:productId', requireAuth, (req,res)=>{
  const db = loadDB();
  const notes = (db.productNotes||[]).filter(n=>n.productId===req.params.productId);
  res.json({ notes });
});
app.post('/api/product-notes', requireAuth, (req,res)=>{
  const db = loadDB(); db.productNotes = db.productNotes||[];
  const { productId, country, note } = req.body||{};
  if (!productId || !country) return res.status(400).json({ error:'Missing fields' });
  
  const existing = db.productNotes.find(n=>n.productId===productId && n.country===country);
  if (existing) {
    existing.note = note;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.productNotes.push({
      id: uuidv4(),
      productId,
      country,
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  saveDB(db); res.json({ ok:true });
});

/* ---------------- tested products ---------------- */
app.get('/api/tested-products', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ testedProducts: db.testedProducts||[] });
});
app.post('/api/tested-products', requireAuth, (req,res)=>{
  const db = loadDB(); db.testedProducts = db.testedProducts||[];
  const { productName, country, costPerLead, confirmationRate, sellingPrice } = req.body||{};
  if (!productName || !country) return res.status(400).json({ error:'Missing fields' });
  
  const existing = db.testedProducts.find(t=>t.productName===productName && t.country===country);
  if (existing) {
    existing.costPerLead = +costPerLead||0;
    existing.confirmationRate = +confirmationRate||0;
    existing.sellingPrice = +sellingPrice||0;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.testedProducts.push({
      id: uuidv4(),
      productName,
      country,
      costPerLead: +costPerLead||0,
      confirmationRate: +confirmationRate||0,
      sellingPrice: +sellingPrice||0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
  saveDB(db); res.json({ ok:true });
});

/* ---------------- brainstorming ---------------- */
app.get('/api/brainstorming', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ ideas: db.brainstorming||[] });
});
app.post('/api/brainstorming', requireAuth, (req,res)=>{
  const db = loadDB(); db.brainstorming = db.brainstorming||[];
  const { title, description, category, priority } = req.body||{};
  if (!title) return res.status(400).json({ error:'Missing title' });
  
  const idea = {
    id: uuidv4(),
    title,
    description: description||'',
    category: category||'general',
    priority: priority||'medium',
    status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.brainstorming.push(idea);
  saveDB(db); res.json({ ok:true, idea });
});
app.put('/api/brainstorming/:id', requireAuth, (req,res)=>{
  const db = loadDB();
  const idea = (db.brainstorming||[]).find(i=>i.id===req.params.id);
  if (!idea) return res.status(404).json({ error:'Not found' });
  
  const up = req.body||{};
  if (up.title!==undefined) idea.title=up.title;
  if (up.description!==undefined) idea.description=up.description;
  if (up.category!==undefined) idea.category=up.category;
  if (up.priority!==undefined) idea.priority=up.priority;
  if (up.status!==undefined) idea.status=up.status;
  idea.updatedAt = new Date().toISOString();
  
  saveDB(db); res.json({ ok:true, idea });
});
app.delete('/api/brainstorming/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.brainstorming = (db.brainstorming||[]).filter(i=>i.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* ---------------- orders ---------------- */
app.get('/api/orders', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ orders: db.orders||[] });
});
app.post('/api/orders', requireAuth, (req,res)=>{
  const db = loadDB(); db.orders = db.orders||[];
  const { productId, startDate, endDate, ordersCount } = req.body||{};
  if (!productId || !startDate || !endDate) return res.status(400).json({ error:'Missing fields' });
  
  const order = {
    id: uuidv4(),
    productId,
    startDate,
    endDate,
    ordersCount: +ordersCount||0,
    createdAt: new Date().toISOString()
  };
  db.orders.push(order);
  saveDB(db); res.json({ ok:true, order });
});

/* ---------------- adspend (replace current) ---------------- */
app.get('/api/adspend', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ adSpends: db.adspend||[] });
});
app.post('/api/adspend', requireAuth, (req,res)=>{
  const db = loadDB(); db.adspend = db.adspend||[];
  const { productId, country, platform, amount } = req.body||{};
  if (!productId || !country || !platform) return res.status(400).json({ error:'Missing fields' });
  const ex = db.adspend.find(a=>a.productId===productId && a.country===country && a.platform===platform);
  if (ex) ex.amount = +amount||0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount:+amount||0 });
  saveDB(db); res.json({ ok:true });
});

/* ---------------- deliveries ---------------- */
app.get('/api/deliveries', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ deliveries: db.deliveries||[] });
});
app.post('/api/deliveries', requireAuth, (req,res)=>{
  const db = loadDB(); db.deliveries = db.deliveries||[];
  const { date, country, delivered } = req.body||{};
  if (!date||!country) return res.status(400).json({ error:'Missing date/country' });
  db.deliveries.push({ id: uuidv4(), date, country, delivered:+delivered||0 });
  saveDB(db); res.json({ ok:true });
});

/* ---------------- shipments ---------------- */
app.get('/api/shipments', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ shipments: db.shipments||[] });
});
app.post('/api/shipments', requireAuth, (req,res)=>{
  const db = loadDB(); db.shipments = db.shipments||[];
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry || req.body.from,
    toCountry: req.body.toCountry || req.body.to,
    qty: +req.body.qty||0,
    shipCost: +req.body.shipCost||0,
    purchaseCost: req.body.fromCountry === 'china' ? +req.body.purchaseCost||0 : 0,
    note: req.body.note || '',
    departedAt: req.body.departedAt || new Date().toISOString().slice(0,10),
    arrivedAt: req.body.arrivedAt || null
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error:'Missing fields' });
  db.shipments.push(s); saveDB(db); res.json({ ok:true, shipment:s });
});
app.put('/api/shipments/:id', requireAuth, (req,res)=>{
  const db = loadDB(); const s = (db.shipments||[]).find(x=>x.id===req.params.id);
  if (!s) return res.status(404).json({ error:'Not found' });
  const up = req.body||{};
  if (up.qty!==undefined) s.qty=+up.qty||0;
  if (up.shipCost!==undefined) s.shipCost=+up.shipCost||0;
  if (up.purchaseCost!==undefined) s.purchaseCost=+up.purchaseCost||0;
  if (up.note!==undefined) s.note=up.note;
  if (up.departedAt!==undefined) s.departedAt=up.departedAt;
  if (up.arrivedAt!==undefined) s.arrivedAt=up.arrivedAt;
  saveDB(db); res.json({ ok:true, shipment:s });
});
app.delete('/api/shipments/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.shipments = (db.shipments||[]).filter(x=>x.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* ---------------- remittances ---------------- */
app.get('/api/remittances', requireAuth, (req,res)=>{
  const db = loadDB(); let list = db.remittances||[];
  const { start, end, country, productId } = req.query||{};
  if (start) list = list.filter(r=>r.start>=start);
  if (end)   list = list.filter(r=>r.end<=end);
  if (country) list = list.filter(r=>r.country===country);
  if (productId) list = list.filter(r=>r.productId===productId);
  res.json({ remittances: list });
});
app.post('/api/remittances', requireAuth, (req,res)=>{
  const db = loadDB(); db.remittances = db.remittances||[];
  const r = {
    id: uuidv4(),
    start:req.body.start, end:req.body.end,
    country:req.body.country, productId:req.body.productId,
    orders:+req.body.orders||0, pieces:+req.body.pieces||0,
    revenue:+req.body.revenue||0, adSpend:+req.body.adSpend||0,
    boxleoCost:+req.body.boxleoCost||0
  };
  if (!r.start||!r.end||!r.country||!r.productId) return res.status(400).json({ error:'Missing fields' });
  db.remittances.push(r); saveDB(db); res.json({ ok:true, remittance:r });
});
app.delete('/api/remittances/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.remittances = (db.remittances||[]).filter(r=>r.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* ---------------- finance ---------------- */
app.get('/api/finance/categories', requireAuth, (req,res)=>{
  const db = loadDB(); res.json(db.finance?.categories||{debit:[],credit:[]});
});
app.post('/api/finance/categories', requireAuth, (req,res)=>{
  const db = loadDB(); db.finance = db.finance||{ categories:{debit:[],credit:[]}, entries:[] };
  const { type, name } = req.body||{};
  if (!type||!name) return res.status(400).json({ error:'Missing type/name' });
  if (!Array.isArray(db.finance.categories[type])) db.finance.categories[type]=[];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db); res.json({ ok:true, categories: db.finance.categories });
});
app.delete('/api/finance/categories', requireAuth, (req,res)=>{
  const db = loadDB();
  const { type, name } = req.query||{};
  if (!type||!name) return res.status(400).json({ error:'Missing type/name' });
  if (db.finance?.categories?.[type]) db.finance.categories[type] = db.finance.categories[type].filter(c=>c!==name);
  saveDB(db); res.json({ ok:true, categories: db.finance.categories });
});
app.get('/api/finance/entries', requireAuth, (req,res)=>{
  const db = loadDB(); let list = db.finance?.entries||[];
  const { start, end, category, type } = req.query||{};
  if (start) list = list.filter(e=>e.date>=start);
  if (end)   list = list.filter(e=>e.date<=end);
  if (category) list = list.filter(e=>e.category===category);
  if (type) list = list.filter(e=>e.type===type);
  
  const total = list.reduce((sum, e) => sum + (e.type === 'credit' ? +e.amount : -(+e.amount)), 0);
  
  res.json({ 
    entries: list, 
    running: runningBalance(db), 
    balance: list.reduce((a,e)=>a+(e.type==='credit'?+e.amount||0:-(+e.amount||0)),0),
    categoryTotal: total
  });
});
app.post('/api/finance/entries', requireAuth, (req,res)=>{
  const db = loadDB(); db.finance = db.finance||{ categories:{debit:[],credit:[]}, entries:[] };
  const { date, type, category, amount, note } = req.body||{};
  if (!date||!type||!category) return res.status(400).json({ error:'Missing fields' });
  
  const entry = { 
    id: uuidv4(), 
    date, 
    type, 
    category, 
    amount: +amount||0, 
    note: note||''
  };
  
  db.finance.entries.push(entry);
  saveDB(db); 
  res.json({ ok:true, entry });
});
app.delete('/api/finance/entries/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.finance.entries = (db.finance.entries||[]).filter(e=>e.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* ---------------- influencers ---------------- */
app.get('/api/influencers', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ influencers: db.influencers||[] });
});
app.post('/api/influencers', requireAuth, (req,res)=>{
  const db = loadDB(); db.influencers = db.influencers||[];
  const { name, social, country } = req.body||{};
  if (!name) return res.status(400).json({ error:'Missing name' });
  const inf = { id: uuidv4(), name, social: social||'', country: country||'' };
  db.influencers.push(inf); saveDB(db); res.json({ ok:true, influencer: inf });
});
app.delete('/api/influencers/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.influencers = (db.influencers||[]).filter(i=>i.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});
app.get('/api/influencers/spend', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ spends: db.influencerSpends||[] });
});
app.post('/api/influencers/spend', requireAuth, (req,res)=>{
  const db = loadDB(); db.influencerSpends = db.influencerSpends||[];
  const { date, influencerId, country, productId, amount } = req.body||{};
  if (!influencerId) return res.status(400).json({ error:'Missing influencerId' });
  const sp = { id: uuidv4(), date: date||new Date().toISOString().slice(0,10), influencerId, country: country||'', productId: productId||'', amount:+amount||0 };
  db.influencerSpends.push(sp); saveDB(db); res.json({ ok:true, spend: sp });
});
app.delete('/api/influencers/spend/:id', requireAuth, (req,res)=>{
  const db = loadDB(); db.influencerSpends = (db.influencerSpends||[]).filter(s=>s.id!==req.params.id);
  saveDB(db); res.json({ ok:true });
});

/* ---------------- snapshots ---------------- */
app.get('/api/snapshots', requireAuth, (req,res)=>{
  const db = loadDB(); res.json({ snapshots: db.snapshots||[] });
});
app.post('/api/snapshots', requireAuth, async (req,res)=>{
  ensureSnapDir();
  const name = (req.body?.name||'Manual '+new Date().toLocaleString()).trim();
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const file = path.join(SNAPSHOT_DIR, `${stamp}-${name.replace(/\s+/g,'_')}.json`);
  await fs.copy(DATA_FILE, file);
  const db = loadDB(); db.snapshots = db.snapshots||[];
  const entry = { id: uuidv4(), name, file, createdAt: new Date().toISOString(), kind:'manual' };
  db.snapshots.push(entry);
  db.snapshots.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  saveDB(db);
  res.json({ ok:true, snapshot: entry, file });
});
app.post('/api/snapshots/restore', requireAuth, async (req,res)=>{
  const { file } = req.body||{};
  if (!file) return res.status(400).json({ error:'Missing file' });
  const safe = path.join(SNAPSHOT_DIR, path.basename(file));
  if (!fs.existsSync(safe)) return res.status(404).json({ error:'Snapshot not found' });
  await fs.copy(safe, DATA_FILE);
  res.json({ ok:true, restoredFrom: safe });
});
app.delete('/api/snapshots/:id', requireAuth, async (req,res)=>{
  const db = loadDB();
  const snap = (db.snapshots||[]).find(s=>s.id===req.params.id);
  if (snap?.file && fs.existsSync(snap.file)) { try { await fs.remove(snap.file); } catch{} }
  db.snapshots = (db.snapshots||[]).filter(s=>s.id!==req.params.id);
  saveDB(db);
  res.json({ ok:true });
});

/* ---------------- pages ---------------- */
app.get('/product.html', (req,res)=> res.sendFile(path.join(ROOT,'product.html')));
app.get('/', (req,res)=> res.sendFile(path.join(ROOT,'index.html')));

/* ---------------- start ---------------- */
app.listen(PORT, ()=> {
  console.log('✅ EAS Tracker Enhanced Version listening on', PORT);
  console.log('DB:', DATA_FILE);
});
