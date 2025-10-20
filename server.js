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
      finance: {
        categories: {
          debit: [],
          credit: []
        },
        entries: []
      },
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

// FIXED: Enhanced product cost calculation with proper hierarchical shipping
function calculateProductCosts(db, productId, targetCountry = null) {
  const shipments = db.shipments || [];
  
  // First, get all arrived shipments for this product
  const arrivedShipments = shipments.filter(s => 
    s.productId === productId && s.arrivedAt
  );

  // Calculate total pieces and costs from China
  let totalPiecesFromChina = 0;
  let totalChinaCost = 0;
  let totalShippingCostFromChina = 0;

  // Track cost structure per country
  const countryCosts = {};

  // Process China shipments first
  arrivedShipments.forEach(shipment => {
    if (shipment.fromCountry === 'china') {
      const pieces = +shipment.qty || 0;
      const chinaCost = +shipment.chinaCost || 0;
      const shippingCost = +shipment.shipCost || 0;
      const toCountry = shipment.toCountry;

      totalPiecesFromChina += pieces;
      totalChinaCost += chinaCost;
      totalShippingCostFromChina += shippingCost;

      // Set base costs for destination country
      if (pieces > 0) {
        countryCosts[toCountry] = {
          chinaCostPerPiece: chinaCost / pieces,
          shippingCostPerPiece: shippingCost / pieces,
          totalCostPerPiece: (chinaCost + shippingCost) / pieces,
          pieces: pieces
        };
      }
    }
  });

  // Process inter-country shipments to accumulate costs
  let hasChanges = true;
  while (hasChanges) {
    hasChanges = false;
    arrivedShipments.forEach(shipment => {
      if (shipment.fromCountry !== 'china') {
        const fromCountry = shipment.fromCountry;
        const toCountry = shipment.toCountry;
        const pieces = +shipment.qty || 0;
        const shippingCost = +shipment.shipCost || 0;

        // If we have cost data for source country but not destination
        if (countryCosts[fromCountry] && !countryCosts[toCountry] && pieces > 0) {
          const additionalShippingPerPiece = shippingCost / pieces;
          
          countryCosts[toCountry] = {
            chinaCostPerPiece: countryCosts[fromCountry].chinaCostPerPiece,
            shippingCostPerPiece: countryCosts[fromCountry].shippingCostPerPiece + additionalShippingPerPiece,
            totalCostPerPiece: countryCosts[fromCountry].totalCostPerPiece + additionalShippingPerPiece,
            pieces: pieces
          };
          hasChanges = true;
        }
      }
    });
  }

  // If specific country requested, return its costs
  if (targetCountry && countryCosts[targetCountry]) {
    const country = countryCosts[targetCountry];
    return {
      costPerPiece: country.totalCostPerPiece,
      chinaCostPerPiece: country.chinaCostPerPiece,
      shippingCostPerPiece: country.shippingCostPerPiece,
      totalPieces: country.pieces,
      totalChinaCost: country.chinaCostPerPiece * country.pieces,
      totalShippingCost: country.shippingCostPerPiece * country.pieces
    };
  }

  // Calculate weighted averages for all countries
  let totalWeightedChinaCost = 0;
  let totalWeightedShippingCost = 0;
  let totalAllPieces = 0;

  Object.values(countryCosts).forEach(country => {
    totalWeightedChinaCost += country.chinaCostPerPiece * country.pieces;
    totalWeightedShippingCost += country.shippingCostPerPiece * country.pieces;
    totalAllPieces += country.pieces;
  });

  return {
    costPerPiece: totalAllPieces > 0 ? (totalWeightedChinaCost + totalWeightedShippingCost) / totalAllPieces : 0,
    chinaCostPerPiece: totalAllPieces > 0 ? totalWeightedChinaCost / totalAllPieces : 0,
    shippingCostPerPiece: totalAllPieces > 0 ? totalWeightedShippingCost / totalAllPieces : 0,
    totalPieces: totalAllPieces,
    totalChinaCost: totalWeightedChinaCost,
    totalShippingCost: totalWeightedShippingCost
  };
}

