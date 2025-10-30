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
const PERSIST_DIR = process.env.RENDER ? '/data' : path.join(ROOT, 'data');
const DATA_FILE = path.join(PERSIST_DIR, 'db.json');
const SNAPSHOT_DIR = path.join(PERSIST_DIR, 'snapshots');

// Ensure directories exist
fs.ensureDirSync(PERSIST_DIR);
fs.ensureDirSync(SNAPSHOT_DIR);

app.use(morgan('dev'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(ROOT));
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
      refunds: [],
      finance: {
        categories: {
          debit: [],
          credit: []
        },
        entries: []
      },
      influencers: [],
      influencerSpends: [],
      snapshots: [],
      todos: [],
      weeklyTodos: {}
    }, { spaces: 2 });
  }
}

function loadDB() { 
  ensureDB(); 
  return fs.readJsonSync(DATA_FILE); 
}

function saveDB(db) { 
  fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); 
}

function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') return next();
  return res.status(403).json({ error: 'Unauthorized' });
}

// ENHANCED SHIPPING COST CALCULATION - FIXED LOGIC
function calculateShippingCostPerPiece(db, productId, targetCountry) {
  const shipments = db.shipments || [];
  const productShipments = shipments.filter(s => 
    s.productId === productId && 
    s.arrivedAt
  );

  let shippingCostPerPiece = 0;
  let foundPath = false;

  function traceShipmentCost(currentCountry, accumulatedCost = 0, visited = new Set()) {
    if (visited.has(currentCountry)) return;
    visited.add(currentCountry);

    const incomingShipments = productShipments.filter(s => s.toCountry === currentCountry);
    
    for (const shipment of incomingShipments) {
      const pieces = +shipment.qty || 0;
      const shipCost = +shipment.shipCost || 0;
      const costPerPiece = pieces > 0 ? shipCost / pieces : 0;
      const newAccumulatedCost = accumulatedCost + costPerPiece;
      
      if (currentCountry === targetCountry) {
        shippingCostPerPiece = newAccumulatedCost;
        foundPath = true;
        return;
      } else {
        traceShipmentCost(shipment.fromCountry, newAccumulatedCost, new Set(visited));
        if (foundPath) return;
      }
    }
  }

  traceShipmentCost(targetCountry, 0);
  return shippingCostPerPiece;
}

function calculateProductCostPerPiece(db, productId) {
  const shipments = db.shipments || [];
  const chinaShipments = shipments.filter(s => 
    s.productId === productId && 
    s.fromCountry === 'china' && 
    s.arrivedAt
  );

  if (chinaShipments.length === 0) return 0;

  let totalProductCost = 0;
  let totalPieces = 0;

  chinaShipments.forEach(shipment => {
    const pieces = +shipment.qty || 0;
    const chinaCost = +shipment.chinaCost || 0;
    
    if (pieces > 0) {
      totalProductCost += chinaCost;
      totalPieces += pieces;
    }
  });

  return totalPieces > 0 ? totalProductCost / totalPieces : 0;
}

