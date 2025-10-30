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

// FIXED: Enhanced database initialization
function ensureDB() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('🔄 Creating initial database...');
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
    console.log('✅ Database created with password: eastafricashop');
  } else {
    console.log('✅ Database already exists');
    
    // Verify the database structure
    try {
      const db = fs.readJsonSync(DATA_FILE);
      if (!db.password) {
        console.log('🔄 Adding missing password to existing database...');
        db.password = 'eastafricashop';
        fs.writeJsonSync(DATA_FILE, db, { spaces: 2 });
        console.log('✅ Password added to existing database');
      }
    } catch (error) {
      console.error('❌ Error reading existing database:', error);
    }
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

// FIXED: Enhanced authentication with better error handling
app.post('/api/auth', (req, res) => {
  try {
    const { password } = req.body || {};
    const db = loadDB();
    
    console.log('🔐 Auth attempt received');
    console.log('Input password:', password ? '***' : 'empty');
    console.log('Stored password:', db.password ? '***' : 'missing');
    
    // Handle logout
    if (password === 'logout') {
      res.clearCookie('auth', { 
        httpOnly: true, 
        sameSite: 'Lax', 
        secure: false, 
        path: '/' 
      });
      console.log('🚪 User logged out');
      return res.json({ ok: true });
    }
    
    // Check password
    if (password && password === db.password) {
      res.cookie('auth', '1', { 
        httpOnly: true, 
        sameSite: 'Lax', 
        secure: false, 
        path: '/', 
        maxAge: 365 * 24 * 60 * 60 * 1000 
      });
      console.log('✅ Login successful');
      return res.json({ ok: true });
    }
    
    console.log('❌ Wrong password');
    return res.status(403).json({ error: 'Wrong password' });
  } catch (error) {
    console.error('❌ Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

// FIXED: Meta endpoint to check auth status
app.get('/api/meta', (req, res) => {
  try {
    const db = loadDB();
    const requiresAuth = req.cookies.auth !== '1';
    
    console.log('🔍 Meta check - requiresAuth:', requiresAuth);
    console.log('Auth cookie:', req.cookies.auth);
    
    res.json({ 
      countries: db.countries || [],
      requiresAuth: requiresAuth
    });
  } catch (error) {
    console.error('❌ Meta endpoint error:', error);
    res.status(500).json({ error: 'Failed to load meta data' });
  }
});

// FIXED: Add password reset endpoint for development
app.post('/api/reset-password', (req, res) => {
  try {
    const { newPassword } = req.body || {};
    const db = loadDB();
    
    if (!newPassword) {
      return res.status(400).json({ error: 'New password required' });
    }
    
    db.password = newPassword;
    saveDB(db);
    
    console.log('✅ Password reset to:', newPassword);
    res.json({ ok: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('❌ Password reset error:', error);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// FIXED: Add endpoint to check current password
app.get('/api/debug-password', (req, res) => {
  try {
    const db = loadDB();
    res.json({ 
      hasPassword: !!db.password,
      passwordLength: db.password ? db.password.length : 0,
      passwordHint: db.password ? `Starts with: ${db.password.charAt(0)}...` : 'No password'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

// ... (rest of your existing routes and functions remain the same)

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

// ... (rest of your existing code continues)

// Routes
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.listen(PORT, () => {
  console.log('✅ EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
  console.log('🔐 Default password: eastafricashop');
  console.log('💡 Use /api/debug-password to check current password');
  console.log('💡 Use POST /api/reset-password with {"newPassword":"yourpassword"} to reset');
});
