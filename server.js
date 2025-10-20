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

fs.ensureDirSync(PERSIST_DIR);
fs.ensureDirSync(SNAPSHOT_DIR);

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

// ======== ENHANCED STOCK CALCULATION FUNCTIONS ========
function calculateProductStock(db, productId, country) {
  const shipments = db.shipments || [];
  const remittances = db.remittances || [];
  const refunds = db.refunds || [];
  
  let stock = 0;
  
  // Add arrived shipments to this country
  shipments.filter(s => 
    s.productId === productId && 
    s.toCountry === country && 
    s.arrivedAt
  ).forEach(s => stock += (+s.qty || 0));
  
  // Remove shipments from this country
  shipments.filter(s => 
    s.productId === productId && 
    s.fromCountry === country && 
    s.arrivedAt
  ).forEach(s => stock -= (+s.qty || 0));
  
  // Remove remittances (delivered pieces)
  remittances.filter(r => 
    r.productId === productId && 
    r.country === country
  ).forEach(r => stock -= (+r.pieces || 0));
  
  // Add refunded pieces back to stock
  refunds.filter(r => 
    r.productId === productId && 
    r.country === country
  ).forEach(r => stock += (+r.piecesRefunded || 0));
  
  return stock;
}

function calculateProductTransit(db, productId) {
  const shipments = db.shipments || [];
  return shipments.filter(s => 
    s.productId === productId && 
    !s.arrivedAt
  ).reduce((sum, s) => sum + (+s.qty || 0), 0);
}

function calculateTotalStock(db, productId) {
  const countries = db.countries.filter(c => c !== 'china');
  let totalStock = 0;
  
  countries.forEach(country => {
    totalStock += calculateProductStock(db, productId, country);
  });
  
  const transitPieces = calculateProductTransit(db, productId);
  
  return {
    totalStock,
    transitPieces,
    totalIncludingTransit: totalStock + transitPieces
  };
}

// ======== ENHANCED TRANSIT CALCULATIONS ========
function calculateTransitFromChina(db) {
  const shipments = db.shipments || [];
  return shipments.filter(s => 
    s.fromCountry === 'china' && 
    !s.arrivedAt
  ).reduce((sum, s) => sum + (+s.qty || 0), 0);
}

function calculateTransitBetweenCountries(db) {
  const shipments = db.shipments || [];
  return shipments.filter(s => 
    s.fromCountry !== 'china' && 
    s.toCountry !== 'china' && 
    !s.arrivedAt
  ).reduce((sum, s) => sum + (+s.qty || 0), 0);
}

function calculateActiveStock(db) {
  const products = db.products || [];
  const activeProducts = products.filter(p => p.status === 'active');
  let totalActiveStock = 0;
  
  activeProducts.forEach(product => {
    const countries = db.countries.filter(c => c !== 'china');
    countries.forEach(country => {
      totalActiveStock += calculateProductStock(db, product.id, country);
    });
  });
  
  return totalActiveStock;
}

function calculateInactiveStock(db) {
  const products = db.products || [];
  const inactiveProducts = products.filter(p => p.status === 'paused');
  let totalInactiveStock = 0;
  
  inactiveProducts.forEach(product => {
    const countries = db.countries.filter(c => c !== 'china');
    countries.forEach(country => {
      totalInactiveStock += calculateProductStock(db, product.id, country);
    });
  });
  
  return totalInactiveStock;
}

