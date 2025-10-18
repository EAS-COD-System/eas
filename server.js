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

app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/public', express.static(path.join(ROOT, 'public')));

function ensureDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeJsonSync(DATA_FILE, {
      password: 'eastafricashop',
      countries: ['china', 'kenya', 'tanzania', 'uganda', 'zambia', 'zimbabwe'],
      products: [],
      productNotes: [],
      productSellingPrices: [],
      productOrders: [],
      brainstorming: [],
      testedProducts: [],
      adspend: [],
      deliveries: [],
      shipments: [],
      remittances: [],
      finance: { categories: { debit: [], credit: [] }, entries: [] },
      influencers: [],
      influencerSpends: [],
      snapshots: []
    }, { spaces: 2 });
  }
}

function loadDB() { ensureDB(); return fs.readJsonSync(DATA_FILE); }
function saveDB(db) { fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); }

function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') return next();
  return res.status(403).json({ error: 'Unauthorized' });
}

function calculateProductCosts(db, productId, country = null) {
  const shipments = db.shipments || [];
  let totalCost = 0;
  let totalPieces = 0;

  shipments.forEach(shipment => {
    if (shipment.productId === productId && shipment.arrivedAt) {
      if (!country || shipment.toCountry === country) {
        const pieces = +shipment.qty || 0;
        let cost = 0;
        
        if (shipment.fromCountry === 'china') {
          cost = (+shipment.chinaCost || 0) + (+shipment.shipCost || 0);
        } else {
          cost = +shipment.shipCost || 0;
        }
        
        totalCost += cost;
        totalPieces += pieces;
      }
    }
  });

  return {
    totalCost,
    totalPieces,
    costPerPiece: totalPieces > 0 ? totalCost / totalPieces : 0
  };
}

function calculateDeliveryRate(db, productId, country, startDate, endDate) {
  const orders = db.productOrders || [];
  const remittances = db.remittances || [];

  const periodOrders = orders.filter(o =>
    o.productId === productId &&
    o.country === country &&
    ((!startDate || o.date >= startDate) && (!endDate || o.date <= endDate))
  );

  const periodRemittances = remittances.filter(r =>
    r.productId === productId &&
    r.country === country &&
    ((!startDate || r.start >= startDate) && (!endDate || r.end <= endDate))
  );

  const totalOrders = periodOrders.reduce((sum, o) => sum + (+o.orders || 0), 0);
  const totalDelivered = periodRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);

  return totalOrders > 0 ? (totalDelivered / totalOrders) * 100 : 0;
}

