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
app.use('/public', express.static(path.join(ROOT, 'public')));

// ======== AUTHENTICATION MIDDLEWARE ========
function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') return next();
  return res.status(401).json({ error: 'Authentication required' });
}

// ======== DATABASE FUNCTIONS ========
function ensureDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
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
    };
    fs.writeJsonSync(DATA_FILE, initialData, { spaces: 2 });
  }
}

function loadDB() { 
  ensureDB(); 
  return fs.readJsonSync(DATA_FILE); 
}

function saveDB(db) { 
  fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); 
}

// ======== ADVANCED SHIPPING COST CALCULATION ========
function calculateActualShippingCostPerPiece(db, productId, targetCountry) {
  const shipments = db.shipments || [];
  
  // Get all shipments for this product that arrived and are paid
  const relevantShipments = shipments.filter(s => 
    s.productId === productId && 
    s.arrivedAt &&
    s.paymentStatus === 'paid' &&
    s.finalShipCost
  );
  
  if (relevantShipments.length === 0) return 0;
  
  // For target country, calculate average shipping cost per piece
  const countryShipments = relevantShipments.filter(s => s.toCountry === targetCountry);
  
  if (countryShipments.length === 0) return 0;
  
  let totalCost = 0;
  let totalPieces = 0;
  
  countryShipments.forEach(shipment => {
    totalCost += +(shipment.finalShipCost || 0);
    totalPieces += +(shipment.qty || 0);
  });
  
  return totalPieces > 0 ? totalCost / totalPieces : 0;
}

function calculateProductCostPerPiece(db, productId) {
  const shipments = db.shipments || [];
  const chinaShipments = shipments.filter(s => 
    s.productId === productId && 
    s.fromCountry === 'china' && 
    s.arrivedAt
  );
  
  let totalChinaCost = 0;
  let totalPieces = 0;
  
  chinaShipments.forEach(shipment => {
    totalChinaCost += +(shipment.chinaCost || 0);
    totalPieces += +(shipment.qty || 0);
  });
  
  return totalPieces > 0 ? totalChinaCost / totalPieces : 0;
}