// ======== ENHANCED COST CALCULATION WITH REFUNDS AND INFLUENCER SPENDS ========
function calculateProfitMetrics(db, productId = null, country = null, startDate = null, endDate = null) {
  const remittances = db.remittances || [];
  const adSpends = db.adspend || [];
  const refunds = db.refunds || [];
  const influencerSpends = db.influencerSpends || [];

  let totalRevenue = 0;
  let totalAdSpend = 0;
  let totalBoxleoFees = 0;
  let totalDeliveredPieces = 0;
  let totalDeliveredOrders = 0;
  let totalRefundAmount = 0;
  let totalRefundedPieces = 0;
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

  // Add ad spends
  adSpends.forEach(ad => {
    if ((!productId || ad.productId === productId) &&
        (!country || ad.country === country) &&
        (!startDate || true) && (!endDate || true)) {
      totalAdSpend += +ad.amount || 0;
    }
  });

  // Add refunds
  refunds.forEach(refund => {
    if ((!productId || refund.productId === productId) &&
        (!country || refund.country === country) &&
        (!startDate || refund.date >= startDate) &&
        (!endDate || refund.date <= endDate)) {
      totalRefundAmount += +refund.amount || 0;
      totalRefundedPieces += +refund.piecesRefunded || 0;
    }
  });

  // Add influencer spends
  influencerSpends.forEach(spend => {
    if ((!productId || spend.productId === productId) &&
        (!country || spend.country === country) &&
        (!startDate || spend.date >= startDate) &&
        (!endDate || spend.date <= endDate)) {
      totalInfluencerSpend += +spend.amount || 0;
    }
  });

  // Calculate product costs
  let totalProductChinaCost = 0;
  let totalShippingCost = 0;

  if (productId) {
    const productCosts = calculateProductCostsForPeriod(db, productId, startDate, endDate);
    if (totalDeliveredPieces > 0) {
      if (country) {
        const countryCosts = calculateProductCosts(db, productId, country);
        totalProductChinaCost = totalDeliveredPieces * (countryCosts.chinaCostPerPiece || 0);
        totalShippingCost = totalDeliveredPieces * (countryCosts.shippingCostPerPiece || 0);
      } else {
        totalProductChinaCost = totalDeliveredPieces * (productCosts.chinaCostPerPiece || 0);
        totalShippingCost = totalDeliveredPieces * (productCosts.shippingCostPerPiece || 0);
      }
    }
  }

  // Adjust revenue for refunds
  const adjustedRevenue = totalRevenue - totalRefundAmount;
  const totalCost = totalProductChinaCost + totalShippingCost + totalAdSpend + totalBoxleoFees + totalInfluencerSpend;
  const profit = adjustedRevenue - totalCost;
  
  const deliveryData = calculateDeliveryRate(db, productId, country, startDate, endDate);

  const costPerDeliveredOrder = totalDeliveredOrders > 0 ? totalCost / totalDeliveredOrders : 0;
  const costPerDeliveredPiece = totalDeliveredPieces > 0 ? totalCost / totalDeliveredPieces : 0;
  const adCostPerDeliveredOrder = totalDeliveredOrders > 0 ? totalAdSpend / totalDeliveredOrders : 0;
  const adCostPerDeliveredPiece = totalDeliveredPieces > 0 ? totalAdSpend / totalDeliveredPieces : 0;
  const boxleoPerDeliveredOrder = totalDeliveredOrders > 0 ? totalBoxleoFees / totalDeliveredOrders : 0;
  const boxleoPerDeliveredPiece = totalDeliveredPieces > 0 ? totalBoxleoFees / totalDeliveredPieces : 0;
  const influencerPerDeliveredOrder = totalDeliveredOrders > 0 ? totalInfluencerSpend / totalDeliveredOrders : 0;
  const influencerPerDeliveredPiece = totalDeliveredPieces > 0 ? totalInfluencerSpend / totalDeliveredPieces : 0;
  const averageOrderValue = totalDeliveredOrders > 0 ? adjustedRevenue / totalDeliveredOrders : 0;

  const hasData = totalDeliveredPieces > 0 || adjustedRevenue > 0 || totalAdSpend > 0;
  
  return {
    totalRevenue: adjustedRevenue,
    originalRevenue: totalRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalProductChinaCost,
    totalShippingCost,
    totalInfluencerSpend,
    totalRefundAmount,
    totalRefundedPieces,
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
    influencerPerDeliveredOrder,
    influencerPerDeliveredPiece,
    averageOrderValue,
    isProfitable: profit > 0,
    hasData: hasData
  };
}