function calculateProfitMetrics(db, productId, country, startDate, endDate) {
  const remittances = db.remittances || [];
  const sellingPrices = db.productSellingPrices || [];
  const adSpends = db.adspend || [];

  const periodRemittances = remittances.filter(r =>
    (!productId || r.productId === productId) &&
    (!country || r.country === country) &&
    ((!startDate || r.start >= startDate) && (!endDate || r.end <= endDate))
  );

  const periodAdSpends = adSpends.filter(a =>
    (!productId || a.productId === productId) &&
    (!country || a.country === country) &&
    ((!startDate || true) && (!endDate || true))
  );

  const sellingPrice = sellingPrices.find(sp =>
    sp.productId === productId && sp.country === country
  );

  const productCosts = calculateProductCosts(db, productId, country);
  const deliveryRate = calculateDeliveryRate(db, productId, country, startDate, endDate);

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalPieces = 0;
  let totalOrders = 0;

  periodRemittances.forEach(r => {
    totalRevenue += +r.revenue || 0;
    totalAdSpend += +r.adSpend || 0;
    totalBoxleoFees += +r.boxleoFees || 0;
    totalPieces += +r.pieces || 0;
    totalOrders += +r.orders || 0;
  });

  periodAdSpends.forEach(a => {
    totalAdSpend += +a.amount || 0;
  });

  const totalProductCost = productCosts.costPerPiece * totalPieces;
  const totalCost = totalProductCost + totalAdSpend + totalBoxleoFees;
  const profit = totalRevenue - totalCost;

  const costPerDeliveredOrder = totalOrders > 0 ? totalCost / totalOrders : 0;
  const costPerDeliveredPiece = totalPieces > 0 ? totalCost / totalPieces : 0;
  const costPerOrderAd = totalOrders > 0 ? totalAdSpend / totalOrders : 0;
  const costPerPieceAd = totalPieces > 0 ? totalAdSpend / totalPieces : 0;
  const boxleoPerOrder = totalOrders > 0 ? totalBoxleoFees / totalOrders : 0;
  const boxleoPerPiece = totalPieces > 0 ? totalBoxleoFees / totalPieces : 0;

  const availableForProfitAndAds = sellingPrice ? sellingPrice.price - productCosts.costPerPiece : 0;
  const maxCostPerLead = deliveryRate > 0 ? availableForProfitAndAds * (deliveryRate / 100) : 0;

  return {
    totalRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalProductCost,
    totalCost,
    profit,
    totalPieces,
    totalOrders,
    deliveryRate,
    costPerDeliveredOrder,
    costPerDeliveredPiece,
    costPerOrderAd,
    costPerPieceAd,
    boxleoPerOrder,
    boxleoPerPiece,
    availableForProfitAndAds,
    maxCostPerLead,
    isProfitable: profit > 0,
    hasData: totalPieces > 0
  };
}

app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();
  if (password === 'logout') {
    res.clearCookie('auth', { httpOnly: true, sameSite: 'Lax', secure: false, path: '/' });
    return res.json({ ok: true });
  }
  if (password && password === db.password) {
    res.cookie('auth', '1', { httpOnly: true, sameSite: 'Lax', secure: false, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
    return res.json({ ok: true });
  }
  return res.status(403).json({ error: 'Wrong password' });
});

app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

app.get('/api/countries', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ countries: db.countries || [] });
});

app.post('/api/countries', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const db = loadDB(); db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db); res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const n = req.params.name;
  const db = loadDB(); db.countries = (db.countries || []).filter(c => c !== n);
  saveDB(db); res.json({ ok: true, countries: db.countries });
});

app.get('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  const products = (db.products || []).map(product => {
    const metrics = calculateProfitMetrics(db, product.id, null, '2000-01-01', '2100-01-01');
    return {
      ...product,
      isProfitable: metrics.isProfitable,
      hasData: metrics.hasData
    };
  });
  res.json({ products });
});

app.post('/api/products', requireAuth, (req, res) => {
  const db = loadDB(); db.products = db.products || [];
  const p = {
    id: uuidv4(),
    status: 'active',
    name: req.body.name || '',
    sku: req.body.sku || ''
  };
  if (!p.name) return res.status(400).json({ error: 'Name required' });
  db.products.push(p); saveDB(db); res.json({ ok: true, product: p });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.name !== undefined) p.name = up.name;
  if (up.sku !== undefined) p.sku = up.sku;
  saveDB(db); res.json({ ok: true, product: p });
});

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const db = loadDB(); const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.status = req.body.status || 'active'; saveDB(db); res.json({ ok: true, product: p });
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const id = req.params.id;
  db.products = (db.products || []).filter(p => p.id !== id);
  db.productNotes = (db.productNotes || []).filter(n => n.productId !== id);
  db.productSellingPrices = (db.productSellingPrices || []).filter(sp => sp.productId !== id);
  db.productOrders = (db.productOrders || []).filter(o => o.productId !== id);
  db.adspend = (db.adspend || []).filter(a => a.productId !== id);
  db.shipments = (db.shipments || []).filter(s => s.productId !== id);
  db.remittances = (db.remittances || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(sp => sp.productId !== id);
  saveDB(db);
  res.json({ ok: true });
});

