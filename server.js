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
const PERSIST_DIR = process.env.RENDER ? '/opt/render/project/src/data' : path.join(ROOT, 'data');
const DATA_FILE = path.join(PERSIST_DIR, 'db.json');
const SNAPSHOT_DIR = path.join(PERSIST_DIR, 'snapshots');

// Enhanced directory initialization
async function initializeDirectories() {
  try {
    await fs.ensureDir(PERSIST_DIR);
    await fs.ensureDir(SNAPSHOT_DIR);
    console.log('✅ Directories initialized successfully');
    
    // Ensure data file exists with proper structure
    await ensureDB();
    
    return true;
  } catch (error) {
    console.error('❌ Directory initialization failed:', error);
    return false;
  }
}

// Enhanced middleware setup
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Serve static files with proper caching
app.use('/public', express.static(path.join(ROOT, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Enhanced CORS for development and production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // Allow specific origins or all in development
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('.render.com'))) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Enhanced authentication middleware
function requireAuth(req, res, next) {
  console.log('🔐 Auth check - Path:', req.path);
  console.log('🔐 Auth check - Cookies:', req.cookies);
  console.log('🔐 Auth check - Auth cookie:', req.cookies?.auth);
  
  // Allow health check without auth
  if (req.path === '/api/health' || req.path === '/api/auth/status') {
    return next();
  }
  
  if (req.cookies?.auth === '1') {
    console.log('✅ User authenticated');
    return next();
  }
  
  console.log('❌ User not authenticated - redirecting to login');
  return res.status(401).json({ 
    error: 'Authentication required',
    code: 'AUTH_REQUIRED',
    message: 'Please log in to access this resource'
  });
}

// Apply auth middleware to all API routes except auth endpoints
app.use('/api', (req, res, next) => {
  if (req.path === '/auth' || req.path === '/auth/status' || req.path === '/health') {
    return next();
  }
  requireAuth(req, res, next);
});

// Enhanced database functions
async function ensureDB() {
  try {
    const dbExists = await fs.pathExists(DATA_FILE);
    
    if (!dbExists) {
      console.log('📁 Creating new database file...');
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
      
      await fs.writeJson(DATA_FILE, initialData, { spaces: 2 });
      console.log('✅ New database created with initial structure');
    } else {
      console.log('✅ Database file exists');
      
      // Validate and repair database structure if needed
      const db = await fs.readJson(DATA_FILE);
      let needsRepair = false;
      
      // Ensure all required top-level fields exist
      const requiredFields = [
        'password', 'countries', 'products', 'productNotes', 'productSellingPrices',
        'productOrders', 'brainstorming', 'testedProducts', 'adspend', 'deliveries',
        'shipments', 'remittances', 'refunds', 'finance', 'influencers', 'influencerSpends',
        'snapshots', 'todos', 'weeklyTodos'
      ];
      
      for (const field of requiredFields) {
        if (db[field] === undefined) {
          console.log(`⚠️  Missing field ${field}, adding...`);
          if (field === 'finance') {
            db[field] = { categories: { debit: [], credit: [] }, entries: [] };
          } else if (field === 'password') {
            db[field] = 'eastafricashop';
          } else {
            db[field] = [];
          }
          needsRepair = true;
        }
      }
      
      // Ensure finance structure
      if (!db.finance.categories) {
        db.finance.categories = { debit: [], credit: [] };
        needsRepair = true;
      }
      if (!db.finance.entries) {
        db.finance.entries = [];
        needsRepair = true;
      }
      
      if (needsRepair) {
        console.log('🔧 Repairing database structure...');
        await fs.writeJson(DATA_FILE, db, { spaces: 2 });
        console.log('✅ Database structure repaired');
      }
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function loadDB() { 
  try {
    await ensureDB();
    const db = await fs.readJson(DATA_FILE);
    console.log('📊 Database loaded successfully');
    return db;
  } catch (error) {
    console.error('❌ Database load failed:', error);
    throw error;
  }
}

async function saveDB(db) { 
  try {
    await fs.writeJson(DATA_FILE, db, { spaces: 2 });
    console.log('💾 Database saved successfully');
    return true;
  } catch (error) {
    console.error('❌ Database save failed:', error);
    throw error;
  }
}

// Enhanced authentication endpoints
app.post('/api/auth', async (req, res) => {
  try {
    const { password } = req.body || {};
    console.log('🔐 Auth attempt received');
    
    // Input validation
    if (!password && password !== 'logout') {
      return res.status(400).json({ 
        error: 'Password required',
        code: 'PASSWORD_REQUIRED'
      });
    }
    
    const db = await loadDB();
    
    // Handle logout
    if (password === 'logout') {
      res.clearCookie('auth', { 
        httpOnly: true, 
        sameSite: 'lax', 
        secure: process.env.NODE_ENV === 'production',
        path: '/' 
      });
      
      console.log('✅ User logged out successfully');
      return res.json({ 
        ok: true, 
        message: 'Logged out successfully',
        requiresReload: true 
      });
    }
    
    // Verify password
    if (password === db.password) {
      // Set secure cookie
      res.cookie('auth', '1', { 
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
      });
      
      console.log('✅ Login successful');
      return res.json({ 
        ok: true, 
        message: 'Login successful',
        requiresReload: true
      });
    } else {
      console.log('❌ Login failed - wrong password');
      return res.status(401).json({ 
        error: 'Wrong password',
        code: 'WRONG_PASSWORD',
        message: 'The password you entered is incorrect.' 
      });
    }
    
  } catch (error) {
    console.error('🔐 Auth error:', error);
    res.status(500).json({ 
      error: 'Server error during authentication',
      code: 'SERVER_ERROR',
      details: error.message 
    });
  }
});

app.get('/api/auth/status', async (req, res) => {
  try {
    console.log('🔐 Auth status check - cookies:', req.cookies);
    
    if (req.cookies?.auth === '1') {
      return res.json({ 
        authenticated: true,
        message: 'User is authenticated'
      });
    } else {
      return res.status(401).json({ 
        authenticated: false,
        error: 'Not authenticated'
      });
    }
  } catch (error) {
    console.error('🔐 Auth status error:', error);
    res.status(500).json({ 
      error: 'Server error checking authentication status',
      details: error.message 
    });
  }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await loadDB();
    res.json({ 
      status: 'OK', 
      message: 'Server is running correctly',
      timestamp: new Date().toISOString(),
      database: 'Connected',
      version: '2.0.0'
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR', 
      message: 'Server has issues',
      error: error.message 
    });
  }
});

// Meta data
app.get('/api/meta', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ 
      countries: db.countries || [],
      version: '2.0.0'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Products endpoints
app.get('/api/products', async (req, res) => { 
  try {
    const db = await loadDB();
    const products = db.products || [];
    
    // Calculate additional metrics for each product
    const enhancedProducts = products.map(product => {
      // Calculate stock by country
      const stockByCountry = {};
      (db.countries || []).filter(c => c !== 'china').forEach(country => {
        stockByCountry[country] = calculateProductStock(db, product.id, country);
      });
      
      // Calculate ad spend by country
      const adSpendByCountry = {};
      (db.adspend || []).filter(ad => ad.productId === product.id).forEach(ad => {
        if (!adSpendByCountry[ad.country]) {
          adSpendByCountry[ad.country] = { facebook: 0, tiktok: 0, google: 0 };
        }
        adSpendByCountry[ad.country][ad.platform] += (+ad.amount || 0);
      });
      
      // Calculate transit pieces
      const transitPieces = calculateTransitPieces(db, product.id).totalTransit;
      const totalStock = Object.values(stockByCountry).reduce((sum, qty) => sum + qty, 0);
      
      return {
        ...product,
        stockByCountry,
        adSpendByCountry,
        transitPieces,
        totalStock,
        totalPiecesIncludingTransit: totalStock + transitPieces
      };
    });

    res.json({ products: enhancedProducts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.products = db.products || [];
    
    const { name, sku } = req.body || {};
    
    if (!name) {
      return res.status(400).json({ error: 'Product name required' });
    }

    const product = {
      id: uuidv4(),
      status: 'active',
      name: name.trim(),
      sku: (sku || '').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    db.products.push(product); 
    await saveDB(db); 
    
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const product = (db.products || []).find(p => p.id === req.params.id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const { name, sku } = req.body || {};
    
    if (name !== undefined) product.name = name.trim();
    if (sku !== undefined) product.sku = sku.trim();
    product.updatedAt = new Date().toISOString();
    
    await saveDB(db); 
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/:id/status', async (req, res) => {
  try {
    const db = await loadDB(); 
    const product = (db.products || []).find(p => p.id === req.params.id);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const { status } = req.body || {};
    const validStatuses = ['active', 'paused'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Valid status required: active or paused' });
    }
    
    product.status = status;
    product.updatedAt = new Date().toISOString();
    
    await saveDB(db); 
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const productId = req.params.id;
    
    // Remove product and all associated data
    db.products = (db.products || []).filter(p => p.id !== productId);
    db.productNotes = (db.productNotes || []).filter(n => n.productId !== productId);
    db.productSellingPrices = (db.productSellingPrices || []).filter(sp => sp.productId !== productId);
    db.productOrders = (db.productOrders || []).filter(o => o.productId !== productId);
    db.adspend = (db.adspend || []).filter(a => a.productId !== productId);
    db.shipments = (db.shipments || []).filter(s => s.productId !== productId);
    db.remittances = (db.remittances || []).filter(r => r.productId !== productId);
    db.refunds = (db.refunds || []).filter(rf => rf.productId !== productId);
    db.influencerSpends = (db.influencerSpends || []).filter(sp => sp.productId !== productId);
    
    await saveDB(db);
    res.json({ ok: true, message: 'Product and all associated data deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product Prices
app.get('/api/products/:id/prices', async (req, res) => {
  try {
    const db = await loadDB();
    const prices = (db.productSellingPrices || []).filter(sp => sp.productId === req.params.id);
    res.json({ prices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/:id/prices', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.productSellingPrices = db.productSellingPrices || [];
    
    const { country, price } = req.body || {};
    
    if (!country || price === undefined) {
      return res.status(400).json({ error: 'Country and price required' });
    }

    const existing = db.productSellingPrices.find(sp =>
      sp.productId === req.params.id && sp.country === country
    );

    if (existing) {
      existing.price = +price || 0;
      existing.updatedAt = new Date().toISOString();
    } else {
      db.productSellingPrices.push({
        id: uuidv4(),
        productId: req.params.id,
        country,
        price: +price || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product Notes
app.get('/api/products/:id/notes', async (req, res) => {
  try {
    const db = await loadDB();
    const notes = (db.productNotes || []).filter(n => n.productId === req.params.id);
    res.json({ notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/products/:id/notes', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.productNotes = db.productNotes || [];
    
    const { country, note } = req.body || {};
    
    if (!country || !note) {
      return res.status(400).json({ error: 'Country and note required' });
    }

    const existing = db.productNotes.find(n =>
      n.productId === req.params.id && n.country === country
    );

    if (existing) {
      existing.note = note.trim();
      existing.updatedAt = new Date().toISOString();
    } else {
      db.productNotes.push({
        id: uuidv4(),
        productId: req.params.id,
        country,
        note: note.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/products/notes/:id', async (req, res) => {
  try {
    const db = await loadDB();
    db.productNotes = (db.productNotes || []).filter(n => n.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product Orders
app.get('/api/product-orders', async (req, res) => {
  try {
    const db = await loadDB();
    let orders = db.productOrders || [];
    
    const { productId, country, start, end, page = 1, limit = 10 } = req.query || {};
    
    // Apply filters
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/product-orders', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.productOrders = db.productOrders || [];
    
    const { productId, country, startDate, endDate, orders } = req.body || {};
    
    if (!productId || !country || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields required: productId, country, startDate, endDate, orders' });
    }

    // Check for duplicate period
    const existingOrder = db.productOrders.find(o => 
      o.productId === productId && 
      o.country === country && 
      o.startDate === startDate && 
      o.endDate === endDate
    );

    if (existingOrder) {
      return res.status(409).json({ 
        error: 'Duplicate order period', 
        message: 'You already entered orders in that period for that product.',
        existingOrder 
      });
    }

    const orderEntry = {
      id: uuidv4(),
      productId,
      country,
      startDate,
      endDate,
      orders: +orders || 0,
      createdAt: new Date().toISOString()
    };

    db.productOrders.push(orderEntry);
    await saveDB(db); 
    res.json({ ok: true, order: orderEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/product-orders/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.productOrders = (db.productOrders || []).filter(o => o.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ad Spend endpoints
app.get('/api/adspend', async (req, res) => { 
  try {
    const db = await loadDB(); 
    res.json({ adSpends: db.adspend || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/adspend', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.adspend = db.adspend || [];
    
    const { productId, country, platform, amount, date } = req.body || {};
    
    if (!productId || !country || !platform || !date) {
      return res.status(400).json({ error: 'All fields required: productId, country, platform, amount, date' });
    }
    
    // Check for existing entry for same product/country/platform/date
    const existing = db.adspend.find(a => 
      a.productId === productId && 
      a.country === country && 
      a.platform === platform &&
      a.date === date
    );
    
    if (existing) {
      existing.amount = +amount || 0;
      existing.updatedAt = new Date().toISOString();
    } else {
      db.adspend.push({ 
        id: uuidv4(), 
        productId, 
        country, 
        platform, 
        amount: +amount || 0,
        date: date,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deliveries
app.get('/api/deliveries', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json({ deliveries: db.deliveries || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/deliveries', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.deliveries = db.deliveries || [];
    
    const { date, country, delivered, productId } = req.body || {};
    
    if (!date || !country) {
      return res.status(400).json({ error: 'Date and country required' });
    }
    
    db.deliveries.push({ 
      id: uuidv4(), 
      date, 
      country, 
      delivered: +delivered || 0, 
      productId: productId || '',
      createdAt: new Date().toISOString()
    });
    
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Shipments endpoints
app.get('/api/shipments', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json({ shipments: db.shipments || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shipments', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.shipments = db.shipments || [];
    
    const { productId, fromCountry, toCountry, qty, shipCost, chinaCost, note, departedAt } = req.body || {};
    
    if (!productId || !fromCountry || !toCountry) {
      return res.status(400).json({ error: 'Product, from country, and to country required' });
    }

    const shipment = {
      id: uuidv4(),
      productId,
      fromCountry,
      toCountry,
      qty: +qty || 0,
      shipCost: +shipCost || 0,
      finalShipCost: null,
      chinaCost: fromCountry === 'china' ? +chinaCost || 0 : 0,
      note: note || '',
      departedAt: departedAt || new Date().toISOString().slice(0, 10),
      arrivedAt: null,
      paymentStatus: 'pending',
      paidAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    db.shipments.push(shipment); 
    await saveDB(db); 
    res.json({ ok: true, shipment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/shipments/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    const shipment = (db.shipments || []).find(s => s.id === req.params.id);
    
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    
    const updates = req.body || {};
    
    // Update allowed fields
    if (updates.qty !== undefined) shipment.qty = +updates.qty || 0;
    if (updates.shipCost !== undefined) shipment.shipCost = +updates.shipCost || 0;
    if (updates.finalShipCost !== undefined) shipment.finalShipCost = +updates.finalShipCost || 0;
    if (updates.chinaCost !== undefined) shipment.chinaCost = +updates.chinaCost || 0;
    if (updates.note !== undefined) shipment.note = updates.note;
    if (updates.departedAt !== undefined) shipment.departedAt = updates.departedAt;
    if (updates.arrivedAt !== undefined) shipment.arrivedAt = updates.arrivedAt;
    
    shipment.updatedAt = new Date().toISOString();
    
    await saveDB(db); 
    res.json({ ok: true, shipment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/shipments/:id/mark-paid', async (req, res) => {
  try {
    const db = await loadDB(); 
    const shipment = (db.shipments || []).find(s => s.id === req.params.id);
    
    if (!shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    
    const { finalShipCost } = req.body || {};
    
    if (!finalShipCost) {
      return res.status(400).json({ error: 'Final shipping cost required' });
    }
    
    shipment.finalShipCost = +finalShipCost || 0;
    shipment.paymentStatus = 'paid';
    shipment.paidAt = new Date().toISOString();
    shipment.updatedAt = new Date().toISOString();
    
    await saveDB(db); 
    res.json({ ok: true, shipment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/shipments/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.shipments = (db.shipments || []).filter(s => s.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remittances endpoints
app.get('/api/remittances', async (req, res) => {
  try {
    const db = await loadDB(); 
    let remittances = db.remittances || [];
    
    const { start, end, country, productId, page = 1, limit = 10 } = req.query || {};
    
    // Apply filters
    if (start) remittances = remittances.filter(r => r.start >= start);
    if (end) remittances = remittances.filter(r => r.end <= end);
    if (country) remittances = remittances.filter(r => r.country === country);
    if (productId) remittances = remittances.filter(r => r.productId === productId);

    // Sort by date (newest first)
    remittances.sort((a, b) => new Date(b.start) - new Date(a.start));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedRemittances = remittances.slice(startIndex, endIndex);
    const totalPages = Math.ceil(remittances.length / limit);

    res.json({ 
      remittances: paginatedRemittances,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: remittances.length,
        hasNextPage: endIndex < remittances.length,
        hasPrevPage: startIndex > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/remittances', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.remittances = db.remittances || [];
    
    const { start, end, country, productId, orders, pieces, revenue, adSpend, boxleoFees } = req.body || {};
    
    if (!start || !end || !country || !productId) {
      return res.status(400).json({ error: 'All required fields: start, end, country, productId' });
    }

    // Check for duplicate period
    const existingRemittance = db.remittances.find(r => 
      r.productId === productId && 
      r.country === country && 
      r.start === start && 
      r.end === end
    );

    if (existingRemittance) {
      return res.status(409).json({ 
        error: 'Duplicate remittance period', 
        message: 'You already entered a remittance for this product in this country during this period.',
        existingRemittance 
      });
    }

    const remittance = {
      id: uuidv4(),
      start,
      end,
      country,
      productId,
      orders: +orders || 0,
      pieces: +pieces || 0,
      revenue: +revenue || 0,
      adSpend: +adSpend || 0,
      boxleoFees: +boxleoFees || 0,
      createdAt: new Date().toISOString()
    };

    db.remittances.push(remittance); 
    await saveDB(db); 
    res.json({ ok: true, remittance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/remittances/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.remittances = (db.remittances || []).filter(r => r.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Refunds endpoints
app.get('/api/refunds', async (req, res) => {
  try {
    const db = await loadDB(); 
    let refunds = db.refunds || [];
    
    const { start, end, country, productId, page = 1, limit = 10 } = req.query || {};
    
    // Apply filters
    if (start) refunds = refunds.filter(r => r.date >= start);
    if (end) refunds = refunds.filter(r => r.date <= end);
    if (country) refunds = refunds.filter(r => r.country === country);
    if (productId) refunds = refunds.filter(r => r.productId === productId);

    // Sort by date (newest first)
    refunds.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedRefunds = refunds.slice(startIndex, endIndex);
    const totalPages = Math.ceil(refunds.length / limit);

    res.json({ 
      refunds: paginatedRefunds,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: refunds.length,
        hasNextPage: endIndex < refunds.length,
        hasPrevPage: startIndex > 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/refunds', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.refunds = db.refunds || [];
    
    const { date, country, productId, orders, pieces, amount, reason } = req.body || {};
    
    if (!date || !country || !productId) {
      return res.status(400).json({ error: 'Date, country, and productId required' });
    }

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
    await saveDB(db); 
    res.json({ ok: true, refund });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/refunds/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.refunds = (db.refunds || []).filter(r => r.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Finance Categories
app.get('/api/finance/categories', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json(db.finance?.categories || { debit: [], credit: [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/finance/categories', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
    
    const { type, name } = req.body || {};
    
    if (!type || !name) {
      return res.status(400).json({ error: 'Type and name required' });
    }
    
    if (!['debit', 'credit'].includes(type)) {
      return res.status(400).json({ error: 'Type must be debit or credit' });
    }
    
    if (!Array.isArray(db.finance.categories[type])) {
      db.finance.categories[type] = [];
    }
    
    if (!db.finance.categories[type].includes(name)) {
      db.finance.categories[type].push(name);
    }
    
    await saveDB(db); 
    res.json({ ok: true, categories: db.finance.categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/finance/categories', async (req, res) => {
  try {
    const db = await loadDB();
    const { type, name } = req.query || {};
    
    if (!type || !name) {
      return res.status(400).json({ error: 'Type and name required' });
    }
    
    if (db.finance?.categories?.[type]) {
      db.finance.categories[type] = db.finance.categories[type].filter(c => c !== name);
    }
    
    await saveDB(db); 
    res.json({ ok: true, categories: db.finance.categories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Finance Entries
app.get('/api/finance/entries', async (req, res) => {
  try {
    const db = await loadDB(); 
    let entries = db.finance?.entries || [];
    
    const { start, end, category, type } = req.query || {};
    
    // Apply filters
    if (start) entries = entries.filter(e => e.date >= start);
    if (end) entries = entries.filter(e => e.date <= end);
    if (category) entries = entries.filter(e => e.category === category);
    if (type) entries = entries.filter(e => e.type === type);

    // Calculate totals
    const total = entries.reduce((sum, e) => {
      const amount = +e.amount || 0;
      return e.type === 'credit' ? sum + amount : sum - amount;
    }, 0);
    
    const running = entries.reduce((sum, e) => {
      const amount = +e.amount || 0;
      return e.type === 'credit' ? sum + amount : sum - amount;
    }, 0);

    const categoryTotal = entries
      .filter(e => !category || e.category === category)
      .reduce((sum, e) => {
        const amount = +e.amount || 0;
        return e.type === 'credit' ? sum + amount : sum - amount;
      }, 0);

    res.json({
      entries,
      running,
      balance: total,
      categoryTotal
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/finance/entries', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.finance = db.finance || { categories: { debit: [], credit: [] }, entries: [] };
    
    const { date, type, category, amount, note } = req.body || {};
    
    if (!date || !type || !category || amount === undefined) {
      return res.status(400).json({ error: 'All fields required: date, type, category, amount' });
    }

    const entry = {
      id: uuidv4(),
      date,
      type,
      category,
      amount: +amount || 0,
      note: note || '',
      createdAt: new Date().toISOString()
    };

    db.finance.entries.push(entry);
    await saveDB(db);
    res.json({ ok: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/finance/entries/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.finance.entries = (db.finance.entries || []).filter(e => e.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Countries management
app.get('/api/countries', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json({ countries: db.countries || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/countries', async (req, res) => {
  try {
    const { name } = req.body || {};
    
    if (!name) {
      return res.status(400).json({ error: 'Country name required' });
    }
    
    const db = await loadDB(); 
    db.countries = db.countries || [];
    
    if (!db.countries.includes(name)) {
      db.countries.push(name);
    }
    
    await saveDB(db); 
    res.json({ ok: true, countries: db.countries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/countries/:name', async (req, res) => {
  try {
    const name = req.params.name;
    const db = await loadDB(); 
    db.countries = (db.countries || []).filter(c => c !== name);
    await saveDB(db); 
    res.json({ ok: true, countries: db.countries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Todo Lists
app.get('/api/todos', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ todos: db.todos || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/todos', async (req, res) => {
  try {
    const db = await loadDB();
    db.todos = db.todos || [];
    const { text } = req.body || {};
    
    if (!text) {
      return res.status(400).json({ error: 'Todo text required' });
    }
    
    const todo = {
      id: uuidv4(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString()
    };
    
    db.todos.push(todo);
    await saveDB(db);
    res.json({ ok: true, todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/todos/:id/toggle', async (req, res) => {
  try {
    const db = await loadDB();
    const todo = db.todos.find(t => t.id === req.params.id);
    
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    
    todo.done = !todo.done;
    await saveDB(db);
    res.json({ ok: true, todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/todos/:id', async (req, res) => {
  try {
    const db = await loadDB();
    db.todos = (db.todos || []).filter(t => t.id !== req.params.id);
    await saveDB(db);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Weekly Todos
app.get('/api/weekly-todos', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ weeklyTodos: db.weeklyTodos || {} });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/weekly-todos', async (req, res) => {
  try {
    const db = await loadDB();
    db.weeklyTodos = db.weeklyTodos || {};
    const { day, text } = req.body || {};
    
    if (!day || !text) {
      return res.status(400).json({ error: 'Day and text required' });
    }
    
    if (!db.weeklyTodos[day]) {
      db.weeklyTodos[day] = [];
    }
    
    const todo = {
      id: uuidv4(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString()
    };
    
    db.weeklyTodos[day].push(todo);
    await saveDB(db);
    res.json({ ok: true, todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/weekly-todos/:day/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const { day, id } = req.params;
    
    if (!db.weeklyTodos[day]) {
      return res.status(404).json({ error: 'Day not found' });
    }
    
    const todo = db.weeklyTodos[day].find(t => t.id === id);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }
    
    const { done } = req.body || {};
    if (done !== undefined) {
      todo.done = done;
    }
    
    await saveDB(db);
    res.json({ ok: true, todo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/weekly-todos/:day/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const { day, id } = req.params;
    
    if (!db.weeklyTodos[day]) {
      return res.status(404).json({ error: 'Day not found' });
    }
    
    db.weeklyTodos[day] = db.weeklyTodos[day].filter(t => t.id !== id);
    await saveDB(db);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Brainstorming
app.get('/api/brainstorming', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ ideas: db.brainstorming || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/brainstorming', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.brainstorming = db.brainstorming || [];
    const { title, description, category } = req.body || {};
    
    if (!title) {
      return res.status(400).json({ error: 'Idea title required' });
    }

    const idea = {
      id: uuidv4(),
      title: title.trim(),
      description: (description || '').trim(),
      category: category || 'general',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.brainstorming.push(idea);
    await saveDB(db); 
    res.json({ ok: true, idea });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/brainstorming/:id', async (req, res) => {
  try {
    const db = await loadDB();
    db.brainstorming = (db.brainstorming || []).filter(i => i.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tested Products
app.get('/api/tested-products', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ testedProducts: db.testedProducts || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tested-products', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.testedProducts = db.testedProducts || [];
    const { productName, country, costPerLead, confirmationRate, sellingPrice } = req.body || {};
    
    if (!productName || !country) {
      return res.status(400).json({ error: 'Product name and country required' });
    }

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

    await saveDB(db); 
    res.json({ ok: true, product });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/tested-products/:id', async (req, res) => {
  try {
    const db = await loadDB();
    db.testedProducts = (db.testedProducts || []).filter(tp => tp.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Influencers
app.get('/api/influencers', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json({ influencers: db.influencers || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/influencers', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.influencers = db.influencers || [];
    const { name, social, country } = req.body || {};
    
    if (!name) {
      return res.status(400).json({ error: 'Influencer name required' });
    }
    
    const influencer = { 
      id: uuidv4(), 
      name: name.trim(), 
      social: (social || '').trim(), 
      country: country || '',
      createdAt: new Date().toISOString()
    };
    
    db.influencers.push(influencer); 
    await saveDB(db); 
    res.json({ ok: true, influencer });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/influencers/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.influencers = (db.influencers || []).filter(i => i.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Influencer Spend
app.get('/api/influencers/spend', async (req, res) => {
  try {
    const db = await loadDB(); 
    res.json({ spends: db.influencerSpends || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/influencers/spend', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.influencerSpends = db.influencerSpends || [];
    const { date, influencerId, country, productId, amount } = req.body || {};
    
    if (!influencerId) {
      return res.status(400).json({ error: 'Influencer ID required' });
    }
    
    const spend = { 
      id: uuidv4(), 
      date: date || new Date().toISOString().slice(0, 10), 
      influencerId, 
      country: country || '', 
      productId: productId || '', 
      amount: +amount || 0,
      createdAt: new Date().toISOString()
    };
    
    db.influencerSpends.push(spend); 
    await saveDB(db); 
    res.json({ ok: true, spend });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/influencers/spend/:id', async (req, res) => {
  try {
    const db = await loadDB(); 
    db.influencerSpends = (db.influencerSpends || []).filter(s => s.id !== req.params.id);
    await saveDB(db); 
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analytics endpoints
app.get('/api/analytics/remittance', async (req, res) => {
  try {
    const db = await loadDB();
    const { start, end, country, productId, sortBy = 'totalDeliveredPieces', sortOrder = 'desc' } = req.query || {};

    // Mock analytics data - you would implement your actual analytics logic here
    const analytics = [];
    
    // This is a simplified version - implement your actual analytics logic
    const products = productId && productId !== 'all' 
      ? (db.products || []).filter(p => p.id === productId)
      : (db.products || []);
    
    products.forEach(product => {
      const countries = country ? [country] : (db.countries || []).filter(c => c !== 'china');
      
      countries.forEach(country => {
        // Calculate metrics for product/country combination
        const metrics = calculateProductMetrics(db, product.id, country, start, end);
        
        if (metrics.hasData) {
          analytics.push({
            productId: product.id,
            productName: product.name,
            country,
            ...metrics
          });
        }
      });
    });

    // Sort results
    analytics.sort((a, b) => {
      const aValue = a[sortBy] || 0;
      const bValue = b[sortBy] || 0;
      return sortOrder === 'desc' ? bValue - aValue : aValue - bValue;
    });

    res.json({ analytics, sortBy, sortOrder });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product Info
app.get('/api/product-info/:id', async (req, res) => {
  try {
    const db = await loadDB();
    const productId = req.params.id;
    const product = db.products.find(p => p.id === productId);
    
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const prices = db.productSellingPrices.filter(sp => sp.productId === productId);
    const countries = db.countries.filter(c => c !== 'china');
    
    // Calculate cost analysis for each country
    const costAnalysis = countries.map(country => {
      const price = prices.find(p => p.country === country);
      const sellingPrice = price ? +price.price : 0;
      
      // Calculate costs (simplified - implement your actual cost calculation)
      const productCostChina = 10; // Example
      const shippingCost = 5; // Example
      const boxleoPerOrder = 2; // Example
      const totalCost = productCostChina + shippingCost + boxleoPerOrder;
      const availableForProfitAndAds = sellingPrice - totalCost;
      const deliveryRate = 85; // Example
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
      prices,
      costAnalysis,
      boxleoPerOrder: 2, // Example
      totalBoxleoFees: 1000, // Example
      totalDeliveredOrders: 500 // Example
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Product Costs Analysis
app.get('/api/product-costs-analysis', async (req, res) => {
  try {
    const db = await loadDB();
    const { productId, start, end } = req.query || {};
    
    // Mock analysis - implement your actual cost analysis logic
    const analysis = {
      totalRevenue: 10000,
      totalAdSpend: 2000,
      totalBoxleoFees: 500,
      totalProductChinaCost: 3000,
      totalShippingCost: 1000,
      totalInfluencerSpend: 500,
      totalRefundedAmount: 200,
      totalRefundedOrders: 10,
      totalCost: 7000,
      profit: 3000,
      totalDeliveredPieces: 1000,
      totalDeliveredOrders: 500,
      totalOrders: 550,
      deliveryRate: 90.9,
      costPerDeliveredOrder: 14,
      costPerDeliveredPiece: 7,
      adCostPerDeliveredOrder: 4,
      adCostPerDeliveredPiece: 2,
      boxleoPerDeliveredOrder: 1,
      boxleoPerDeliveredPiece: 0.5,
      influencerPerDeliveredOrder: 1,
      averageOrderValue: 20,
      profitPerOrder: 6,
      profitPerPiece: 3,
      isProfitable: true,
      hasData: true,
      logic: 'A'
    };
    
    if (productId === 'all') {
      analysis.isAggregate = true;
      analysis.productCount = db.products.length;
    } else {
      analysis.isAggregate = false;
      analysis.productCount = 1;
    }
    
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Snapshots
app.get('/api/snapshots', async (req, res) => {
  try {
    const db = await loadDB();
    res.json({ snapshots: db.snapshots || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/snapshots', async (req, res) => {
  try {
    const db = await loadDB();
    const { name } = req.body || {};
    
    await fs.ensureDir(SNAPSHOT_DIR);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotName = name || `Manual-${timestamp}`;
    const snapshotFileName = `${timestamp}-${snapshotName.replace(/\s+/g, '-')}.json`;
    
    // Create snapshot file
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
    await saveDB(db);
    
    res.json({ ok: true, snapshot: snapshotEntry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/snapshots/:id', async (req, res) => {
  try {
    const db = await loadDB();
    db.snapshots = (db.snapshots || []).filter(s => s.id !== req.params.id);
    await saveDB(db);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backup push
app.post('/api/backup/push-snapshot', async (req, res) => {
  try {
    const { snapshotFile } = req.body || {};
    
    if (!snapshotFile) {
      return res.status(400).json({ error: 'Snapshot file required' });
    }
    
    const snapshotPath = path.join(SNAPSHOT_DIR, snapshotFile);
    
    if (!await fs.pathExists(snapshotPath)) {
      return res.status(404).json({ error: 'Snapshot file not found' });
    }
    
    const snapshotData = await fs.readJson(snapshotPath);
    
    if (!snapshotData.products || !snapshotData.countries) {
      return res.status(400).json({ error: 'Invalid snapshot format' });
    }
    
    // Create backup before restoring
    const backupFileName = `pre-push-backup-${Date.now()}.json`;
    await fs.copy(DATA_FILE, path.join(SNAPSHOT_DIR, backupFileName));
    
    // Restore snapshot
    await fs.writeJson(DATA_FILE, snapshotData, { spaces: 2 });
    
    res.json({ 
      ok: true, 
      message: 'Snapshot restored successfully. System will reload.',
      backupFile: backupFileName 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Utility functions
function calculateProductStock(db, productId = null, country = null) {
  try {
    const shipments = db.shipments || [];
    const remittances = db.remittances || [];
    const refunds = db.refunds || [];
    
    let stock = {};
    
    // Initialize stock for all countries (except china)
    (db.countries || []).filter(c => c !== 'china').forEach(c => {
      stock[c] = 0;
    });

    // Process shipments
    shipments
      .filter(s => !productId || s.productId === productId)
      .forEach(shipment => {
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

    // Process remittances (reduce stock)
    remittances
      .filter(r => (!productId || r.productId === productId))
      .forEach(remittance => {
        if (stock[remittance.country] !== undefined) {
          stock[remittance.country] -= (+remittance.pieces || 0);
        }
      });

    // Process refunds (increase stock)
    refunds
      .filter(rf => (!productId || rf.productId === productId))
      .forEach(refund => {
        if (stock[refund.country] !== undefined) {
          stock[refund.country] += (+refund.pieces || 0);
        }
      });

    if (country) return Math.max(0, stock[country] || 0);
    return stock;
  } catch (error) {
    console.error('Error calculating stock:', error);
    return country ? 0 : {};
  }
}

function calculateTransitPieces(db, productId = null) {
  try {
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
  } catch (error) {
    console.error('Error calculating transit:', error);
    return { chinaTransit: 0, interCountryTransit: 0, totalTransit: 0 };
  }
}

function calculateProductMetrics(db, productId, country, startDate, endDate) {
  // Simplified metrics calculation - implement your actual logic
  const remittances = (db.remittances || []).filter(r => 
    r.productId === productId && 
    r.country === country &&
    (!startDate || r.start >= startDate) &&
    (!endDate || r.end <= endDate)
  );
  
  const totalRevenue = remittances.reduce((sum, r) => sum + (+r.revenue || 0), 0);
  const totalAdSpend = remittances.reduce((sum, r) => sum + (+r.adSpend || 0), 0);
  const totalBoxleoFees = remittances.reduce((sum, r) => sum + (+r.boxleoFees || 0), 0);
  const totalDeliveredPieces = remittances.reduce((sum, r) => sum + (+r.pieces || 0), 0);
  const totalDeliveredOrders = remittances.reduce((sum, r) => sum + (+r.orders || 0), 0);
  
  const hasData = totalRevenue > 0 || totalAdSpend > 0 || totalDeliveredPieces > 0;
  
  return {
    totalRevenue,
    totalAdSpend,
    totalBoxleoFees,
    totalDeliveredPieces,
    totalDeliveredOrders,
    totalOrders: totalDeliveredOrders,
    deliveryRate: 85, // Example
    profit: totalRevenue - totalAdSpend - totalBoxleoFees - (totalDeliveredPieces * 5), // Example cost
    profitPerOrder: (totalRevenue - totalAdSpend - totalBoxleoFees - (totalDeliveredPieces * 5)) / Math.max(totalDeliveredOrders, 1),
    profitPerPiece: (totalRevenue - totalAdSpend - totalBoxleoFees - (totalDeliveredPieces * 5)) / Math.max(totalDeliveredPieces, 1),
    averageOrderValue: totalRevenue / Math.max(totalDeliveredOrders, 1),
    hasData
  };
}

// Auto-create daily backup on startup
async function createStartupBackup() {
  try {
    const db = await loadDB();
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
      
      // Keep only last 7 days of auto-daily backups
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      db.snapshots = db.snapshots.filter(snapshot => {
        if (snapshot.kind === 'auto-daily') {
          const snapshotDate = new Date(snapshot.createdAt);
          return snapshotDate >= sevenDaysAgo;
        }
        return true; // Keep all manual snapshots
      });
      
      await saveDB(db);
      console.log(`✅ Auto-created startup backup: ${backupName}`);
    } else {
      console.log(`✅ Daily backup already exists for ${today}`);
    }
  } catch (error) {
    console.error('❌ Startup backup error:', error.message);
  }
}

// Static file routes
app.get('/product.html', (req, res) => {
  res.sendFile(path.join(ROOT, 'product.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Enhanced error handling
app.use((error, req, res, next) => {
  console.error('🚨 Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message,
    code: 'INTERNAL_ERROR'
  });
});

// Server startup
async function startServer() {
  try {
    console.log('🚀 Starting EAS Tracker server...');
    
    // Initialize directories and database
    const initialized = await initializeDirectories();
    if (!initialized) {
      throw new Error('Failed to initialize directories and database');
    }
    
    // Create startup backup
    await createStartupBackup();
    
    // Start the server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`✅ EAS Tracker server running on port ${PORT}`);
      console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`✅ Data directory: ${PERSIST_DIR}`);
      console.log(`✅ Database file: ${DATA_FILE}`);
      console.log(`✅ Snapshots directory: ${SNAPSHOT_DIR}`);
      console.log('🔐 Default password: eastafricashop');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();