// ======== EXISTING COST CALCULATION FUNCTIONS ========
function calculateProductCosts(db, productId, targetCountry = null) {
  const shipments = db.shipments || [];
  const arrivedShipments = shipments.filter(s => 
    s.productId === productId && s.arrivedAt && s.paidAt
  );

  let totalPiecesFromChina = 0;
  let totalChinaCost = 0;
  let totalShippingCostFromChina = 0;
  const countryCosts = {};

  arrivedShipments.forEach(shipment => {
    if (shipment.fromCountry === 'china') {
      const pieces = +shipment.qty || 0;
      const chinaCost = +shipment.chinaCost || 0;
      const shippingCost = +shipment.shipCost || 0;
      const toCountry = shipment.toCountry;

      totalPiecesFromChina += pieces;
      totalChinaCost += chinaCost;
      totalShippingCostFromChina += shippingCost;

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

  let hasChanges = true;
  while (hasChanges) {
    hasChanges = false;
    arrivedShipments.forEach(shipment => {
      if (shipment.fromCountry !== 'china') {
        const fromCountry = shipment.fromCountry;
        const toCountry = shipment.toCountry;
        const pieces = +shipment.qty || 0;
        const shippingCost = +shipment.shipCost || 0;

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

function calculateProductCostsForPeriod(db, productId, startDate = null, endDate = null) {
  const shipments = db.shipments || [];
  const periodShipments = shipments.filter(s => 
    s.productId === productId && 
    s.arrivedAt &&
    s.paidAt &&
    (!startDate || s.arrivedAt >= startDate) &&
    (!endDate || s.arrivedAt <= endDate)
  );

  let totalChinaCost = 0;
  let totalShippingCost = 0;
  let totalPieces = 0;

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

// ======== STARTUP BACKUP FUNCTION ========
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

// ======== DAILY AUTO-BACKUP SYSTEM ========
async function checkAndCreateDailyBackup() {
  try {
    const db = loadDB();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const dailyBackupName = `Daily-${today}`;
    
    const existingBackup = db.snapshots.find(snap => 
      snap.name && snap.name.startsWith('Daily-') && snap.name.includes(today)
    );
    
    if (!existingBackup) {
      const snapshotFileName = `auto-daily-${today}.json`;
      
      await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, snapshotFileName));
      
      const backupEntry = {
        id: uuidv4(),
        name: dailyBackupName,
        file: snapshotFileName,
        createdAt: new Date().toISOString(),
        kind: 'auto-daily'
      };
      
      db.snapshots.unshift(backupEntry);
      
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      db.snapshots = db.snapshots.filter(snapshot => {
        if (snapshot.name && snapshot.name.startsWith('Daily-')) {
          const snapshotDate = new Date(snapshot.createdAt);
          return snapshotDate >= sevenDaysAgo;
        }
        return true;
      });
      
      saveDB(db);
      console.log(`✅ Auto-created daily backup: ${dailyBackupName}`);
    }
  } catch (error) {
    console.error('❌ Auto-backup error:', error.message);
  }
}

// ======== AUTHENTICATION ========
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

// ======== META DATA ========
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ countries: db.countries || [] });
});

// ======== ENHANCED DASHBOARD OVERVIEW ========
app.get('/api/dashboard/overview', requireAuth, (req, res) => {
  const db = loadDB();
  
  const transitFromChina = calculateTransitFromChina(db);
  const transitBetweenCountries = calculateTransitBetweenCountries(db);
  const activeStock = calculateActiveStock(db);
  const inactiveStock = calculateInactiveStock(db);
  
  res.json({
    transitFromChina,
    transitBetweenCountries,
    activeStock,
    inactiveStock
  });
});

// ======== ENHANCED PRODUCTS WITH STOCK INFORMATION ========
app.get('/api/products', requireAuth, async (req, res) => { 
  await checkAndCreateDailyBackup();
  const db = loadDB();
  const products = (db.products || []).map(product => {
    const metrics = calculateProfitMetrics(db, product.id, null, '2000-01-01', '2100-01-01');
    const stockInfo = calculateTotalStock(db, product.id);
    
    // Calculate stock by country
    const stockByCountry = {};
    const countries = db.countries.filter(c => c !== 'china');
    countries.forEach(country => {
      stockByCountry[country] = calculateProductStock(db, product.id, country);
    });
    
    return {
      ...product,
      isProfitable: metrics.isProfitable,
      hasData: metrics.hasData,
      totalStock: stockInfo.totalStock,
      transitPieces: stockInfo.transitPieces,
      totalIncludingTransit: stockInfo.totalIncludingTransit,
      stockByCountry: stockByCountry
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
  db.refunds = (db.refunds || []).filter(r => r.productId !== id);
  db.influencerSpends = (db.influencerSpends || []).filter(sp => sp.productId !== id);
  saveDB(db);
  res.json({ ok: true });
});

// ======== PRODUCT PRICES ========
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

// ======== PRODUCT NOTES ========
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

// ======== PRODUCT ORDERS ========
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
  const db = loadDB(); db.productOrders = db.productOrders || [];
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

  saveDB(db); res.json({ ok: true });
});

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

// ======== BRAINSTORMING ========
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

// ======== TESTED PRODUCTS ========
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

// ======== AD SPEND ========
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

// ======== DELIVERIES ========
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

// ======== ENHANCED SHIPMENTS WITH PAYMENT TRACKING ========
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
    arrivedAt: req.body.arrivedAt || null,
    paidAt: null,
    estimatedCost: +req.body.shipCost || 0
  };
  if (!s.productId || !s.fromCountry || !s.toCountry) return res.status(400).json({ error: 'Missing fields' });
  db.shipments.push(s); saveDB(db); res.json({ ok: true, shipment: s });
});

app.put('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const up = req.body || {};
  
  // If shipment is paid, only allow note editing
  if (s.paidAt && (up.qty !== undefined || up.shipCost !== undefined || up.chinaCost !== undefined || up.departedAt !== undefined || up.arrivedAt !== undefined)) {
    return res.status(400).json({ error: 'Cannot edit paid shipment details' });
  }
  
  if (up.qty !== undefined) s.qty = +up.qty || 0;
  if (up.shipCost !== undefined) s.shipCost = +up.shipCost || 0;
  if (up.chinaCost !== undefined) s.chinaCost = +up.chinaCost || 0;
  if (up.note !== undefined) s.note = up.note;
  if (up.departedAt !== undefined) s.departedAt = up.departedAt;
  if (up.arrivedAt !== undefined) s.arrivedAt = up.arrivedAt;
  saveDB(db); res.json({ ok: true, shipment: s });
});