app.get('/api/products/:id/prices', requireAuth, (req, res) => {
  const db = loadDB();
  const prices = (db.productSellingPrices || []).filter(sp => sp.productId === req.params.id);
  res.json({ prices });
});

app.post('/api/products/:id/prices', requireAuth, (req, res) => {
  const db = loadDB(); db.productSellingPrices = db.productSellingPrices || [];
  const { country, price } = req.body || {};
  if (!country || !price) return res.status(400).json({ error: 'Missing country/price' });

  const existing = db.productSellingPrices.find(sp =>
    sp.productId === req.params.id && sp.country === country
  );

  if (existing) {
    existing.price = +price || 0;
  } else {
    db.productSellingPrices.push({
      id: uuidv4(),
      productId: req.params.id,
      country,
      price: +price || 0
    });
  }

  saveDB(db); res.json({ ok: true });
});

app.get('/api/products/:id/notes', requireAuth, (req, res) => {
  const db = loadDB();
  const notes = (db.productNotes || []).filter(n => n.productId === req.params.id);
  res.json({ notes });
});

app.post('/api/products/:id/notes', requireAuth, (req, res) => {
  const db = loadDB(); db.productNotes = db.productNotes || [];
  const { country, note } = req.body || {};
  if (!country || !note) return res.status(400).json({ error: 'Missing country/note' });

  const existing = db.productNotes.find(n =>
    n.productId === req.params.id && n.country === country
  );

  if (existing) {
    existing.note = note;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.productNotes.push({
      id: uuidv4(),
      productId: req.params.id,
      country,
      note,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveDB(db); res.json({ ok: true });
});

app.delete('/api/products/notes/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.productNotes = (db.productNotes || []).filter(n => n.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, start, end } = req.query || {};
  let orders = db.productOrders || [];

  if (productId) orders = orders.filter(o => o.productId === productId);
  if (country) orders = orders.filter(o => o.country === country);
  if (start) orders = orders.filter(o => o.date >= start);
  if (end) orders = orders.filter(o => o.date <= end);

  res.json({ orders });
});

app.post('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB(); db.productOrders = db.productOrders || [];
  const { productId, country, startDate, endDate, orders } = req.body || {};
  if (!productId || !country || !startDate || !endDate) return res.status(400).json({ error: 'Missing fields' });

  db.productOrders.push({
    id: uuidv4(),
    productId,
    country,
    startDate,
    endDate,
    orders: +orders || 0
  });

  saveDB(db); res.json({ ok: true });
});

app.get('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ ideas: db.brainstorming || [] });
});

app.post('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB(); db.brainstorming = db.brainstorming || [];
  const { title, description, category } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Missing title' });

  const idea = {
    id: uuidv4(),
    title,
    description: description || '',
    category: category || 'general',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.brainstorming.push(idea);
  saveDB(db); res.json({ ok: true, idea });
});

app.delete('/api/brainstorming/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.brainstorming = (db.brainstorming || []).filter(i => i.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/tested-products', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ testedProducts: db.testedProducts || [] });
});