// FIXED: Enhanced cost calculation for specific period - uses actual costs paid in period
function calculateProductCostsForPeriod(db, productId, startDate = null, endDate = null) {
  const shipments = db.shipments || [];
  
  // Filter shipments by period and product
  const periodShipments = shipments.filter(s => 
    s.productId === productId && 
    s.arrivedAt &&
    (!startDate || s.arrivedAt >= startDate) &&
    (!endDate || s.arrivedAt <= endDate)
  );

  let totalChinaCost = 0;
  let totalShippingCost = 0;
  let totalPieces = 0;

  // Calculate total costs and pieces for the period
  periodShipments.forEach(shipment => {
    const pieces = +shipment.qty || 0;
    const chinaCost = +shipment.chinaCost || 0;
    const shippingCost = +shipment.shipCost || 0;

    totalPieces += pieces;
    totalChinaCost += chinaCost;
    totalShippingCost += shippingCost;
  });

  return {
    totalChinaCost,
    totalShippingCost,
    totalPieces,
    chinaCostPerPiece: totalPieces > 0 ? totalChinaCost / totalPieces : 0,
    shippingCostPerPiece: totalPieces > 0 ? totalShippingCost / totalPieces : 0
  };
}

// FIXED: Delivery rate calculation
function calculateDeliveryRate(db, productId = null, country = null, startDate = null, endDate = null) {
  const productOrders = db.productOrders || [];
  const remittances = db.remittances || [];

  let totalOrders = 0;
  let totalDeliveredOrders = 0;

  productOrders.forEach(order => {
    if ((!productId || order.productId === productId) &&
        (!country || order.country === country) &&
        (!startDate || order.startDate >= startDate) &&
        (!endDate || order.endDate <= endDate)) {
      totalOrders += (+order.orders || 0);
    }
  });

  remittances.forEach(remittance => {
    if ((!productId || remittance.productId === productId) &&
        (!country || remittance.country === country) &&
        (!startDate || remittance.start >= startDate) &&
        (!endDate || remittance.end <= endDate)) {
      totalDeliveredOrders += (+remittance.orders || 0);
    }
  });

  const deliveryRate = totalOrders > 0 ? (totalDeliveredOrders / totalOrders) * 100 : 0;

  return {
    deliveryRate,
    totalOrders,
    totalDeliveredOrders
  };
}

