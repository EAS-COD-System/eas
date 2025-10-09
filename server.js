import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'eastafricashop';
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true';

app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

const files = {
meta: 'meta.json',
countries: 'countries.json',
products: 'products.json',
deliveries: 'deliveries.json',
adSpends: 'ad_spends.json',
movements: 'movements.json',
shipments: 'shipments.json',
remittances: 'remittances.json',
financeCategories: 'finance_categories.json',
financeEntries: 'finance_entries.json',
influencers: 'influencers.json',
influencersSpend: 'influencers_spend.json',
allowlist: 'allowlist.json'
};

const readJSON = (name, fallback) => {
const p = path.join(DATA_DIR, name);
if (!fs.existsSync(p)) return fallback;
try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
catch { return fallback; }
};
const writeJSON = (name, data) => fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));

(function init() {
if (!fs.existsSync(path.join(DATA_DIR, files.meta))) {
writeJSON(files.meta, { currency: 'USD', theme: { primary: '#0E9F6E', bg: '#fff' }, createdAt: new Date().toISOString() });
}
if (!fs.existsSync(path.join(DATA_DIR, files.allowlist))) writeJSON(files.allowlist, { ips: [] });
const defs = [
[files.countries, ["china","kenya","tanzania","uganda","zambia","zimbabwe"]],
[files.products, []],
[files.deliveries, []],
[files.adSpends, []],
[files.movements, []],
[files.shipments, []],
[files.remittances, []],
[files.financeCategories, { debits: ["Facebook Ads","TikTok Ads","Google Ads","Shipping","Salaries"], credits: ["Revenue Boxleo","Other Revenue"] }],
[files.financeEntries, []],
[files.influencers, []],
[files.influencersSpend, []],
];
for (const [f, v] of defs) {
const p = path.join(DATA_DIR, f);
if (!fs.existsSync(p)) writeJSON(f, v);
}
})();

const ipOf = (req) =>
(req.headers['x-forwarded-for']?.split(',')[0]?.trim()) ||
req.headers['x-real-ip'] ||
req.ip;