// Mark shipment as paid
app.post('/api/shipments/:id/pay', requireAuth, (req, res) => {
  const db = loadDB(); const s = (db.shipments || []).find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  if (s.paidAt) return res.status(400).json({ error: 'Shipment already paid' });
  
  const { finalCost } = req.body || {};
  if (finalCost !== undefined) s.shipCost = +finalCost || 0;
  s.paidAt = new Date().toISOString();
  
  saveDB(db); res.json({ ok: true, shipment: s });
});

app.delete('/api/shipments/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.shipments = (db.shipments || []).filter(x => x.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// ======== REMITTANCES ========
app.get('/api/remittances', requireAuth, (req, res) => {
  const db = loadDB(); let list = db.remittances || [];
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

// ======== REFUNDS MANAGEMENT ========
app.get('/api/refunds', requireAuth, (req, res) => {
  const db = loadDB(); let list = db.refunds || [];
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
  const db = loadDB(); db.refunds = db.refunds || [];
  const { date, country, productId, ordersRefunded, piecesRefunded, amount, reason } = req.body || {};
  
  if (!date || !country || !productId) return res.status(400).json({ error: 'Missing required fields' });

  const refund = {
    id: uuidv4(),
    date,
    country,
    productId,
    ordersRefunded: +ordersRefunded || 0,
    piecesRefunded: +piecesRefunded || 0,
    amount: +amount || 0,
    reason: reason || '',
    createdAt: new Date().toISOString()
  };

  db.refunds.push(refund); saveDB(db); res.json({ ok: true, refund });
});

app.delete('/api/refunds/:id', requireAuth, (req, res) => {
  const db = loadDB(); db.refunds = (db.refunds || []).filter(r => r.id !== req.params.id);
  saveDB(db); res.json({ ok: true });
});

// ======== FINANCE CATEGORIES ========
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

// ======== FINANCE ENTRIES ========
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

// ======== INFLUENCERS ========
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

// ======== INFLUENCER SPEND ========
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

// ======== ENHANCED ANALYTICS WITH REFUNDS AND INFLUENCER SPENDS ========
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

// ======== PRODUCT COSTS ANALYSIS ========
app.get('/api/product-costs-analysis', requireAuth, (req, res) => {
  const db = loadDB();
  const { productId, start, end } = req.query || {};

  if (productId === 'all') {
    const products = db.products || [];
    const allMetrics = products.map(product => {
      const metrics = calculateProfitMetrics(db, product.id, null, start, end);
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
      acc.totalRefundAmount += metrics.totalRefundAmount;
      acc.totalInfluencerSpend += metrics.totalInfluencerSpend;
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
      totalOrders: 0,
      totalRefundAmount: 0,
      totalInfluencerSpend: 0
    });

    const deliveryData = calculateDeliveryRate(db, null, null, start, end);

    res.json({
      ...totals,
      deliveryRate: deliveryData.deliveryRate,
      isAggregate: true,
      productCount: products.length
    });
  } else {
    const metrics = calculateProfitMetrics(db, productId, null, start, end);
    const deliveryData = calculateDeliveryRate(db, productId, null, start, end);

    res.json({
      ...metrics,
      deliveryRate: deliveryData.deliveryRate,
      totalOrders: deliveryData.totalOrders,
      totalDeliveredPieces: deliveryData.totalDeliveredPieces
    });
  }
});

// ======== PROFIT BY COUNTRY ========
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

// ======== ENHANCED COUNTRY STOCK CALCULATION (EXCLUDE PAUSED PRODUCTS) ========
app.get('/api/stock-by-country', requireAuth, (req, res) => {
  const db = loadDB();
  const per = {};
  const countries = db.countries.filter(c => c !== 'china');
  
  countries.forEach(c => {
    per[c] = {
      stock: 0,
      facebook: 0,
      tiktok: 0,
      google: 0,
      totalAd: 0
    };
  });

  try {
    const s = db.shipments || [];
    const r = db.remittances || [];
    const a = db.adspend || [];
    const products = db.products || [];

    // Only count stock for active products
    s.filter(x => x.arrivedAt).forEach(sp => {
      const product = products.find(p => p.id === sp.productId);
      if (!product || product.status !== 'active') return;
      
      const to = sp.toCountry, from = sp.fromCountry, qty = (+sp.qty || 0);
      if (to && countries.includes(to)) {
        per[to] = per[to] || { stock: 0, facebook: 0, tiktok: 0, google: 0, totalAd: 0 };
        per[to].stock += qty;
      }
      if (from && countries.includes(from)) {
        per[from] = per[from] || { stock: 0, facebook: 0, tiktok: 0, google: 0, totalAd: 0 };
        per[from].stock -= qty;
      }
    });

    r.forEach(x => {
      const product = products.find(p => p.id === x.productId);
      if (!product || product.status !== 'active') return;
      
      if (countries.includes(x.country)) {
        per[x.country] = per[x.country] || { stock: 0, facebook: 0, tiktok: 0, google: 0, totalAd: 0 };
        per[x.country].stock -= (+x.pieces || 0);
      }
    });

    a.forEach(x => {
      if (countries.includes(x.country)) {
        per[x.country] = per[x.country] || { stock: 0, facebook: 0, tiktok: 0, google: 0, totalAd: 0 };
        const amount = +x.amount || 0;
        if (x.platform === 'facebook') per[x.country].facebook += amount;
        else if (x.platform === 'tiktok') per[x.country].tiktok += amount;
        else if (x.platform === 'google') per[x.country].google += amount;
        per[x.country].totalAd += amount;
      }
    });
  } catch (error) {
    console.error('Error calculating stock by country:', error);
  }

  res.json({ stockByCountry: per });
});

// ======== COUNTRIES ========
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

// ======== ENHANCED PRODUCT INFO WITH REFUNDS ========
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

// ======== SNAPSHOTS ========
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

// ======== PUSH SNAPSHOT TO SYSTEM ========
app.post('/api/backup/push-snapshot', requireAuth, async (req, res) => {
  try {
    const { snapshotFile } = req.body || {};
    
    if (!snapshotFile) {
      return res.status(400).json({ error: 'Snapshot file required' });
    }

    const cleanFileName = path.basename(snapshotFile).replace(/\s+/g, '');
    const actualFilePath = path.join(SNAPSHOT_DIR, cleanFileName);
    
    if (!fs.existsSync(actualFilePath)) {
      return res.status(404).json({ 
        error: `Snapshot file not found: ${cleanFileName}`,
        details: {
          requestedFile: cleanFileName,
          snapshotDirectory: SNAPSHOT_DIR
        }
      });
    }

    const snapshotData = await fs.readJson(actualFilePath);
    await fs.writeJson(DATA_FILE, snapshotData, { spaces: 2 });
    
    res.json({ 
      ok: true, 
      message: 'Snapshot pushed successfully',
      snapshotFile: cleanFileName
    });
    
  } catch (error) {
    console.error('❌ Push snapshot error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ======== ROUTES ========
app.get('/product.html', (req, res) => res.sendFile(path.join(ROOT, 'product.html')));
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// ======== START SERVER ========
app.listen(PORT, async () => {
  await createStartupBackup();
  console.log('✅ Enhanced EAS Tracker listening on', PORT);
  console.log('DB:', DATA_FILE);
});