app.post('/api/tested-products', requireAuth, (req, res) => {
  const db = loadDB(); db.testedProducts = db.testedProducts || [];
  const { productName, country, costPerLead, confirmationRate, sellingPrice } = req.body || {};
  if (!productName || !country) return res.status(400).json({ error: 'Missing product name/country' });

  let product = db.testedProducts.find(tp => tp.productName === productName);

  if (product) {
    const countryIndex = product.countryData.findIndex(cd => cd.country === country);
    if (countryIndex >= 0) {
      product.countryData[countryIndex] = {
        country,
        costPerLead: +costPerLead || 0,
        confirmationRate: +confirmationRate || 0,
        sellingPrice: +sellingPrice || 0,
        updatedAt: new Date().toISOString()
      };
    } else {
      product.countryData.push({
        country,
        costPerLead: +costPerLead || 0,
        confirmationRate: +confirmationRate || 0,
        sellingPrice: +sellingPrice || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    product.updatedAt = new Date().toISOString();
  } else {
    product = {
      id: uuidv4(),
      productName,
      countryData: [{
        country,
        costPerLead: +costPerLead || 0,
        confirmationRate: +confirmationRate || 0,
        sellingPrice: +sellingPrice || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.testedProducts.push(product);
  }

  saveDB(db); res.json({ ok: true, product });
});

app.delete('/api/tested-products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.testedProducts = (db.testedProducts || []).filter(tp => tp.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};

  const metrics = calculateProfitMetrics(db, productId, null, start, end);
  const shipments = (db.shipments || []).filter(s =>
    s.productId === productId &&
    (!start || s.departedAt >= start) &&
    (!end || s.departedAt <= end)
  );

  const influencerSpends = (db.influencerSpends || []).filter(is =>
    is.productId === productId &&
    (!start || is.date >= start) &&
    (!end || is.date <= end)
  );

  const totalInfluencerCost = influencerSpends.reduce((sum, is) => sum + (+is.amount || 0), 0);
  
  const chinaShipments = shipments.filter(s => s.fromCountry === 'china');
  const interShipments = shipments.filter(s => s.fromCountry !== 'china');
  
  const totalChinaCost = chinaShipments.reduce((sum, s) => sum + (+s.chinaCost || 0), 0);
  const totalChinaShipping = chinaShipments.reduce((sum, s) => sum + (+s.shipCost || 0), 0);
  const totalInterShipping = interShipments.reduce((sum, s) => sum + (+s.shipCost || 0), 0);

  const totalExpenses = totalChinaCost + totalChinaShipping + totalInterShipping + totalInfluencerCost + metrics.totalProductCost;
  const netProfit = metrics.totalRevenue - totalExpenses - metrics.totalAdSpend - metrics.totalBoxleoFees;

  res.json({
    ...metrics,
    totalInfluencerCost,
    totalChinaCost,
    totalChinaShipping,
    totalInterShipping,
    totalExpenses,
    netProfit,
    isNetProfitable: netProfit > 0
  });
});

app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ adSpends: db.adspend || [] });
});

app.post('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB(); db.adspend = db.adspend || [];
  const { productId, country, platform, amount } = req.body || {};
  if (!productId || !country || !platform) return res.status(400).json({ error: 'Missing fields' });
  const ex = db.adspend.find(a => a.productId === productId && a.country === country && a.platform === platform);
  if (ex) ex.amount = +amount || 0;
  else db.adspend.push({ id: uuidv4(), productId, country, platform, amount: +amount || 0 });
  saveDB(db); res.json({ ok: true });
});

app.get('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ deliveries: db.deliveries || [] });
});

app.post('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB(); db.deliveries = db.deliveries || [];
  const { date, country, delivered, productId } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0, productId: productId || '' });
  saveDB(db); res.json({ ok: true });
});

app.get('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB(); db.shipments = db.shipments || [];
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry,
    toCountry: req.body.toCountry,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    chinaCost: req.body.fromCountry === 'china' ? +req.body.chinaCost || 0 : 0,
    note: req.body.note || '',
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: req.body.arrivedAt || null
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error: 'Missing fields' });
  db.shipments.push(s); saveDB(db); res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.qty !== undefined) s.qty = +up.qty || 0;
  if (up.shipCost !== undefined) s.shipCost = +up.shipCost || 0;
  if (up.chinaCost !== undefined) s.chinaCost = +up.chinaCost || 0;
  if (up.note !== undefined) s.note = up.note;
  if (up.departedAt !== undefined) s.departedAt = up.departedAt;
  if (up.arrivedAt !== undefined) s.arrivedAt = up.arrivedAt;
  saveDB(db); res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.shipments = (db.shipments || []).filter(x => x.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); let list = db.remittances || [];
  const { start, end, country, productId } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);
  res.json({ remittances: list });
});