function authGuard(req, res, next) {
if (AUTH_DISABLED) return next();
if (req.cookies?.eas_auth === '1') return next();
const ip = ipOf(req);
const allow = readJSON(files.allowlist, { ips: [] });
if (allow.ips.includes(ip)) return next();
return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

// ---------- Auth ----------
app.post('/api/auth', (req, res) => {
if (AUTH_DISABLED) return res.json({ ok: true, disabled: true });
const { password } = req.body || {};
const ip = ipOf(req);
if (password === ADMIN_PASSWORD) {
const a = readJSON(files.allowlist, { ips: [] });
if (!a.ips.includes(ip)) { a.ips.push(ip); writeJSON(files.allowlist, a); }
const isProd = process.env.NODE_ENV === 'production';
res.cookie('eas_auth', '1', { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
return res.json({ ok: true, ip });
}
return res.status(401).json({ ok: false, error: 'Invalid password' });
});
app.post('/api/logout', (req, res) => {
const ip = ipOf(req);
const a = readJSON(files.allowlist, { ips: [] });
a.ips = a.ips.filter(x => x !== ip);
writeJSON(files.allowlist, a);
res.clearCookie('eas_auth');
res.json({ ok: true });
});

// ---------- Helpers ----------
const dayISO = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
const inRange = (d,s,e) => { const x = new Date(d).getTime(); if(s && x<new Date(s).getTime()) return false; if(e && x>new Date(e).getTime()) return false; return true; };
const sow = (date) => { const d = new Date(date); const day = (d.getDay()+6)%7; const m = new Date(d); m.setDate(d.getDate()-day); m.setHours(0,0,0,0); return m; };
const eow = (date) => { const m = sow(date); const s = new Date(m); s.setDate(m.getDate()+6); s.setHours(23,59,59,999); return s; };

// Snapshots every 10 minutes
setInterval(() => {
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const folder = path.join(SNAPSHOT_DIR, stamp + '_10m');
fs.mkdirSync(folder, { recursive: true });
for (const k of Object.values(files)) {
const src = path.join(DATA_DIR, k);
if (fs.existsSync(src)) fs.copyFileSync(src, path.join(folder, k));
}
}, 10 * 60 * 1000);

// Restore endpoint used by Settings
app.post('/api/restore', authGuard, (req, res) => {
const { window } = req.body || {};
const now = Date.now();
let ms = 0;
if (window === '10m') ms = 10*60*1000;
else if (window === '1h') ms = 60*60*1000;
else if (window === '24h') ms = 24*60*60*1000;
else if (window === '3d') ms = 3*24*60*60*1000;
else return res.status(400).json({ ok:false, error:'Invalid window' });

// find the latest snapshot within window
const entries = fs.readdirSync(SNAPSHOT_DIR, { withFileTypes: true })
.filter(e => e.isDirectory())
.map(e => ({ name:e.name, ts: new Date(e.name.split('_')[0].replace(/-/g,':').replace('T', 'T')).getTime() || 0 }))
.filter(x => now - x.ts <= ms)
.sort((a,b)=>b.ts-a.ts);

if (!entries.length) return res.status(404).json({ ok:false, error:'No snapshot in range' });

const pick = path.join(SNAPSHOT_DIR, entries[0].name);
for (const k of Object.values(files)) {
const src = path.join(pick, k);
if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DATA_DIR, k));
}
res.json({ ok:true, restoredFrom: entries[0].name });
});

// ---------- Meta ----------
app.get('/api/meta', authGuard, (req, res) =>
res.json({ meta: readJSON(files.meta, {}), countries: readJSON(files.countries, []), week: { start: sow(new Date()), end: eow(new Date()) } })
);

// ---------- Countries ----------
app.get('/api/countries', authGuard, (req, res) => res.json({ countries: readJSON(files.countries, []) }));
app.post('/api/countries', authGuard, (req, res) => {
const { name } = req.body || {};
if (!name) return res.status(400).json({ ok:false, error:'name required' });
const list = readJSON(files.countries, []);
const n = String(name).toLowerCase();
if (!list.includes(n)) list.push(n);
writeJSON(files.countries, list);
res.json({ ok:true, countries: list });
});

// ---------- Products ----------
app.get('/api/products', authGuard, (req,res)=> res.json({ products: readJSON(files.products, []) }));
app.post('/api/products', authGuard, (req,res)=>{
const p = readJSON(files.products, []);
const id = 'p_' + Math.random().toString(36).slice(2);
const { name, sku, cost_china, ship_china_to_kenya, margin_budget, status='active' } = req.body || {};
p.push({ id, name, sku, cost_china:+cost_china||0, ship_china_to_kenya:+ship_china_to_kenya||0, margin_budget:+margin_budget||0, status, createdAt:new Date().toISOString() });
writeJSON(files.products, p);
res.json({ ok:true, id });
});
app.post('/api/products/:id/status', authGuard, (req,res)=>{
const p = readJSON(files.products, []);
const i = p.findIndex(x=>x.id===req.params.id);
if (i<0) return res.status(404).json({ ok:false, error:'not found' });
p[i].status = req.body?.status || 'active';
p[i].updatedAt = new Date().toISOString();
writeJSON(files.products, p);
res.json({ ok:true });
});
app.delete('/api/products/:id', authGuard, (req,res)=>{
const p = readJSON(files.products, []).filter(x=>x.id!==req.params.id);
writeJSON(files.products, p);
res.json({ ok:true });
});

// ---------- Deliveries ----------
app.post('/api/deliveries', authGuard, (req,res)=>{
const list = readJSON(files.deliveries, []);
const { date, country, delivered } = req.body || {};
if (!date || !country) return res.status(400).json({ ok:false, error:'date & country required' });
list.push({ id:'d_'+Math.random().toString(36).slice(2), date: dayISO(date), country: country.toLowerCase(), delivered:+delivered||0 });
writeJSON(files.deliveries, list);
res.json({ ok:true });
});
app.get('/api/deliveries', authGuard, (req,res)=>{
const { start, end } = req.query;
let list = readJSON(files.deliveries, []);
if (start || end) list = list.filter(x=>inRange(x.date, start, end));
res.json({ deliveries: list });
});
app.get('/api/deliveries/current-week', authGuard, (req,res)=>{
const start = dayISO(sow(new Date()));
const end = dayISO(eow(new Date()));
const list = readJSON(files.deliveries, []).filter(x=>inRange(x.date, start, end));
const days = {};
// build 7-day map
for(let i=0;i<7;i++){
const d = new Date(start);
d.setDate(new Date(start).getDate()+i);
const k = dayISO(d);
days[k] = 0;
}
for (const r of list) if (days[r.date]!=null) days[r.date]+=r.delivered;
res.json({ start, end, days });
});

// ---------- Ad spend ----------
app.post('/api/adspend', authGuard, (req,res)=>{
const list = readJSON(files.adSpends, []);
const { date, platform, productId, country, amount } = req.body || {};
if (!date || !platform || !productId || !country) return res.status(400).json({ ok:false, error:'missing fields' });
const key = `${dayISO(date)}|${platform}|${productId}|${country.toLowerCase()}`;
const filtered = list.filter(x => `${x.date}|${x.platform}|${x.productId}|${x.country}` !== key);
filtered.push({ id:'a_'+Math.random().toString(36).slice(2), date: dayISO(date), platform, productId, country:country.toLowerCase(), amount:+amount||0 });
writeJSON(files.adSpends, filtered);
res.json({ ok:true });
});
app.get('/api/adspend', authGuard, (req,res)=>{
res.json({ adSpends: readJSON(files.adSpends, []) });
});

// ---------- Stock movement ----------
app.post('/api/stock/move', authGuard, (req,res)=>{
const list = readJSON(files.movements, []);
const { productId, fromCountry, toCountry, qty, shippingCost } = req.body || {};
if (!productId || !fromCountry || !toCountry) return res.status(400).json({ ok:false, error:'missing fields' });
const rec = { id:'m_'+Math.random().toString(36).slice(2), productId, from:fromCountry.toLowerCase(), to:toCountry.toLowerCase(), qty:+qty||0, shippingCost:+shippingCost||0, date: dayISO(new Date()) };
list.push(rec);
writeJSON(files.movements, list);
res.json({ ok:true, id: rec.id });
});
app.get('/api/stock/move', authGuard, (req,res)=>{
res.json({ movements: readJSON(files.movements, []) });
});

// ---------- Shipments ----------
app.post('/api/shipments', authGuard, (req,res)=>{
const list = readJSON(files.shipments, []);
const { productId, fromCountry, toCountry, qty, shipCost, departedAt } = req.body || {};
if (!productId || !fromCountry || !toCountry) return res.status(400).json({ ok:false, error:'missing fields' });
const rec = { id:'s_'+Math.random().toString(36).slice(2), productId, from:fromCountry.toLowerCase(), to:toCountry.toLowerCase(), qty:+qty||0, shipCost:+shipCost||0, departedAt: dayISO(departedAt||new Date()), arrivedAt:null, notes:'' };
list.push(rec);
writeJSON(files.shipments, list);
res.json({ ok:true, id: rec.id });
});
app.get('/api/shipments', authGuard, (req,res)=>{
const { type } = req.query;
let list = readJSON(files.shipments, []);
if (type === 'china-kenya') list = list.filter(x=>x.from==='china' && x.to==='kenya');
else if (type === 'intercountry') list = list.filter(x=>!(x.from==='china' && x.to==='kenya'));
res.json({ shipments: list });
});
app.put('/api/shipments/:id', authGuard, (req,res)=>{
const list = readJSON(files.shipments, []);
const i = list.findIndex(x=>x.id===req.params.id);
if (i<0) return res.status(404).json({ ok:false, error:'not found' });
const b = req.body || {};
if (b.arrivedAt) b.arrivedAt = dayISO(b.arrivedAt);
list[i] = { ...list[i], ...b };
writeJSON(files.shipments, list);
res.json({ ok:true });
});
app.delete('/api/shipments/:id', authGuard, (req,res)=>{
const list = readJSON(files.shipments, []).filter(x=>x.id!==req.params.id);
writeJSON(files.shipments, list);
res.json({ ok:true });
});

// ---------- Remittances ----------
app.post('/api/remittances', authGuard, (req,res)=>{
const list = readJSON(files.remittances, []);
const { start, end, country, productId, orders, pieces, revenue, adSpend, costPerDelivery=0 } = req.body || {};
if (!start || !end || !country || !productId) return res.status(400).json({ ok:false, error:'missing fields' });
const rec = { id:'r_'+Math.random().toString(36).slice(2), start:dayISO(start), end:dayISO(end), country:country.toLowerCase(), productId, orders:+orders||0, pieces:+pieces||0, revenue:+revenue||0, adSpend:+adSpend||0, costPerDelivery:+costPerDelivery||0 };
list.push(rec);
writeJSON(files.remittances, list);
res.json({ ok:true, id: rec.id });
});
app.get('/api/remittances', authGuard, (req,res)=>{
const { start, end, country, productId } = req.query;
let list = readJSON(files.remittances, []);
if (country) list = list.filter(x=>x.country===String(country).toLowerCase());
if (productId) list = list.filter(x=>x.productId===productId);
if (start) list = list.filter(x=>x.end >= start);
if (end) list = list.filter(x=>x.start <= end);
res.json({ remittances: list });
});

// ---------- Finance ----------
app.get('/api/finance/categories', authGuard, (req,res)=> res.json(readJSON(files.financeCategories, {debits:[],credits:[]})));
app.post('/api/finance/categories', authGuard, (req,res)=>{
const data = readJSON(files.financeCategories, {debits:[],credits:[]});
const { type, name } = req.body || {};
const key = type === 'debit' ? 'debits' : 'credits';
if (name && !data[key].includes(name)) data[key].push(name);
writeJSON(files.financeCategories, data);
res.json(data);
});
app.delete('/api/finance/categories', authGuard, (req,res)=>{
const data = readJSON(files.financeCategories, {debits:[],credits:[]});
const { type, name } = req.body || {};
const key = type === 'debit' ? 'debits' : 'credits';
data[key] = data[key].filter(x=>x!==name);
writeJSON(files.financeCategories, data);
res.json(data);
});
app.post('/api/finance/entries', authGuard, (req,res)=>{
const list = readJSON(files.financeEntries, []);
const { date, type, category, amount, note } = req.body || {};
if (!date || !['debit','credit'].includes(type) || !category) return res.status(400).json({ ok:false, error:'missing fields' });
list.push({ id:'fe_'+Math.random().toString(36).slice(2), date:dayISO(date), type, category, amount:+amount||0, note:note||'' });
writeJSON(files.financeEntries, list);
res.json({ ok:true });
});
app.get('/api/finance/entries', authGuard, (req,res)=>{
const { start, end, categories } = req.query;
let list = readJSON(files.financeEntries, []).filter(x=>inRange(x.date, start, end));
if (categories) {
const arr = categories.split(',').filter(Boolean);
if (arr.length) list = list.filter(x=>arr.includes(x.category));
}
const balance = list.reduce((acc,x)=> x.type==='credit' ? acc + (+x.amount||0) : acc - (+x.amount||0), 0);
res.json({ entries: list, balance });
});

// ---------- Performance ----------
app.get('/api/performance/top-delivered', authGuard, (req,res)=>{
const { start, end, country } = req.query;
const rem = readJSON(files.remittances, [])
.filter(x => (start||end) ? (inRange(x.start, start, end) || inRange(x.end, start, end)) : true)
.filter(x => country ? x.country === String(country).toLowerCase() : true);
const products = readJSON(files.products, []);
const moves = readJSON(files.movements, []);
const result = {};
for (const r of rem) {
if (!result[r.productId]) result[r.productId] = { pieces:0, adSpend:0, productCost:0, profit:0 };
result[r.productId].pieces += r.pieces;
result[r.productId].adSpend += r.adSpend;

const prod = products.find(p=>p.id===r.productId) || { cost_china:0, ship_china_to_kenya:0 };
const base = (+prod.cost_china||0) + (+prod.ship_china_to_kenya||0);

const movCost = moves
.filter(m => m.productId===r.productId && (!country || m.to===country.toLowerCase()))
.reduce((a,m)=>a+(+m.shippingCost||0), 0);

const perPiece = r.pieces ? movCost / r.pieces : 0;
result[r.productId].productCost += (base + perPiece) * r.pieces;

const profit = r.revenue - r.adSpend - ((base + perPiece) * r.pieces);
result[r.productId].profit += profit;
}
const out = Object.entries(result).map(([id,v])=>{
const prod = products.find(p=>p.id===id);
const ppp = v.pieces ? (v.profit / v.pieces) : 0;
return { productId:id, productName: prod?.name || id, pieces:v.pieces, adSpend:v.adSpend, productCost:v.productCost, profit:v.profit, profitPerPiece: ppp };
}).sort((a,b)=>b.pieces-a.pieces);
res.json({ items: out });
});

// ---------- Static ----------
app.use('/public', express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Start ----------
app.listen(PORT, () => console.log('EAS Tracker on ' + PORT));