// ENHANCED PROFIT CALCULATION WITH PERIOD-BASED COSTS
function calculateProfitMetrics(db, productId, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  const influencerSpends = db.influencerSpends || [];
  const adspend = db.adspend || [];
  const shipments = db.shipments || [];

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;
  let totalRefundedOrders = 0;
  let totalRefundedAmount = 0;
  let totalInfluencerSpend = 0;

  // Calculate from remittances
  remittances.forEach(remittance => {
    if ((!productId || remittance.productId === productId) &&
        (!country || remittance.country === country) &&
        (!startDate || remittance.start >= startDate) &&
        (!endDate || remittance.end <= endDate)) {
      totalRevenue += +remittance.revenue || 0;
      totalAdSpend += +remittance.adSpend || 0;
      totalBoxleoFees += +remittance.boxleoFees || 0;
      totalDeliveredPieces += +remittance.pieces || 0;
      totalDeliveredOrders += +remittance.orders || 0;
    }
  });

  // Calculate refunds
  refunds.forEach(refund => {
    if ((!productId || refund.productId === productId) &&
        (!country || refund.country === country) &&
        (!startDate || refund.date >= startDate) &&
        (!endDate || refund.date <= endDate)) {
      totalRefundedOrders += +refund.orders || 0;
      totalRefundedAmount += +refund.amount || 0;
    }
  });

  // Calculate influencer spend
  influencerSpends.forEach(spend => {
    if ((!productId || spend.productId === productId) &&
        (!country || spend.country === country) &&
        (!startDate || spend.date >= startDate) &&
        (!endDate || spend.date <= endDate)) {
      totalInfluencerSpend += +spend.amount || 0;
    }
  });

  // Calculate ad spend from adspend table
  adspend.forEach(ad => {
    if ((!productId || ad.productId === productId) &&
        (!country || ad.country === country) &&
        (!startDate || ad.date >= startDate) &&
        (!endDate || ad.date <= endDate)) {
      totalAdSpend += +ad.amount || 0;
    }
  });

  // ENHANCED COST CALCULATION - PERIOD BASED
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  if (productId) {
    // Filter shipments by period and product
    const shipmentsInPeriod = shipments.filter(s => 
      s.productId === productId && 
      s.arrivedAt &&
      (!startDate || s.arrivedAt >= startDate) &&
      (!endDate || s.arrivedAt <= endDate)
    );
    
    // Calculate total product cost from China shipments in period
    shipmentsInPeriod
      .filter(s => s.fromCountry === 'china')
      .forEach(shipment => {
        totalProductChinaCost += +shipment.chinaCost || 0;
      });

    // Calculate total shipping cost for all shipments in period
    shipmentsInPeriod.forEach(shipment => {
      totalShippingCost += +shipment.shipCost || 0;
    });
  } else {
    // For "All Products" - aggregate all product costs
    const products = db.products || [];
    products.forEach(product => {
      const productShipmentsInPeriod = shipments.filter(s => 
        s.productId === product.id && 
        s.arrivedAt &&
        (!startDate || s.arrivedAt >= startDate) &&
        (!endDate || s.arrivedAt <= endDate)
      );
      
      productShipmentsInPeriod
        .filter(s => s.fromCountry === 'china')
        .forEach(shipment => {
          totalProductChinaCost += +shipment.chinaCost || 0;
        });

      productShipmentsInPeriod.forEach(shipment => {
        totalShippingCost += +shipment.shipCost || 0;
      });
    });
  }

  const adjustedRevenue = totalRevenue - totalRefundedAmount;
  const totalCost = totalProductChinaCost + totalShippingCost + totalAdSpend + totalBoxleoFees + totalInfluencerSpend;
  const profit = adjustedRevenue - totalCost;

  // Calculate delivery rate
  const productOrders = db.productOrders || [];
  let totalOrders = 0;

  productOrders.forEach(order => {
    if ((!productId || order.productId === productId) &&
        (!country || order.country === country) &&
        (!startDate || order.startDate >= startDate) &&
        (!endDate || order.endDate <= endDate)) {
      totalOrders += (+order.orders || 0);
    }
  });

  const netDeliveredOrders = totalDeliveredOrders - totalRefundedOrders;
  const deliveryRate = totalOrders > 0 ? (netDeliveredOrders / totalOrders) * 100 : 0;

  // Enhanced metrics
  const costPerDeliveredOrder = netDeliveredOrders > 0 ? totalCost / netDeliveredOrders : 0;
  const costPerDeliveredPiece = totalDeliveredPieces > 0 ? totalCost / totalDeliveredPieces : 0;
  const adCostPerDeliveredOrder = netDeliveredOrders > 0 ? totalAdSpend / netDeliveredOrders : 0;
  const adCostPerDeliveredPiece = totalDeliveredPieces > 0 ? totalAdSpend / totalDeliveredPieces : 0;
  const boxleoPerDeliveredOrder = netDeliveredOrders > 0 ? totalBoxleoFees / netDeliveredOrders : 0;
  const boxleoPerDeliveredPiece = totalDeliveredPieces > 0 ? totalBoxleoFees / totalDeliveredPieces : 0;
  const influencerPerDeliveredOrder = netDeliveredOrders > 0 ? totalInfluencerSpend / netDeliveredOrders : 0;
  const averageOrderValue = netDeliveredOrders > 0 ? adjustedRevenue / netDeliveredOrders : 0;
  const profitPerOrder = netDeliveredOrders > 0 ? profit / netDeliveredOrders : 0;
  const profitPerPiece = totalDeliveredPieces > 0 ? profit / totalDeliveredPieces : 0;

  const hasData = totalDeliveredPieces > 0 || adjustedRevenue > 0 || totalAdSpend > 0;

  return {
    totalRevenue: adjustedRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalProductChinaCost,
    totalShippingCost,
    totalInfluencerSpend,
    totalRefundedAmount,
    totalRefundedOrders,
    totalCost,
    profit,
    totalDeliveredPieces,
    totalDeliveredOrders: netDeliveredOrders,
    totalOrders,
    deliveryRate,
    costPerDeliveredOrder,
    costPerDeliveredPiece,
    adCostPerDeliveredOrder,
    adCostPerDeliveredPiece,
    boxleoPerDeliveredOrder,
    boxleoPerDeliveredPiece,
    influencerPerDeliveredOrder,
    averageOrderValue,
    profitPerOrder,
    profitPerPiece,
    isProfitable: profit > 0,
    hasData
  };
}

