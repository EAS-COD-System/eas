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
  
  // Get all shipments for this product that arrived
  const relevantShipments = shipments.filter(s => 
    s.productId === productId && 
    s.arrivedAt &&
    s.paymentStatus === 'paid' &&
    s.finalShipCost
  );
  
  if (relevantShipments.length === 0) return 0;
  
  // Build shipment chains to track piece movement
  const pieceTracking = {};
  
  // Process shipments chronologically
  const sortedShipments = [...relevantShipments].sort((a, b) => 
    new Date(a.departedAt) - new Date(b.departedAt)
  );
  
  sortedShipments.forEach(shipment => {
    const fromCountry = shipment.fromCountry;
    const toCountry = shipment.toCountry;
    const quantity = +shipment.qty || 0;
    const shippingCostPerPiece = (+shipment.finalShipCost || +shipment.shipCost || 0) / quantity;
    
    if (fromCountry === 'china') {
      // New pieces from China
      if (!pieceTracking[toCountry]) pieceTracking[toCountry] = [];
      for (let i = 0; i < quantity; i++) {
        pieceTracking[toCountry].push({
          cost: shippingCostPerPiece,
          route: [`${fromCountry}→${toCountry}`]
        });
      }
    } else {
      // Moving existing pieces between countries
      if (pieceTracking[fromCountry] && pieceTracking[fromCountry].length >= quantity) {
        const movedPieces = pieceTracking[fromCountry].splice(0, quantity);
        if (!pieceTracking[toCountry]) pieceTracking[toCountry] = [];
        
        movedPieces.forEach(piece => {
          pieceTracking[toCountry].push({
            cost: piece.cost + shippingCostPerPiece,
            route: [...piece.route, `${fromCountry}→${toCountry}`]
          });
        });
      }
    }
  });
  
  // Calculate average cost for target country
  if (pieceTracking[targetCountry] && pieceTracking[targetCountry].length > 0) {
    const totalCost = pieceTracking[targetCountry].reduce((sum, piece) => sum + piece.cost, 0);
    return totalCost / pieceTracking[targetCountry].length;
  }
  
  return 0;
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

// ======== DIFFERENT PROFIT CALCULATION LOGICS ========

// Logic 1: For "Lifetime Product Costs Analysis" and "Lifetime (This Product)"
function calculateProfitMetricsLogic1(db, productId, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  const shipments = db.shipments || [];
  const productOrders = db.productOrders || [];
  const adspend = db.adspend || [];
  const influencerSpends = db.influencerSpends || [];

  let totalRevenue = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;
  let totalRefundedOrders = 0;
  let totalRefundedAmount = 0;
  let totalOrders = 0;
  let totalAdSpend = 0;
  let totalInfluencerSpend = 0;

  // Calculate from remittances (only use remittance ad spend)
  remittances.forEach(remittance => {
    if ((!productId || remittance.productId === productId) &&
        (!country || remittance.country === country) &&
        (!startDate || remittance.start >= startDate) &&
        (!endDate || remittance.end <= endDate)) {
      totalRevenue += +remittance.revenue || 0;
      totalBoxleoFees += +remittance.boxleoFees || 0;
      totalDeliveredPieces += +remittance.pieces || 0;
      totalDeliveredOrders += +remittance.orders || 0;
      totalAdSpend += +remittance.adSpend || 0; // Only use remittance ad spend
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

  // Calculate total orders from product orders
  productOrders.forEach(order => {
    if ((!productId || order.productId === productId) &&
        (!country || order.country === country) &&
        (!startDate || order.startDate >= startDate) &&
        (!endDate || order.endDate <= endDate)) {
      totalOrders += (+order.orders || 0);
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

  // Calculate product and shipping costs from TOTAL shipments (not per delivered piece)
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  shipments.forEach(shipment => {
    if ((!productId || shipment.productId === productId) &&
        (!startDate || shipment.departedAt >= startDate) &&
        (!endDate || shipment.departedAt <= endDate)) {
      totalProductChinaCost += +(shipment.chinaCost || 0);
      totalShippingCost += +(shipment.finalShipCost || shipment.shipCost || 0);
    }
  });

  const adjustedRevenue = totalRevenue - totalRefundedAmount;
  const totalCost = totalProductChinaCost + totalShippingCost + totalBoxleoFees + totalAdSpend + totalInfluencerSpend;
  const profit = adjustedRevenue - totalCost;

  const netDeliveredOrders = totalDeliveredOrders - totalRefundedOrders;
  const deliveryRate = totalOrders > 0 ? (netDeliveredOrders / totalOrders) * 100 : 0;

  // Enhanced metrics for Logic 2 compatibility
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

  return {
    totalRevenue: adjustedRevenue,
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
    hasData: totalDeliveredPieces > 0 || adjustedRevenue > 0
  };
}

// Logic 2: For "Remittance Analytics", "Profit by Country", and "Product Info & Analytics"
function calculateProfitMetricsLogic2(db, productId, country = null, startDate = null, endDate = null) {
  const shipments = db.shipments || [];
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

  // Calculate from remittances (only use remittance ad spend)
  remittances.forEach(remittance => {
    if ((!productId || remittance.productId === productId) &&
        (!country || remittance.country === country) &&
        (!startDate || remittance.start >= startDate) &&
        (!endDate || remittance.end <= endDate)) {
      totalRevenue += +remittance.revenue || 0;
      totalAdSpend += +remittance.adSpend || 0; // Only use remittance ad spend
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
  let totalShippingCost = totalDeliveredPieces * shippingCostPerPiece;
  if (!country) { // For aggregated views, we need to sum up all final shipping costs
    const shipments = db.shipments || [];
    shipments.forEach(shipment => {
      if ((!productId || shipment.productId === productId) &&
          shipment.arrivedAt &&
          shipment.paymentStatus === 'paid') {
        totalShippingCost += +(shipment.finalShipCost || shipment.shipCost || 0);
      }
    });
  }

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
  
  console.log('Auth attempt with password:', password);
  
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
    console.log('Login successful');
    return res.json({ ok: true });
  }
  
  console.log('Login failed');
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
  const currentStatus = p.status;
  
  if (currentStatus === 'active' && newStatus === 'paused') {
    // Product is being paused - we'll handle stock adjustment in the frontend
    p.status = 'paused';
  } else if (currentStatus === 'paused' && newStatus === 'active') {
    // Product is being activated
    p.status = 'active';
  }
  
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

aapp.post('/api/shipments/:id/mark-paid', requireAuth, (req, res) => {
  const db = loadDB();
  const shipment = (db.shipments || []).find(s => s.id === req.params.id);
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });

  const { finalShipCost } = req.body || {};
  if (finalShipCost === undefined) return res.status(400).json({ error: 'Missing finalShipCost' });

  shipment.finalShipCost = +finalShipCost;
  shipment.paymentStatus = 'paid';

  saveDB(db);
  res.json({ ok: true, shipment });
});: s });
});