app.post('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); db.remittances = db.remittances || [];
  const r = {
    id: uuidv4(),
    start: req.body.start,
    end: req.body.end,
    country: req.body.country,
    productId: req.body.productId,
    orders: +req.body.orders || 0,
    pieces: +req.body.pieces || 0,
    revenue: +req.body.revenue || 0,
    adSpend: +req.body.adSpend || 0,
    boxleoFees: +req.body.boxleoFees || 0
  };
  if (!r.start || !r.end || !r.country || !r.productId) return res.status(400).json({ error: 'Missing fields' });
  db.remittances.push(r); saveDB(db); res.json({ ok: true, remittance: r });
});

app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB(); res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB(); db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (!Array.isArray(db.finance.categories[type])) db.finance.categories[type] = [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db); res.json({ ok: true, categories: db.finance.categories });
});

app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (db.finance?.categories?.[type]) db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
  saveDB(db); res.json({ ok: true, categories: db.finance.categories });
});

app.get('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB(); let list = db.finance?.entries || [];
  const { start, end, category, type } = req.query || {};
  if (start) list = list.filter(e => e.date >= start);
  if (end) list = list.filter(e => e.date <= end);
  if (category) list = list.filter(e => e.category === category);
  if (type) list = list.filter(e => e.type === type);

  const total = list.reduce((sum, e) => sum + (e.type === 'credit' ? +e.amount : -(+e.amount)), 0);
  const running = list.reduce((sum, e) => sum + (e.type === 'credit' ? +e.amount : -(+e.amount)), 0);

  res.json({
    entries: list,
    running: running,
    balance: list.reduce((a, e) => a + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)), 0),
    categoryTotal: total
  });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB(); db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  const { date, type, category, amount, note } = req.body || {};
  if (!date || !type || !category) return res.status(400).json({ error: 'Missing fields' });

  const entry = {
    id: uuidv4(),
    date,
    type,
    category,
    amount: +amount || 0,
    note: note || ''
  };

  db.finance.entries.push(entry);
  saveDB(db);
  res.json({ ok: true, entry });
});

app.delete('/api/finance/entries/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.finance.entries = (db.finance.entries || []).filter(e => e.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB(); db.influencers = db.influencers || [];
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const inf = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers.push(inf); saveDB(db); res.json({ ok: true, influencer: inf });
});

app.delete('/api/influencers/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB(); res.json({ spends: db.influencerSpends || [] });
});

app.post('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB(); db.influencerSpends = db.influencerSpends || [];
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId) return res.status(400).json({ error: 'Missing influencerId' });
  const sp = { id: uuidv4(), date: date || new Date().toISOString().slice(0, 10), influencerId, country: country || '', productId: productId || '', amount: +amount || 0 };
  db.influencerSpends.push(sp); saveDB(db); res.json({ ok: true, spend: sp });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

app.get('/api/analytics/remittance', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, productId } = req.query || {};

  let remittances = db.remittances || [];
  if (start) remittances = remittances.filter(r => r.start >= start);
  if (end) remittances = remittances.filter(r => r.end <= end);
  if (country) remittances = remittances.filter(r => r.country === country);
  if (productId) remittances = remittances.filter(r => r.productId === productId);

  const analytics = {};
  remittances.forEach(r => {
    const key = `${r.productId}|${r.country}`;
    if (!analytics[key]) {
      const metrics = calculateProfitMetrics(db, r.productId, r.country, start, end);
      analytics[key] = {
        productId: r.productId,
        country: r.country,
        ...metrics
      };
    }
  });

  res.json({ analytics: Object.values(analytics) });
});

app.get('/api/analytics/profit-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country } = req.query || {};

  const analytics = {};
  const countries = country ? [country] : (db.countries || []).filter(c => c !== 'china');

  countries.forEach(c => {
    const metrics = calculateProfitMetrics(db, null, c, start, end);
    if (metrics.totalPieces > 0) {
      analytics[c] = metrics;
    }
  });

  res.json({ analytics });
});

app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log('✅ EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
});