// Routes

// Authentication - FIXED
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();
  
  if (password === 'logout') {
    res.clearCookie('auth', { httpOnly: true, sameSite: 'Lax', secure: false, path: '/' });
    return res.json({ ok: true });
  }
  
  if (password && password === db.password) {
    res.cookie('auth', '1', { 
      httpOnly: true, 
      sameSite: 'Lax', 
      secure: false, 
      path: '/', 
      maxAge: 365 * 24 * 60 * 60 * 1000 
    });
    return res.json({ ok: true });
  }
  
  return res.status(403).json({ error: 'Wrong password' });
});

// Meta data
app.get('/api/meta', (req, res) => {
  const db = loadDB();
  res.json({ 
    countries: db.countries || [],
    requiresAuth: req.cookies.auth !== '1'
  });
});

// Countries
app.get('/api/countries', requireAuth, (req, res) => {
  const db = loadDB(); 
  res.json({ countries: db.countries || [] });
});

app.post('/api/countries', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const db = loadDB(); 
  db.countries = db.countries || [];
  if (!db.countries.includes(name)) db.countries.push(name);
  saveDB(db); 
  res.json({ ok: true, countries: db.countries });
});

app.delete('/api/countries/:name', requireAuth, (req, res) => {
  const n = req.params.name;
  const db = loadDB(); 
  db.countries = (db.countries || []).filter(c => c !== n);
  saveDB(db); 
  res.json({ ok: true, countries: db.countries });
});

// Products
app.get('/api/products', requireAuth, (req, res) => { 
  const db = loadDB();
  
  let products = (db.products || []).map(product => {
    const metrics = calculateProfitMetrics(db, product.id, null, '2000-01-01', '2100-01-01');
    const stock = calculateProductStock(db, product.id);
    const totalStock = Object.values(stock).reduce((sum, qty) => sum + qty, 0);
    
    // Calculate ad spend per country
    const adSpendByCountry = {};
    (db.adspend || []).filter(ad => ad.productId === product.id).forEach(ad => {
      adSpendByCountry[ad.country] = (adSpendByCountry[ad.country] || 0) + (+ad.amount || 0);
    });

    return {
      ...product,
      isProfitable: metrics.isProfitable,
      hasData: metrics.hasData,
      stockByCountry: stock,
      totalStock: totalStock,
      adSpendByCountry: adSpendByCountry
    };
  });

  res.json({ products });
});

app.post('/api/products', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.products = db.products || [];
  const p = {
    id: uuidv4(),
    status: 'active',
    name: req.body.name || '',
    sku: req.body.sku || '',
    createdAt: new Date().toISOString()
  };
  if (!p.name) return res.status(400).json({ error: 'Name required' });
  db.products.push(p); 
  saveDB(db); 
  res.json({ ok: true, product: p });
});

app.put('/api/products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.name !== undefined) p.name = up.name;
  if (up.sku !== undefined) p.sku = up.sku;
  saveDB(db); 
  res.json({ ok: true, product: p });
});