function calculateProductStock(db, productId = null, country = null) {
  const shipments = db.shipments || [];
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  
  let stock = {};
  
  // Initialize stock for all countries (except China)
  db.countries.filter(c => c !== 'china').forEach(c => {
    stock[c] = 0;
  });

  // Process all shipments chronologically
  const sortedShipments = [...shipments].sort((a, b) => 
    new Date(a.departedAt || '2000-01-01') - new Date(b.departedAt || '2000-01-01')
  );

  sortedShipments.forEach(shipment => {
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
      } else {
        if (stock[fromCountry] !== undefined) stock[fromCountry] -= quantity;
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

  if (country) return stock[country] || 0;
  return stock;
}

function calculateTransitPieces(db, productId = null) {
  const shipments = db.shipments || [];
  const transitShipments = shipments.filter(s => !s.arrivedAt && (!productId || s.productId === productId));
  
  const chinaTransit = transitShipments
    .filter(s => s.fromCountry === 'china')
    .reduce((sum, s) => sum + (+s.qty || 0), 0);
  
  const interCountryTransit = transitShipments
    .filter(s => s.fromCountry !== 'china')
    .reduce((sum, s) => sum + (+s.qty || 0), 0);

  return {
    chinaTransit,
    interCountryTransit,
    totalTransit: chinaTransit + interCountryTransit
  };
}

// ======== PROFIT CALCULATION LOGICS ========

// Logic 2: For "Remittance Analytics", "Profit by Country", and "Product Info & Analytics"
function calculateProfitMetricsLogic2(db, productId, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  const influencerSpends = db.influencerSpends || [];
  const productOrders = db.productOrders || [];

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;
  let totalRefundedOrders = 0;
  let totalRefundedAmount = 0;
  let totalInfluencerSpend = 0;
  let totalOrders = 0;

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

  // Calculate total orders from product orders
  productOrders.forEach(order => {
    if ((!productId || order.productId === productId) &&
        (!country || order.country === country) &&
        (!startDate || order.startDate >= startDate) &&
        (!endDate || order.endDate <= endDate)) {
      totalOrders += (+order.orders || 0);
    }
  });

  // Calculate product cost per piece from total purchases
  const productCostPerPiece = calculateProductCostPerPiece(db, productId);
  
  // Calculate shipping cost using actual piece tracking
  let shippingCostPerPiece = 0;
  if (country) {
    shippingCostPerPiece = calculateActualShippingCostPerPiece(db, productId, country);
  }

  const totalProductChinaCost = totalDeliveredPieces * productCostPerPiece;
  const totalShippingCost = totalDeliveredPieces * shippingCostPerPiece;

  const adjustedRevenue = totalRevenue - totalRefundedAmount;
  const totalCost = totalProductChinaCost + totalShippingCost + totalAdSpend + totalBoxleoFees + totalInfluencerSpend;
  const profit = adjustedRevenue - totalCost;

  // Calculate delivery rate
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

// ======== ROUTES ========

// Authentication
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
  
  return res.status(401).json({ error: 'Wrong password' });
});

app.get('/api/auth/status', requireAuth, (req, res) => {
  res.json({ authenticated: true });
});

// Meta data
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

// Products
app.get('/api/products', requireAuth, (req, res) => { 
  const db = loadDB();
  let products = (db.products || []).map(product => {
    const metrics = calculateProfitMetricsLogic2(db, product.id, null, '2000-01-01', '2100-01-01');
    const stock = calculateProductStock(db, product.id);
    const transit = calculateTransitPieces(db, product.id);
    const totalStock = Object.values(stock).reduce((sum, qty) => sum + qty, 0);
    
    // Only count stock for active products
    const activeStockByCountry = {};
    Object.keys(stock).forEach(country => {
      activeStockByCountry[country] = product.status === 'active' ? stock[country] : 0;
    });

    const adSpendByCountry = {};
    (db.adspend || []).filter(ad => ad.productId === product.id).forEach(ad => {
      adSpendByCountry[ad.country] = (adSpendByCountry[ad.country] || 0) + (+ad.amount || 0);
    });

    return {
      ...product,
      isProfitable: metrics.isProfitable,
      hasData: metrics.hasData,
      stockByCountry: activeStockByCountry,
      totalStock: product.status === 'active' ? totalStock : 0,
      transitPieces: transit.totalTransit,
      totalPiecesIncludingTransit: (product.status === 'active' ? totalStock : 0) + transit.totalTransit,
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
  
  const newStatus = req.body.status || 'active';
  p.status = newStatus;
  
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

// Product Notes
app.get('/api/products/:id/notes', requireAuth, (req, res) => {
  const db = loadDB();
  const notes = (db.productNotes || []).filter(n => n.productId === req.params.id);
  res.json({ notes });
});

app.post('/api/products/:id/notes', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.productNotes = db.productNotes || [];
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

  saveDB(db); 
  res.json({ ok: true });
});

app.delete('/api/products/notes/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.productNotes = (db.productNotes || []).filter(n => n.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Product Orders
app.get('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, start, end, page = 1, limit = 8 } = req.query || {};
  let orders = db.productOrders || [];

  if (productId) orders = orders.filter(o => o.productId === productId);
  if (country) orders = orders.filter(o => o.country === country);
  if (start) orders = orders.filter(o => o.startDate >= start);
  if (end) orders = orders.filter(o => o.endDate <= end);

  orders.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedOrders = orders.slice(startIndex, endIndex);
  const totalPages = Math.ceil(orders.length / limit);

  res.json({ 
    orders: paginatedOrders,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalItems: orders.length,
      hasNextPage: endIndex < orders.length,
      hasPrevPage: startIndex > 0
    }
  });
});

app.post('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.productOrders = db.productOrders || [];
  const { productId, country, startDate, endDate, orders } = req.body || {};
  if (!productId || !country || !startDate || !endDate) return res.status(400).json({ error: 'Missing fields' });

  const existingOrder = db.productOrders.find(o => 
    o.productId === productId && 
    o.country === country && 
    o.startDate === startDate && 
    o.endDate === endDate
  );

  if (existingOrder) {
    return res.status(409).json({ 
      error: 'Duplicate order period', 
      message: 'You already entered orders in that period for that product. Are you sure you want to enter again?',
      existingOrder 
    });
  }

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
  const { productId, country, platform, amount, date } = req.body || {};
  if (!productId || !country || !platform || !date) return res.status(400).json({ error: 'Missing fields' });
  
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
      id: uuidv4(), 
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
  db.deliveries.push({ id: uuidv4(), date, country, delivered: +delivered || 0, productId: productId || '' });
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
  const { start, end, country, productId, page = 1, limit = 8 } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);

  list.sort((a, b) => new Date(b.start) - new Date(a.start));

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedList = list.slice(startIndex, endIndex);
  const totalPages = Math.ceil(list.length / limit);

  res.json({ 
    remittances: paginatedList,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalItems: list.length,
      hasNextPage: endIndex < list.length,
      hasPrevPage: startIndex > 0
    }
  });
});

app.post('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.remittances = db.remittances || [];
  const { start, end, country, productId, orders, pieces, revenue, adSpend, boxleoFees } = req.body || {};
  
  if (!start || !end || !country || !productId) return res.status(400).json({ error: 'Missing required fields' });

  const existingRemittance = db.remittances.find(r => 
    r.productId === productId && 
    r.country === country && 
    r.start === start && 
    r.end === end
  );

  if (existingRemittance) {
    return res.status(409).json({ 
      error: 'Duplicate remittance period', 
      message: 'You already entered a remittance for this product in this country during this period. Are you sure you want to enter again?',
      existingRemittance 
    });
  }

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

app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Refunds
app.get('/api/refunds', requireAuth, (req, res) => {
  const db = loadDB(); 
  let list = db.refunds || [];
  const { start, end, country, productId, page = 1, limit = 8 } = req.query || {};
  if (start) list = list.filter(r => r.date >= start);
  if (end) list = list.filter(r => r.date <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);

  list.sort((a, b) => new Date(b.date) - new Date(a.date));

  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + parseInt(limit);
  const paginatedList = list.slice(startIndex, endIndex);
  const totalPages = Math.ceil(list.length / limit);

  res.json({ 
    refunds: paginatedList,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalItems: list.length,
      hasNextPage: endIndex < list.length,
      hasPrevPage: startIndex > 0
    }
  });
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

app.delete('/api/refunds/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.refunds = (db.refunds || []).filter(r => r.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
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
  const running = list.reduce((sum, e) => sum + (e.type === 'credit' ? +e.amount : -(+e.amount)), 0);

  res.json({
    entries: list,
    running: running,
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

// Todo Lists
app.get('/api/todos', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ todos: db.todos || [] });
});

app.post('/api/todos', requireAuth, (req, res) => {
  const db = loadDB();
  db.todos = db.todos || [];
  const { text } = req.body || {};
  
  if (!text) return res.status(400).json({ error: 'Missing text' });
  
  const todo = {
    id: uuidv4(),
    text: text.trim(),
    done: false,
    createdAt: new Date().toISOString()
  };
  
  db.todos.push(todo);
  saveDB(db);
  res.json({ ok: true, todo });
});

app.post('/api/todos/:id/toggle', requireAuth, (req, res) => {
  const db = loadDB();
  const todo = db.todos.find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  
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
  
  if (!day || !text) return res.status(400).json({ error: 'Missing day or text' });
  
  if (!db.weeklyTodos[day]) db.weeklyTodos[day] = [];
  
  const todo = {
    id: uuidv4(),
    text: text.trim(),
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
  
  const { done } = req.body || {};
  if (done !== undefined) todo.done = done;
  
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

// Brainstorming
app.get('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ ideas: db.brainstorming || [] });
});

app.post('/api/brainstorming', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.brainstorming = db.brainstorming || [];
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

  saveDB(db); 
  res.json({ ok: true, product });
});

app.delete('/api/tested-products/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.testedProducts = (db.testedProducts || []).filter(tp => tp.id !== req.params.id);
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
  const { name, social, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const inf = { id: uuidv4(), name, social: social || '', country: country || '' };
  db.influencers.push(inf); 
  saveDB(db); 
  res.json({ ok: true, influencer: inf });
});

app.delete('/api/influencers/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Influencer Spend
app.get('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB(); 
  res.json({ spends: db.influencerSpends || [] });
});

app.post('/api/influencers/spend', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.influencerSpends = db.influencerSpends || [];
  const { date, influencerId, country, productId, amount } = req.body || {};
  if (!influencerId) return res.status(400).json({ error: 'Missing influencerId' });
  const sp = { id: uuidv4(), date: date || new Date().toISOString().slice(0, 10), influencerId, country: country || '', productId: productId || '', amount: +amount || 0 };
  db.influencerSpends.push(sp); 
  saveDB(db); 
  res.json({ ok: true, spend: sp });
});

app.delete('/api/influencers/spend/:id', requireAuth, (req, res) => {
  const db = loadDB(); 
  db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
  saveDB(db); 
  res.json({ ok: true });
});

// Analytics
app.get('/api/analytics/remittance', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, productId, sortBy = 'totalDeliveredPieces', sortOrder = 'desc' } = req.query || {};

  let analytics = [];
  
  if (productId && productId !== 'all') {
    if (country && country !== '') {
      const metrics = calculateProfitMetricsLogic2(db, productId, country, start, end);
      analytics = [{
        productId,
        productName: (db.products.find(p => p.id === productId) || {}).name || productId,
        country: country,
        ...metrics
      }];
    } else {
      const countries = db.countries.filter(c => c !== 'china');
      analytics = countries.map(country => {
        const metrics = calculateProfitMetricsLogic2(db, productId, country, start, end);
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
      const metrics = calculateProfitMetricsLogic2(db, product.id, country, start, end);
      return {
        productId: product.id,
        productName: product.name,
        country: country || 'All Countries',
        ...metrics
      };
    }).filter(item => item.hasData);
  }

  // Apply sorting
  analytics.sort((a, b) => {
    let aValue, bValue;
    
    switch(sortBy) {
      case 'profit': aValue = a.profit; bValue = b.profit; break;
      case 'totalDeliveredPieces': aValue = a.totalDeliveredPieces; bValue = b.totalDeliveredPieces; break;
      case 'totalRevenue': aValue = a.totalRevenue; bValue = b.totalRevenue; break;
      case 'totalOrders': aValue = a.totalOrders; bValue = b.totalOrders; break;
      case 'profitPerOrder': aValue = a.profitPerOrder; bValue = b.profitPerOrder; break;
      case 'profitPerPiece': aValue = a.profitPerPiece; bValue = b.profitPerPiece; break;
      case 'deliveryRate': aValue = a.deliveryRate; bValue = b.deliveryRate; break;
      default: aValue = a.totalDeliveredPieces; bValue = b.totalDeliveredPieces;
    }
    
    if (sortOrder === 'desc') return bValue - aValue;
    else return aValue - bValue;
  });

  res.json({ analytics, sortBy, sortOrder });
});

app.get('/api/analytics/profit-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, sortBy = 'totalDeliveredPieces', sortOrder = 'desc' } = req.query || {};

  const analytics = {};
  const countries = country ? [country] : (db.countries || []).filter(c => c !== 'china');

  countries.forEach(c => {
    const metrics = calculateProfitMetricsLogic2(db, null, c, start, end);
    analytics[c] = metrics;
  });

  let analyticsArray = Object.entries(analytics).map(([country, metrics]) => ({
    country,
    ...metrics
  }));

  analyticsArray.sort((a, b) => {
    let aValue, bValue;
    
    switch(sortBy) {
      case 'profit': aValue = a.profit; bValue = b.profit; break;
      case 'totalDeliveredPieces': aValue = a.totalDeliveredPieces; bValue = b.totalDeliveredPieces; break;
      case 'totalRevenue': aValue = a.totalRevenue; bValue = b.totalRevenue; break;
      case 'totalOrders': aValue = a.totalOrders; bValue = b.totalOrders; break;
      case 'profitPerOrder': aValue = a.profitPerOrder; bValue = b.profitPerOrder; break;
      case 'profitPerPiece': aValue = a.profitPerPiece; bValue = b.profitPerPiece; break;
      case 'deliveryRate': aValue = a.deliveryRate; bValue = b.deliveryRate; break;
      default: aValue = a.totalDeliveredPieces; bValue = b.totalDeliveredPieces;
    }
    
    if (sortOrder === 'desc') return bValue - aValue;
    else return aValue - bValue;
  });

  res.json({ analytics: analyticsArray, sortBy, sortOrder });
});

// Product Info
app.get('/api/product-info/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const productId = req.params.id;
  const product = db.products.find(p => p.id === productId);
  
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const prices = db.productSellingPrices.filter(sp => sp.productId === productId);
  const countries = db.countries.filter(c => c !== 'china');
  
  const remittances = db.remittances.filter(r => r.productId === productId);
  const totalBoxleoFees = remittances.reduce((sum, r) => sum + (+r.boxleoFees || 0), 0);
  const totalDeliveredOrders = remittances.reduce((sum, r) => sum + (+r.orders || 0), 0);
  const boxleoPerOrder = totalDeliveredOrders > 0 ? totalBoxleoFees / totalDeliveredOrders : 0;
  
  const analysis = countries.map(country => {
    const price = prices.find(p => p.country === country);
    
    const productCostPerPiece = calculateProductCostPerPiece(db, productId);
    const shippingCostPerPiece = calculateActualShippingCostPerPiece(db, productId, country);
    
    const sellingPrice = price ? +price.price : 0;
    const productCostChina = productCostPerPiece;
    const shippingCost = shippingCostPerPiece;
    
    const totalCost = productCostChina + shippingCost + boxleoPerOrder;
    const availableForProfitAndAds = sellingPrice - totalCost;
    
    const deliveryData = calculateProfitMetricsLogic2(db, productId, country, '2000-01-01', '2100-01-01');
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

// Product Costs Analysis (Logic 1)
app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};
  
  let metrics;
  if (productId === 'all') {
    // Aggregate all products
    const allProducts = db.products || [];
    let totalRevenue = 0;
    let totalBoxleoFees = 0;
    let totalProductChinaCost = 0;
    let totalShippingCost = 0;
    let totalAdSpend = 0;
    let totalInfluencerSpend = 0;
    let totalRefundedAmount = 0;
    let totalRefundedOrders = 0;
    let totalDeliveredPieces = 0;
    let totalDeliveredOrders = 0;
    let totalOrders = 0;

    allProducts.forEach(product => {
      const productMetrics = calculateProfitMetricsLogic2(db, product.id, null, start, end);
      totalRevenue += productMetrics.totalRevenue;
      totalBoxleoFees += productMetrics.totalBoxleoFees;
      totalProductChinaCost += productMetrics.totalProductChinaCost;
      totalShippingCost += productMetrics.totalShippingCost;
      totalAdSpend += productMetrics.totalAdSpend;
      totalInfluencerSpend += productMetrics.totalInfluencerSpend;
      totalRefundedAmount += productMetrics.totalRefundedAmount;
      totalRefundedOrders += productMetrics.totalRefundedOrders;
      totalDeliveredPieces += productMetrics.totalDeliveredPieces;
      totalDeliveredOrders += productMetrics.totalDeliveredOrders;
      totalOrders += productMetrics.totalOrders;
    });

    const totalCost = totalProductChinaCost + totalShippingCost + totalBoxleoFees + totalAdSpend + totalInfluencerSpend;
    const profit = totalRevenue - totalCost;
    const netDeliveredOrders = totalDeliveredOrders - totalRefundedOrders;
    const deliveryRate = totalOrders > 0 ? (netDeliveredOrders / totalOrders) * 100 : 0;

    metrics = {
      totalRevenue,
      totalBoxleoFees,
      totalProductChinaCost,
      totalShippingCost,
      totalAdSpend,
      totalInfluencerSpend,
      totalRefundedAmount,
      totalRefundedOrders,
      totalCost,
      profit,
      totalDeliveredPieces,
      totalDeliveredOrders: netDeliveredOrders,
      totalOrders,
      deliveryRate,
      isProfitable: profit > 0,
      hasData: totalDeliveredPieces > 0 || totalRevenue > 0,
      isAggregate: true,
      productCount: allProducts.length
    };
  } else {
    metrics = calculateProfitMetricsLogic2(db, productId, null, start, end);
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

// Backup push
app.post('/api/backup/push-snapshot', requireAuth, async (req, res) => {
  try {
    const { snapshotFile } = req.body || {};
    if (!snapshotFile) return res.status(400).json({ error: 'Missing snapshot file' });
    
    const snapshotPath = path.join(SNAPSHOT_DIR, snapshotFile);
    if (!fs.existsSync(snapshotPath)) {
      return res.status(404).json({ error: 'Snapshot file not found' });
    }
    
    const snapshotData = await fs.readJson(snapshotPath);
    
    if (!snapshotData.products || !snapshotData.countries) {
      return res.status(400).json({ error: 'Invalid snapshot format' });
    }
    
    const backupFileName = `pre-push-backup-${Date.now()}.json`;
    await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, backupFileName));
    
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

// ======== STARTUP BACKUP ========
async function createStartupBackup() {
  try {
    const db = loadDB();
    const today = new Date().toISOString().slice(0, 10);
    const backupName = `Daily-${today}`;
    
    const existingBackup = db.snapshots.find(snap => 
      snap.name && snap.name.includes(today)
    );
    
    if (!existingBackup) {
      const snapshotFileName = `auto-daily-${today}.json`;
      await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, snapshotFileName));
      
      const backupEntry = {
        id: uuidv4(),
        name: backupName,
        file: snapshotFileName,
        createdAt: new Date().toISOString(),
        kind: 'auto-daily'
      };
      
      db.snapshots.unshift(backupEntry);
      
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      db.snapshots = db.snapshots.filter(snapshot => {
        if (snapshot.name && snapshot.name.startsWith('Daily-')) {
          const snapshotDate = new Date(snapshot.createdAt);
          return snapshotDate >= sevenDaysAgo;
        }
        return true;
      });
      
      saveDB(db);
      console.log(`✅ Auto-created startup backup: ${backupName}`);
    }
  } catch (error) {
    console.error('❌ Startup backup error:', error.message);
  }
}

// ======== STATIC ROUTES ========
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, async () => {
  await createStartupBackup();
  console.log('✅ EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
});