// FIXED: Profit metrics with proper cost allocation based on delivered pieces
function calculateProfitMetrics(db, productId = null, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const adSpends = db.adspend || [];

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;

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

  // Add ad spends
  adSpends.forEach(ad => {
    if ((!productId || ad.productId === productId) &&
        (!country || ad.country === country) &&
        (!startDate || true) && (!endDate || true)) {
      totalAdSpend += +ad.amount || 0;
    }
  });

  // FIXED: Calculate product costs based on actual delivered pieces and their cost structure
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  if (productId) {
    // For specific period, use actual costs paid in that period
    const productCosts = calculateProductCostsForPeriod(db, productId, startDate, endDate);
    
    if (totalDeliveredPieces > 0) {
      if (country) {
        // For specific country, use that country's cost structure
        const countryCosts = calculateProductCosts(db, productId, country);
        totalProductChinaCost = totalDeliveredPieces * (countryCosts.chinaCostPerPiece || 0);
        totalShippingCost = totalDeliveredPieces * (countryCosts.shippingCostPerPiece || 0);
      } else {
        // For all countries, use weighted average from period
        totalProductChinaCost = totalDeliveredPieces * (productCosts.chinaCostPerPiece || 0);
        totalShippingCost = totalDeliveredPieces * (productCosts.shippingCostPerPiece || 0);
      }
    }
  } else {
    // For all products in a country
    const products = db.products || [];
    products.forEach(product => {
      const productCosts = calculateProductCostsForPeriod(db, product.id, startDate, endDate);
      const productRemittances = remittances.filter(r => 
        r.productId === product.id &&
        (!country || r.country === country) &&
        (!startDate || r.start >= startDate) &&
        (!endDate || r.end <= endDate)
      );
      
      const productDeliveredPieces = productRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
      
      if (productDeliveredPieces > 0) {
        totalProductChinaCost += productDeliveredPieces * (productCosts.chinaCostPerPiece || 0);
        totalShippingCost += productDeliveredPieces * (productCosts.shippingCostPerPiece || 0);
      }
    });
  }

  const totalCost = totalProductChinaCost + totalShippingCost + totalAdSpend + totalBoxleoFees;
  const profit = totalRevenue - totalCost;
  const deliveryData = calculateDeliveryRate(db, productId, country, startDate, endDate);

  // Calculate all the rates
  const costPerDeliveredOrder = totalDeliveredOrders > 0 ? totalCost / totalDeliveredOrders : 0;
  const costPerDeliveredPiece = totalDeliveredPieces > 0 ? totalCost / totalDeliveredPieces : 0;
  const adCostPerDeliveredOrder = totalDeliveredOrders > 0 ? totalAdSpend / totalDeliveredOrders : 0;
  const adCostPerDeliveredPiece = totalDeliveredPieces > 0 ? totalAdSpend / totalDeliveredPieces : 0;
  const boxleoPerDeliveredOrder = totalDeliveredOrders > 0 ? totalBoxleoFees / totalDeliveredOrders : 0;
  const boxleoPerDeliveredPiece = totalDeliveredPieces > 0 ? totalBoxleoFees / totalDeliveredPieces : 0;
  const averageOrderValue = totalDeliveredOrders > 0 ? totalRevenue / totalDeliveredOrders : 0;

  // FIXED: Ensure hasData is properly calculated
  const hasData = totalDeliveredPieces > 0 || totalRevenue > 0 || totalAdSpend > 0;
  
  return {
    totalRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalProductChinaCost,
    totalShippingCost,
    totalCost,
    profit,
    totalDeliveredPieces,
    totalDeliveredOrders,
    totalOrders: deliveryData.totalOrders,
    deliveryRate: deliveryData.deliveryRate,
    costPerDeliveredOrder,
    costPerDeliveredPiece,
    adCostPerDeliveredOrder,
    adCostPerDeliveredPiece,
    boxleoPerDeliveredOrder,
    boxleoPerDeliveredPiece,
    averageOrderValue,
    isProfitable: profit > 0,
    hasData: hasData
  };
}

// NEW: Profit metrics for period costs (uses shipment costs, not delivered piece costs) - FOR SPECIFIC SECTIONS ONLY
function calculateProfitMetricsForPeriod(db, productId = null, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const adSpends = db.adspend || [];

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;

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

  // Add ad spends
  adSpends.forEach(ad => {
    if ((!productId || ad.productId === productId) &&
        (!country || ad.country === country) &&
        (!startDate || true) && (!endDate || true)) {
      totalAdSpend += +ad.amount || 0;
    }
  });

  // NEW: Calculate product costs based on actual shipments in the period
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  if (productId) {
    // For specific product, use actual costs paid in that period from shipments
    const productCosts = calculateProductCostsForPeriod(db, productId, startDate, endDate);
    totalProductChinaCost = productCosts.totalChinaCost;
    totalShippingCost = productCosts.totalShippingCost;
  } else {
    // For all products in a country
    const products = db.products || [];
    products.forEach(product => {
      const productCosts = calculateProductCostsForPeriod(db, product.id, startDate, endDate);
      totalProductChinaCost += productCosts.totalChinaCost;
      totalShippingCost += productCosts.totalShippingCost;
    });
  }

  const totalCost = totalProductChinaCost + totalShippingCost + totalAdSpend + totalBoxleoFees;
  const profit = totalRevenue - totalCost;
  const deliveryData = calculateDeliveryRate(db, productId, country, startDate, endDate);

  // Calculate all the rates
  const costPerDeliveredOrder = totalDeliveredOrders > 0 ? totalCost / totalDeliveredOrders : 0;
  const costPerDeliveredPiece = totalDeliveredPieces > 0 ? totalCost / totalDeliveredPieces : 0;
  const adCostPerDeliveredOrder = totalDeliveredOrders > 0 ? totalAdSpend / totalDeliveredOrders : 0;
  const adCostPerDeliveredPiece = totalDeliveredPieces > 0 ? totalAdSpend / totalDeliveredPieces : 0;
  const boxleoPerDeliveredOrder = totalDeliveredOrders > 0 ? totalBoxleoFees / totalDeliveredOrders : 0;
  const boxleoPerDeliveredPiece = totalDeliveredPieces > 0 ? totalBoxleoFees / totalDeliveredPieces : 0;
  const averageOrderValue = totalDeliveredOrders > 0 ? totalRevenue / totalDeliveredOrders : 0;

  const hasData = totalDeliveredPieces > 0 || totalRevenue > 0 || totalAdSpend > 0;
  
  return {
    totalRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalProductChinaCost,
    totalShippingCost,
    totalCost,
    profit,
    totalDeliveredPieces,
    totalDeliveredOrders,
    totalOrders: deliveryData.totalOrders,
    deliveryRate: deliveryData.deliveryRate,
    costPerDeliveredOrder,
    costPerDeliveredPiece,
    adCostPerDeliveredOrder,
    adCostPerDeliveredPiece,
    boxleoPerDeliveredOrder,
    boxleoPerDeliveredPiece,
    averageOrderValue,
    isProfitable: profit > 0,
    hasData: hasData
  };
}