app.post('/api/products/:id/status', requireAuth, (req, res) => {
  const db = loadDB(); 
  const p = (db.products || []).find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  
  p.status = req.body.status || 'active'; 
  saveDB(db); 
  res.json({ ok: true, product: p });
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
  db.refunds = (db.refunds || []).filter(rf => rf.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(sp => sp.productId !== id);
  saveDB(db);
  res.json({ ok: true });
});

// Product Prices
app.get('/api/products/:id/prices', requireAuth, (req, res) => {
  const db = loadDB();
  const prices = (db.productSellingPrices || []).filter(sp => sp.productId === req.params.id);
  res.json({ prices });
});

app.post('/api/products/:id/prices', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.productSellingPrices = db.productSellingPrices || [];
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

  saveDB(db); 
  res.json({ ok: true });
});

// Product Orders
app.get('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB();
  let orders = db.productOrders || [];
  
  // Apply filters
  const { productId, country, start, end } = req.query || {};
  if (productId) orders = orders.filter(o => o.productId === productId);
  if (country) orders = orders.filter(o => o.country === country);
  if (start) orders = orders.filter(o => o.startDate >= start);
  if (end) orders = orders.filter(o => o.endDate <= end);

  orders.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  res.json({ orders });
});

app.post('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.productOrders = db.productOrders || [];
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

  saveDB(db); 
  res.json({ ok: true });
});

// Ad Spend 
app.get('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ adSpends: db.adspend || [] });
});

app.post('/api/adspend', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.adspend = db.adspend || [];
  const { id, productId, country, platform, amount, date } = req.body || {};
  
  if (!productId || !country || !platform || !date) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  
  // If ID is provided, update existing entry
  if (id) {
    const existing = db.adspend.find(a => a.id === id);
    if (existing) {
      existing.amount = +amount || 0;
      saveDB(db);
      return res.json({ ok: true });
    }
  }
  
  // Check for existing entry for update
  const ex = db.adspend.find(a => 
    a.productId === productId && 
    a.country === country && 
    a.platform === platform &&
    a.date === date
  );
  
  if (ex) {
    ex.amount = +amount || 0;
  } else {
    db.adspend.push({ 
      id: id || uuidv4(), 
      productId, 
      country, 
      platform, 
      amount: +amount || 0,
      date: date
    });
  }
  
  saveDB(db); 
  res.json({ ok: true });
});

// Deliveries
app.get('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB(); 
  res.json({ deliveries: db.deliveries || [] });
});

app.post('/api/deliveries', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.deliveries = db.deliveries || [];
  const { date, country, delivered, productId } = req.body || {};
  if (!date || !country) return res.status(400).json({ error: 'Missing date/country' });
  db.deliveries.push({ 
    id: uuidv4(), 
    date, 
    country, 
    delivered: +delivered || 0, 
    productId: productId || '' 
  });
  saveDB(db); 
  res.json({ ok: true });
});

// Shipments
app.get('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB(); 
  res.json({ shipments: db.shipments || [] });
});

app.post('/api/shipments', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.shipments = db.shipments || [];
  const s = {
    id: uuidv4(),
    productId: req.body.productId,
    fromCountry: req.body.fromCountry,
    toCountry: req.body.toCountry,
    qty: +req.body.qty || 0,
    shipCost: +req.body.shipCost || 0,
    finalShipCost: null,
    chinaCost: req.body.fromCountry === 'china' ? +req.body.chinaCost || 0 : 0,
    note: req.body.note || '',
    departedAt: req.body.departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: req.body.arrivedAt || null,
    paymentStatus: 'pending',
    paidAt: null
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error: 'Missing fields' });
  db.shipments.push(s); 
  saveDB(db); 
  res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  if (up.qty !== undefined) s.qty = +up.qty || 0;
  if (up.shipCost !== undefined) s.shipCost = +up.shipCost || 0;
  if (up.finalShipCost !== undefined) s.finalShipCost = +up.finalShipCost || 0;
  if (up.chinaCost !== undefined) s.chinaCost = +up.chinaCost || 0;
  if (up.note !== undefined) s.note = up.note;
  if (up.departedAt !== undefined) s.departedAt = up.departedAt;
  if (up.arrivedAt !== undefined) s.arrivedAt = up.arrivedAt;
  saveDB(db); 
  res.json({ ok: true, shipment: s });
});

