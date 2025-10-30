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
      }
      
      // Continue tracing back to source
      traceShipmentCost(shipment.fromCountry, newAccumulatedCost, new Set(visited));
      if (foundPath) return;
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

// ENHANCED PROFIT CALCULATION - FIXED FOR PERFORMANCE MENU
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

  // ENHANCED COST CALCULATION FOR PERFORMANCE MENU
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  if (productId) {
    // For performance menu: Calculate costs based on DELIVERED pieces, not total shipments
    const productCostPerPiece = calculateProductCostPerPiece(db, productId);
    totalProductChinaCost = totalDeliveredPieces * productCostPerPiece;

    if (country) {
      // Single country: Use enhanced shipping cost calculation
      const shippingCostPerPiece = calculateShippingCostPerPiece(db, productId, country);
      totalShippingCost = totalDeliveredPieces * shippingCostPerPiece;
    } else {
      // All countries: Calculate weighted average shipping cost
      const countries = db.countries.filter(c => c !== 'china');
      let totalWeightedShipping = 0;
      
      countries.forEach(country => {
        const countryRemittances = remittances.filter(r => 
          r.productId === productId && 
          r.country === country &&
          (!startDate || r.start >= startDate) &&
          (!endDate || r.end <= endDate)
        );
        const countryPieces = countryRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
        const shippingCostPerPiece = calculateShippingCostPerPiece(db, productId, country);
        totalWeightedShipping += countryPieces * shippingCostPerPiece;
      });
      
      totalShippingCost = totalWeightedShipping;
    }
  } else {
    // For "All Products" - aggregate logic
    const products = db.products || [];
    products.forEach(product => {
      const productCostPerPiece = calculateProductCostPerPiece(db, product.id);
      const productRemittances = remittances.filter(r => 
        r.productId === product.id &&
        (!country || r.country === country) &&
        (!startDate || r.start >= startDate) &&
        (!endDate || r.end <= endDate)
      );
      const productDeliveredPieces = productRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
      
      totalProductChinaCost += productDeliveredPieces * productCostPerPiece;

      if (country) {
        const shippingCostPerPiece = calculateShippingCostPerPiece(db, product.id, country);
        totalShippingCost += productDeliveredPieces * shippingCostPerPiece;
      } else {
        // Calculate weighted shipping cost across all countries for this product
        const countries = db.countries.filter(c => c !== 'china');
        countries.forEach(country => {
          const countryRemittances = productRemittances.filter(r => r.country === country);
          const countryPieces = countryRemittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
          const shippingCostPerPiece = calculateShippingCostPerPiece(db, product.id, country);
          totalShippingCost += countryPieces * shippingCostPerPiece;
        });
      }
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

// ... (other routes remain the same until analytics endpoints)

// ENHANCED ANALYTICS ENDPOINTS - FIXED FOR PERFORMANCE MENU
app.get('/api/analytics/remittance', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, productId, sortBy = 'totalDeliveredPieces', sortOrder = 'desc' } = req.query || {};

  let analytics = [];
  
  if (productId && productId !== 'all') {
    if (country && country !== '') {
      // Single product, single country
      const metrics = calculateProfitMetrics(db, productId, country, start, end);
      analytics = [{
        productId,
        productName: (db.products.find(p => p.id === productId) || {}).name || productId,
        country: country,
        ...metrics
      }];
    } else {
      // Single product, all countries
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
    // Multiple products
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

  // Apply sorting
  analytics.sort((a, b) => {
    let aValue, bValue;
    
    switch(sortBy) {
      case 'productName':
        aValue = a.productName || '';
        bValue = b.productName || '';
        return sortOrder === 'desc' ? bValue.localeCompare(aValue) : aValue.localeCompare(bValue);
      case 'country':
        aValue = a.country || '';
        bValue = b.country || '';
        return sortOrder === 'desc' ? bValue.localeCompare(aValue) : aValue.localeCompare(bValue);
      case 'profit':
        aValue = a.profit || 0;
        bValue = b.profit || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      case 'totalRevenue':
        aValue = a.totalRevenue || 0;
        bValue = b.totalRevenue || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      case 'totalDeliveredPieces':
      default:
        aValue = a.totalDeliveredPieces || 0;
        bValue = b.totalDeliveredPieces || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    }
  });

  res.json({ analytics });
});

app.get('/api/analytics/profit-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const { start, end, country, sortBy = 'totalDeliveredPieces', sortOrder = 'desc' } = req.query || {};

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

  // Apply sorting
  analyticsArray.sort((a, b) => {
    let aValue, bValue;
    
    switch(sortBy) {
      case 'country':
        aValue = a.country || '';
        bValue = b.country || '';
        return sortOrder === 'desc' ? bValue.localeCompare(aValue) : aValue.localeCompare(bValue);
      case 'profit':
        aValue = a.profit || 0;
        bValue = b.profit || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      case 'totalRevenue':
        aValue = a.totalRevenue || 0;
        bValue = b.totalRevenue || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
      case 'totalDeliveredPieces':
      default:
        aValue = a.totalDeliveredPieces || 0;
        bValue = b.totalDeliveredPieces || 0;
        return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    }
  });

  res.json({ analytics: analyticsArray });
});

// ENHANCED PRODUCT COSTS ANALYSIS - FIXED FOR PERFORMANCE MENU
app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};
  
  let metrics;
  if (productId === 'all') {
    // Calculate aggregate metrics for all products using ENHANCED logic
    metrics = calculateProfitMetrics(db, null, null, start, end);
    metrics.isAggregate = true;
    metrics.productCount = db.products.length;
    
    // Add additional aggregate calculations
    const allRemittances = db.remittances || [];
    const allRefunds = db.refunds || [];
    const allAdspend = db.adspend || [];
    const allInfluencerSpends = db.influencerSpends || [];
    
    // Filter by date range
    const filteredRemittances = allRemittances.filter(r => 
      (!start || r.start >= start) && (!end || r.end <= end)
    );
    const filteredRefunds = allRefunds.filter(rf => 
      (!start || rf.date >= start) && (!end || rf.date <= end)
    );
    const filteredAdspend = allAdspend.filter(ad => 
      (!start || ad.date >= start) && (!end || ad.date <= end)
    );
    const filteredInfluencerSpends = allInfluencerSpends.filter(is => 
      (!start || is.date >= start) && (!end || is.date <= end)
    );
    
    // Calculate totals
    metrics.totalRemittances = filteredRemittances.length;
    metrics.totalRefunds = filteredRefunds.length;
    metrics.totalAdSpendEntries = filteredAdspend.length;
    metrics.totalInfluencerSpendEntries = filteredInfluencerSpends.length;
    
  } else {
    // Single product analysis
    metrics = calculateProfitMetrics(db, productId, null, start, end);
    metrics.isAggregate = false;
    metrics.productCount = 1;
    
    // Add product-specific details
    const product = db.products.find(p => p.id === productId);
    if (product) {
      metrics.productName = product.name;
      metrics.productSku = product.sku;
      metrics.productStatus = product.status;
    }
    
    // Calculate shipping costs by country for this product
    const countries = db.countries.filter(c => c !== 'china');
    metrics.shippingCostsByCountry = {};
    
    countries.forEach(country => {
      const shippingCostPerPiece = calculateShippingCostPerPiece(db, productId, country);
      metrics.shippingCostsByCountry[country] = shippingCostPerPiece;
    });
  }
  
  res.json(metrics);
});

// ENHANCED PRODUCT INFO ENDPOINT - FIXED FOR PRODUCTS MENU
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
    
    // Use ENHANCED cost calculation logic
    const productCostPerPiece = calculateProductCostPerPiece(db, productId);
    const shippingCostPerPiece = calculateShippingCostPerPiece(db, productId, country);
    
    const sellingPrice = price ? +price.price : 0;
    const productCostChina = productCostPerPiece;
    const shippingCost = shippingCostPerPiece;
    
    const totalCost = productCostChina + shippingCost + boxleoPerOrder;
    const availableForProfitAndAds = sellingPrice - totalCost;
    
    // Get delivery rate for this country
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
    totalDeliveredOrders: totalDeliveredOrders,
    // Add enhanced cost information
    averageProductCostPerPiece: calculateProductCostPerPiece(db, productId),
    shippingCostsByCountry: analysis.reduce((acc, item) => {
      acc[item.country] = item.shippingCost;
      return acc;
    }, {})
  });
});

// ... (rest of the routes remain the same)

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