// Authentication
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

// Meta data
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

// Countries
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

// Products
app.get('/api/products', requireAuth, (req, res) => {
  const db = loadDB();
  const products = (db.products || []).map(product => {
    // FIXED: Use lifetime data to determine profitability for product list
    const metrics = calculateProfitMetrics(db, product.id, null, '2000-01-01', '2100-01-01');
    
    // FIXED: Ensure isProfitable and hasData are properly set
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
    sku: req.body.sku || '',
    createdAt: new Date().toISOString()
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

// Product Prices
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

// Product Notes
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

// Product Orders with duplicate check
app.get('/api/product-orders', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, country, start, end, page = 1, limit = 8 } = req.query || {};
  let orders = db.productOrders || [];

  if (productId) orders = orders.filter(o => o.productId === productId);
  if (country) orders = orders.filter(o => o.country === country);
  if (start) orders = orders.filter(o => o.startDate >= start);
  if (end) orders = orders.filter(o => o.endDate <= end);

  // Sort by date (newest first)
  orders.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  // Pagination
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
  const db = loadDB(); db.productOrders = db.productOrders || [];
  const { productId, country, startDate, endDate, orders } = req.body || {};
  if (!productId || !country || !startDate || !endDate) return res.status(400).json({ error: 'Missing fields' });

  // Check for existing orders in the same period
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

  saveDB(db); res.json({ ok: true });
});

// Force add product orders (bypass duplicate check)
app.post('/api/product-orders/force', requireAuth, (req, res) => {
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

app.delete('/api/product-orders/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.productOrders = (db.productOrders || []).filter(o => o.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// Brainstorming
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

// Tested Products
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

// FIXED: Product Costs Analysis with "all" option - NOW USING PERIOD COSTS FOR THIS SPECIFIC ENDPOINT ONLY
app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};

  if (productId === 'all') {
    const products = db.products || [];
    const allMetrics = products.map(product => {
      const metrics = calculateProfitMetricsForPeriod(db, product.id, null, start, end);
      return {
        productId: product.id,
        productName: product.name,
        ...metrics
      };
    });

    const totals = allMetrics.reduce((acc, metrics) => {
      acc.totalRevenue += metrics.totalRevenue;
      acc.totalAdSpend += metrics.totalAdSpend;
      acc.totalBoxleoFees += metrics.totalBoxleoFees;
      acc.totalProductChinaCost += metrics.totalProductChinaCost;
      acc.totalShippingCost += metrics.totalShippingCost;
      acc.totalCost += metrics.totalCost;
      acc.profit += metrics.profit;
      acc.totalDeliveredPieces += metrics.totalDeliveredPieces;
      acc.totalDeliveredOrders += metrics.totalDeliveredOrders;
      acc.totalOrders += metrics.totalOrders;
      return acc;
    }, {
      totalRevenue: 0,
      totalAdSpend: 0,
      totalBoxleoFees: 0,
      totalProductChinaCost: 0,
      totalShippingCost: 0,
      totalCost: 0,
      profit: 0,
      totalDeliveredPieces: 0,
      totalDeliveredOrders: 0,
      totalOrders: 0
    });

    const deliveryData = calculateDeliveryRate(db, null, null, start, end);

    res.json({
      ...totals,
      deliveryRate: deliveryData.deliveryRate,
      isAggregate: true,
      productCount: products.length
    });
  } else {
    const metrics = calculateProfitMetricsForPeriod(db, productId, null, start, end);
    const deliveryData = calculateDeliveryRate(db, productId, null, start, end);

    res.json({
      ...metrics,
      deliveryRate: deliveryData.deliveryRate,
      totalOrders: deliveryData.totalOrders,
      totalDeliveredPieces: deliveryData.totalDeliveredPieces
    });
  }
});

// Ad Spend
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

// Deliveries
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

// Shipments with single arrival prompt
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

// Remittances with duplicate checking and pagination
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); let list = db.remittances || [];
  const { start, end, country, productId, page = 1, limit = 8 } = req.query || {};
  if (start) list = list.filter(r => r.start >= start);
  if (end) list = list.filter(r => r.end <= end);
  if (country) list = list.filter(r => r.country === country);
  if (productId) list = list.filter(r => r.productId === productId);

  // Sort by date (newest first)
  list.sort((a, b) => new Date(b.start) - new Date(a.start));

  // Pagination
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
  const db = loadDB(); db.remittances = db.remittances || [];
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

  db.remittances.push(r); saveDB(db); res.json({ ok: true, remittance: r });
});