app.post('/api/shipments/:id/mark-paid', requireAuth, (req, res) => {
  const db = loadDB(); 
  const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  
  const { finalShipCost } = req.body || {};
  if (!finalShipCost) return res.status(400).json({ error: 'Final shipping cost required' });
  
  s.finalShipCost = +finalShipCost || 0;
  s.paymentStatus = 'paid';
  s.paidAt = new Date().toISOString();
  
  saveDB(db); 
  res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.shipments = (db.shipments || []).filter(x => x.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Remittances
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); 
  let list = db.remittances || [];
  const { start, end, country, productId } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);

  list.sort((a, b) => new Date(b.start) - new Date(a.start));

  res.json({ remittances: list });
});

app.post('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.remittances = db.remittances || [];
  const { start, end, country, productId, orders, pieces, revenue, adSpend, boxleoFees } = req.body || {};
  
  if (!start || !end || !country || !productId) return res.status(400).json({ error: 'Missing required fields' });

  const r = {
    id: uuidv4(),
    start,
    end,
    country,
    productId,
    orders: +orders || 0,
    pieces: +pieces || 0,
    revenue: +revenue || 0,
    adSpend: +adSpend || 0,
    boxleoFees: +boxleoFees || 0
  };

  db.remittances.push(r); 
  saveDB(db); 
  res.json({ ok: true, remittance: r });
});

// Refunds
app.get('/api/refunds', requireAuth, (req, res) => {
  const db = loadDB(); 
  let list = db.refunds || [];
  const { start, end, country, productId } = req.query || {};
  if (start) list = list.filter(r => r.date >= start);
  if (end) list = list.filter(r => r.date <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);

  list.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ refunds: list });
});

app.post('/api/refunds', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.refunds = db.refunds || [];
  const { date, country, productId, orders, pieces, amount, reason } = req.body || {};
  
  if (!date || !country || !productId) return res.status(400).json({ error: 'Missing required fields' });

  const refund = {
    id: uuidv4(),
    date,
    country,
    productId,
    orders: +orders || 0,
    pieces: +pieces || 0,
    amount: +amount || 0,
    reason: reason || '',
    createdAt: new Date().toISOString()
  };

  db.refunds.push(refund); 
  saveDB(db); 
  res.json({ ok: true, refund });
});

// Brainstorming
app.get('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ ideas: db.brainstorming || [] });
});

app.post('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB();
  db.brainstorming = db.brainstorming || [];
  const { title, description, category } = req.body || {};
  
  if (!title) return res.status(400).json({ error: 'Title required' });

  const idea = {
    id: uuidv4(),
    title,
    description: description || '',
    category: category || 'general',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.brainstorming.push(idea);
  saveDB(db);
  res.json({ ok: true, idea });
});

app.delete('/api/brainstorming/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.brainstorming = (db.brainstorming || []).filter(i => i.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Tested Products
app.get('/api/tested-products', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ testedProducts: db.testedProducts || [] });
});

app.post('/api/tested-products', requireAuth, (req, res) => {
  const db = loadDB();
  db.testedProducts = db.testedProducts || [];
  const { productName, country, costPerLead, confirmationRate, sellingPrice } = req.body || {};
  
  if (!productName || !country) return res.status(400).json({ error: 'Product name and country required' });

  // Check if product already exists
  let product = db.testedProducts.find(p => p.productName === productName);
  
  if (product) {
    // Add country data to existing product
    product.countryData.push({
      country,
      costPerLead: +costPerLead || 0,
      confirmationRate: +confirmationRate || 0,
      sellingPrice: +sellingPrice || 0,
      testedAt: new Date().toISOString()
    });
  } else {
    // Create new product
    product = {
      id: uuidv4(),
      productName,
      countryData: [{
        country,
        costPerLead: +costPerLead || 0,
        confirmationRate: +confirmationRate || 0,
        sellingPrice: +sellingPrice || 0,
        testedAt: new Date().toISOString()
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.testedProducts.push(product);
  }

  saveDB(db);
  res.json({ ok: true, product });
});

app.delete('/api/tested-products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.testedProducts = (db.testedProducts || []).filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Todos
app.get('/api/todos', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ todos: db.todos || [] });
});

app.post('/api/todos', requireAuth, (req, res) => {
  const db = loadDB();
  db.todos = db.todos || [];
  const { text, done } = req.body || {};
  
  if (!text) return res.status(400).json({ error: 'Text required' });

  const todo = {
    id: uuidv4(),
    text,
    done: done || false,
    createdAt: new Date().toISOString()
  };

  db.todos.push(todo);
  saveDB(db);
  res.json({ ok: true, todo });
});

app.post('/api/todos/:id/toggle', requireAuth, (req, res) => {
  const db = loadDB();
  const todo = (db.todos || []).find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'Not found' });
  
  todo.done = !todo.done;
  saveDB(db);
  res.json({ ok: true, todo });
});

