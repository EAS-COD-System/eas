// server.js - DEBUG VERSION
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'db.json');
const SNAPSHOT_DIR = path.join(ROOT, 'data', 'snapshots');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Enhanced logging middleware
app.use(morgan('dev'));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

// Database functions
function initDBIfMissing() {
  if (!fs.existsSync(DATA_FILE)) {
    console.log('🆕 Creating new database file...');
    fs.writeJsonSync(DATA_FILE, {
      password: 'eastafricashop',
      countries: ['china', 'kenya', 'tanzania', 'uganda', 'zambia', 'zimbabwe'],
      products: [],
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

function loadDB() { 
  initDBIfMissing(); 
  return fs.readJsonSync(DATA_FILE); 
}

function saveDB(db) { 
  fs.writeJsonSync(DATA_FILE, db, { spaces: 2 }); 
}

// SIMPLIFIED AUTH - This should definitely work
app.post('/api/auth', (req, res) => {
  const { password } = req.body || {};
  const db = loadDB();

  console.log('🔐 LOGIN ATTEMPT:', {
    receivedPassword: password ? '***' : 'empty',
    expectedPassword: db.password,
    timestamp: new Date().toISOString()
  });

  // ULTRA SIMPLE COOKIE SETTINGS
  const cookieOpts = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: false, // Force false for Render
    maxAge: 365 * 24 * 60 * 60 * 1000
  };

  if (password === 'logout') {
    console.log('🔐 Logout request');
    res.clearCookie('auth', cookieOpts);
    return res.json({ ok: true });
  }

  if (password && password === db.password) {
    console.log('✅ LOGIN SUCCESS - Setting cookie');
    res.cookie('auth', '1', cookieOpts);
    return res.json({ ok: true, message: 'Login successful' });
  }

  console.log('❌ LOGIN FAILED - Wrong password');
  return res.status(401).json({ error: 'Wrong password' });
});

// Auth check endpoint
app.get('/api/auth/check', (req, res) => {
  const isAuthenticated = req.cookies.auth === '1';
  console.log('🔐 Auth check:', { authenticated: isAuthenticated, cookies: req.cookies });
  res.json({ authenticated: isAuthenticated });
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.cookies.auth === '1') {
    return next();
  }
  console.log('🔐 Auth required but not authenticated');
  return res.status(401).json({ error: 'Authentication required' });
}

// Test endpoint
app.get('/api/debug', (req, res) => {
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    cookies: req.cookies
  });
});

// Meta endpoint
app.get('/api/meta', requireAuth, (req, res) => {
  const db = loadDB();
  res.json({ 
    countries: (db.countries || []).filter(c => c !== 'china')
  });
});

// ... [KEEP ALL YOUR OTHER ENDPOINTS EXACTLY AS THEY WERE] ...

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/product.html', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'product.html'));
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 EAS Tracker Server Started!');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔐 Default password: eastafricashop`);
  console.log(`🕐 Time: ${new Date().toISOString()}`);
});