// Force add remittance (bypass duplicate check)
app.post('/api/remittances/force', requireAuth, (req, res) => {
  const db = loadDB(); db.remittances = db.remittances || [];
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

  db.remittances.push(r); saveDB(db); res.json({ ok: true, remittance: r });
});

app.delete('/api/remittances/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// Finance Categories
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

// Finance Entries
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

// Influencers
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

// Influencer Spend
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

// FIXED: Enhanced Analytics with proper cost calculation - RESTORED ORIGINAL FUNCTION FOR MOST ENDPOINTS
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

  analytics.sort((a, b) => b.totalDeliveredPieces - a.totalDeliveredPieces);

  res.json({ analytics });
});

// FIXED: Profit by Country with proper cost calculation - RESTORED ORIGINAL FUNCTION
app.get('/api/analytics/profit-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country } = req.query || {};

  const analytics = {};
  const countries = country ? [country] : (db.countries || []).filter(c => c !== 'china');

  countries.forEach(c => {
    const metrics = calculateProfitMetrics(db, null, c, start, end);
    analytics[c] = metrics;
  });

  res.json({ analytics });
});

// Product Info with enhanced cost calculations
app.get('/api/product-info/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const productId = req.params.id;
  const product = db.products.find(p => p.id === productId);
  
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const prices = db.productSellingPrices.filter(sp => sp.productId === productId);
  const countries = db.countries.filter(c => c !== 'china');
  
  const analysis = countries.map(country => {
    const price = prices.find(p => p.country === country);
    const productCosts = calculateProductCosts(db, productId, country);
    const deliveryData = calculateDeliveryRate(db, productId, country, '2000-01-01', '2100-01-01');
    
    const sellingPrice = price ? price.price : 0;
    const productCostChina = productCosts.chinaCostPerPiece || 0;
    const shippingCost = productCosts.shippingCostPerPiece || 0;
    const totalProductCost = productCostChina + shippingCost;
    const availableForProfitAndAds = sellingPrice - totalProductCost;
    const deliveryRate = deliveryData.deliveryRate || 0;
    const maxCPL = deliveryRate > 0 ? availableForProfitAndAds * (deliveryRate / 100) : 0;

    return {
      country,
      sellingPrice,
      productCostChina,
      shippingCost,
      totalProductCost,
      availableForProfitAndAds,
      deliveryRate,
      maxCPL
    };
  });

  res.json({
    product,
    prices: prices,
    costAnalysis: analysis
  });
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
    const snapshotFile = path.join(SNAPSHOT_DIR, `${stamp}-${snapshotName.replace(/\s+/g, '_')}.json`);
    
    await fs.copy(DATA_FILE, snapshotFile);
    
    const snapshotEntry = {
      id: uuidv4(),
      name: snapshotName,
      file: snapshotFile,
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

// Routes
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log('✅ EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
});