app.delete('/api/todos/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.todos = (db.todos || []).filter(t => t.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Weekly Todos
app.get('/api/weekly-todos', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ weeklyTodos: db.weeklyTodos || {} });
});

app.post('/api/weekly-todos', requireAuth, (req, res) => {
  const db = loadDB();
  db.weeklyTodos = db.weeklyTodos || {};
  const { day, text } = req.body || {};
  
  if (!day || !text) return res.status(400).json({ error: 'Day and text required' });

  if (!db.weeklyTodos[day]) {
    db.weeklyTodos[day] = [];
  }

  const todo = {
    id: uuidv4(),
    text,
    done: false,
    createdAt: new Date().toISOString()
  };

  db.weeklyTodos[day].push(todo);
  saveDB(db);
  res.json({ ok: true, todo });
});

app.put('/api/weekly-todos/:day/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const { day, id } = req.params;
  
  if (!db.weeklyTodos[day]) return res.status(404).json({ error: 'Day not found' });
  
  const todo = db.weeklyTodos[day].find(t => t.id === id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  
  todo.done = !todo.done;
  saveDB(db);
  res.json({ ok: true, todo });
});

app.delete('/api/weekly-todos/:day/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const { day, id } = req.params;
  
  if (!db.weeklyTodos[day]) return res.status(404).json({ error: 'Day not found' });
  
  db.weeklyTodos[day] = db.weeklyTodos[day].filter(t => t.id !== id);
  saveDB(db);
  res.json({ ok: true });
});

// Influencers
app.get('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ influencers: db.influencers || [] });
});

app.post('/api/influencers', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencers = db.influencers || [];
  const { name, socialHandle, country } = req.body || {};
  
  if (!name || !country) return res.status(400).json({ error: 'Name and country required' });

  const influencer = {
    id: uuidv4(),
    name,
    socialHandle: socialHandle || '',
    country,
    createdAt: new Date().toISOString()
  };

  db.influencers.push(influencer);
  saveDB(db);
  res.json({ ok: true, influencer });
});

// Influencer Spends
app.get('/api/influencer-spends', requireAuth, (req, res) => {
  const db = loadDB();
  let spends = db.influencerSpends || [];
  
  const { productId, country, start, end } = req.query || {};
  if (productId) spends = spends.filter(s => s.productId === productId);
  if (country) spends = spends.filter(s => s.country === country);
  if (start) spends = spends.filter(s => s.date >= start);
  if (end) spends = spends.filter(s => s.date <= end);

  res.json({ influencerSpends: spends });
});

app.post('/api/influencer-spends', requireAuth, (req, res) => {
  const db = loadDB();
  db.influencerSpends = db.influencerSpends || [];
  const { date, country, productId, influencerId, amount } = req.body || {};
  
  if (!date || !country || !productId || !influencerId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const spend = {
    id: uuidv4(),
    date,
    country,
    productId,
    influencerId,
    amount: +amount || 0,
    createdAt: new Date().toISOString()
  };

  db.influencerSpends.push(spend);
  saveDB(db);
  res.json({ ok: true, spend });
});

// Finance Categories
app.get('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB(); 
  res.json(db.finance?.categories || { debit: [], credit: [] });
});

app.post('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
  const { type, name } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (!Array.isArray(db.finance.categories[type])) db.finance.categories[type] = [];
  if (!db.finance.categories[type].includes(name)) db.finance.categories[type].push(name);
  saveDB(db); 
  res.json({ ok: true, categories: db.finance.categories });
});

app.delete('/api/finance/categories', requireAuth, (req, res) => {
  const db = loadDB();
  const { type, name } = req.query || {};
  if (!type || !name) return res.status(400).json({ error: 'Missing type/name' });
  if (db.finance?.categories?.[type]) db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
  saveDB(db); 
  res.json({ ok: true, categories: db.finance.categories });
});

// Finance Entries
app.get('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB(); 
  let list = db.finance?.entries || [];
  const { start, end, category, type } = req.query || {};
  if (start) list = list.filter(e => e.date >= start);
  if (end) list = list.filter(e => e.date <= end);
  if (category) list = list.filter(e => e.category === category);
  if (type) list = list.filter(e => e.type === type);

  const total = list.reduce((sum, e) => sum + (e.type === 'credit' ? +e.amount : -(+e.amount)), 0);

  res.json({
    entries: list,
    balance: list.reduce((a, e) => a + (e.type === 'credit' ? +e.amount || 0 : -(+e.amount || 0)), 0),
    categoryTotal: total
  });
});

app.post('/api/finance/entries', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
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
  const db = loadDB(); 
  db.finance.entries = (db.finance.entries || []).filter(e => e.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Enhanced Analytics with Sorting
app.get('/api/analytics/remittance', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, productId } = req.query || {};

  let analytics = [];
  
  if (productId && productId !== 'all') {
    if (country && country !== '') {
      const metrics = calculateProfitMetrics(db, productId, country, start, end);
      analytics = [{
        productId,
        productName: (db.products.find(p => p.id === productId) || {}).name || productId,
        country: country,
        ...metrics
      }];
    } else {
      const countries = db.countries.filter(c => c !== 'china');
      analytics = countries.map(country => {
        const metrics = calculateProfitMetrics(db, productId, country, start, end);
        return {
          productId,
          productName: (db.products.find(p => p.id === productId) || {}).name || productId,
          country: country,
          ...metrics
        };
      }).filter(item => item.hasData);
    }
  } else {
    const products = productId === 'all' ? (db.products || []) : (db.products || []).filter(p => p.status === 'active');
    analytics = products.map(product => {
      const metrics = calculateProfitMetrics(db, product.id, country, start, end);
      return {
        productId: product.id,
        productName: product.name,
        country: country || 'All Countries',
        ...metrics
      };
    }).filter(item => item.hasData);
  }

  res.json({ analytics });
});

app.get('/api/analytics/profit-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country } = req.query || {};

  const analytics = {};
  const countries = country ? [country] : (db.countries || []).filter(c => c !== 'china');

  countries.forEach(c => {
    const metrics = calculateProfitMetrics(db, null, c, start, end);
    analytics[c] = metrics;
  });

  // Convert to array for sorting
  let analyticsArray = Object.entries(analytics).map(([country, metrics]) => ({
    country,
    ...metrics
  }));

  res.json({ analytics: analyticsArray });
});

// Product Info with Enhanced Cost Calculation
app.get('/api/product-info/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const productId = req.params.id;
  const product = db.products.find(p => p.id === productId);
  
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const prices = db.productSellingPrices.filter(sp => sp.productId === productId);
  const countries = db.countries.filter(c => c !== 'china');
  
  // Calculate Boxleo fees per order
  const remittances = db.remittances.filter(r => r.productId === productId);
  const totalBoxleoFees = remittances.reduce((sum, r) => sum + (+r.boxleoFees || 0), 0);
  const totalDeliveredOrders = remittances.reduce((sum, r) => sum + (+r.orders || 0), 0);
  const boxleoPerOrder = totalDeliveredOrders > 0 ? totalBoxleoFees / totalDeliveredOrders : 0;
  
  const analysis = countries.map(country => {
    const price = prices.find(p => p.country === country);
    
    // Use enhanced cost calculation logic
    const productCostPerPiece = calculateProductCostPerPiece(db, productId);
    const shippingCostPerPiece = calculateShippingCostPerPiece(db, productId, country);
    
    const sellingPrice = price ? +price.price : 0;
    const productCostChina = productCostPerPiece;
    const shippingCost = shippingCostPerPiece;
    
    const totalCost = productCostChina + shippingCost + boxleoPerOrder;
    const availableForProfitAndAds = sellingPrice - totalCost;
    
    // Get delivery rate
    const deliveryData = calculateProfitMetrics(db, productId, country, '2000-01-01', '2100-01-01');
    const deliveryRate = deliveryData.deliveryRate || 0;
    const maxCPL = deliveryRate > 0 ? availableForProfitAndAds * (deliveryRate / 100) : 0;

    return {
      country,
      sellingPrice,
      productCostChina,
      shippingCost,
      boxleoPerOrder,
      totalCost,
      availableForProfitAndAds,
      deliveryRate,
      maxCPL
    };
  });

  res.json({
    product,
    prices: prices,
    costAnalysis: analysis,
    boxleoPerOrder: boxleoPerOrder,
    totalBoxleoFees: totalBoxleoFees,
    totalDeliveredOrders: totalDeliveredOrders
  });
});

// Product Costs Analysis - Enhanced for "ALL PRODUCTS"
app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};
  
  let metrics;
  if (productId === 'all') {
    // Calculate aggregate metrics for all products
    metrics = calculateProfitMetrics(db, null, null, start, end);
    metrics.isAggregate = true;
    metrics.productCount = db.products.length;
  } else {
    metrics = calculateProfitMetrics(db, productId, null, start, end);
    metrics.isAggregate = false;
    metrics.productCount = 1;
  }
  
  res.json(metrics);
});

// Snapshots
app.get('/api/snapshots', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ snapshots: db.snapshots || [] });
});

app.post('/api/snapshots', requireAuth, async (req, res) => {
  try {
    const db = loadDB();
    const { name } = req.body || {};
    
    await fs.ensureDir(SNAPSHOT_DIR);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotName = name || `Manual-${stamp}`;
    const snapshotFileName = `${stamp}-${snapshotName.replace(/\s+/g, '-')}.json`;
    
    await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, snapshotFileName));
    
    const snapshotEntry = {
      id: uuidv4(),
      name: snapshotName,
      file: snapshotFileName,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };
    
    db.snapshots = db.snapshots || [];
    db.snapshots.unshift(snapshotEntry);
    saveDB(db);
    
    res.json({ ok: true, snapshot: snapshotEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/snapshots/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// Backup Push Route
app.post('/api/backup/push-snapshot', requireAuth, async (req, res) => {
  try {
    const { snapshotFile } = req.body || {};
    if (!snapshotFile) return res.status(400).json({ error: 'Missing snapshot file' });
    
    const snapshotPath = path.join(SNAPSHOT_DIR, snapshotFile);
    if (!fs.existsSync(snapshotPath)) {
      return res.status(404).json({ error: 'Snapshot file not found' });
    }
    
    // Read the snapshot
    const snapshotData = await fs.readJson(snapshotPath);
    
    // Validate the snapshot structure
    if (!snapshotData.products || !snapshotData.countries) {
      return res.status(400).json({ error: 'Invalid snapshot format' });
    }
    
    // Backup current database
    const backupFileName = `pre-push-backup-${Date.now()}.json`;
    await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, backupFileName));
    
    // Replace current database with snapshot
    await fs.writeJson(DATA_FILE, snapshotData, { spaces: 2 });
    
    res.json({ 
      ok: true, 
      message: 'Snapshot pushed successfully. System will reload.',
      backupFile: backupFileName 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stock calculation function
function calculateProductStock(db, productId = null, country = null) {
  const shipments = db.shipments || [];
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  
  let stock = {};
  
  // Initialize stock for all countries (except China)
  db.countries.filter(c => c !== 'china').forEach(c => {
    stock[c] = 0;
  });

  // Process shipments
  shipments.forEach(shipment => {
    if (productId && shipment.productId !== productId) return;
    
    const fromCountry = shipment.fromCountry;
    const toCountry = shipment.toCountry;
    const quantity = +shipment.qty || 0;
    const hasArrived = !!shipment.arrivedAt;

    if (fromCountry === 'china') {
      if (hasArrived && stock[toCountry] !== undefined) {
        stock[toCountry] += quantity;
      }
    } else {
      if (hasArrived) {
        if (stock[fromCountry] !== undefined) stock[fromCountry] -= quantity;
        if (stock[toCountry] !== undefined) stock[toCountry] += quantity;
      }
    }
  });

  // Subtract remittances (sales)
  remittances.filter(r => (!productId || r.productId === productId)).forEach(remittance => {
    if (stock[remittance.country] !== undefined) {
      stock[remittance.country] -= (+remittance.pieces || 0);
    }
  });

  // Add refunds back to stock
  refunds.filter(rf => (!productId || rf.productId === productId)).forEach(refund => {
    if (stock[refund.country] !== undefined) {
      stock[refund.country] += (+refund.pieces || 0);
    }
  });

  if (country) {
    return stock[country] || 0;
  }

  return stock;
}

// Routes
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log('✅ EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
});
