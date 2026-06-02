const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple session management
const sessions = new Map();
const ADMIN_PASSWORD = 'simonoaym';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// ==================== PERSISTENT STORAGE ====================
// Use Render's persistent disk if available, otherwise use local data folder
const DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, 'data');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created data directory:', DATA_DIR);
}

const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

console.log('Data directory:', DATA_DIR);
console.log('Orders file:', ORDERS_FILE);
console.log('Settings file:', SETTINGS_FILE);

// Default settings
const DEFAULT_SETTINGS = {
  products: {
    blackOud: {
      name: 'AUDORA BLACK OUD',
      description: 'Men\'s Luxury Fragrance · 50ml',
      bundles: {
        '1': { label: '1 Bottle', price: 2999, popular: false, savings: 0 },
        '2': { label: '2 Bottles', price: 5499, popular: true, savings: 499 },
        '3': { label: '3 Bottles', price: 7499, popular: false, savings: 1498 }
      }
    },
    roseNoir: {
      name: 'AUDORA ROSE NOIR',
      description: 'Women\'s Luxury Fragrance · 50ml',
      bundles: {
        '1': { label: '1 Bottle', price: 2999, popular: false, savings: 0 },
        '2': { label: '2 Bottles', price: 5499, popular: true, savings: 499 },
        '3': { label: '3 Bottles', price: 7499, popular: false, savings: 1498 }
      }
    },
    giftBundle: {
      name: 'His and Hers Collection',
      description: 'BLACK OUD + ROSE NOIR',
      bundles: {
        'couple': { label: 'His and Hers Bundle', price: 5499, popular: true, savings: 499 }
      }
    }
  },
  delivery: {
    nairobi: '1-2 business days',
    nationwide: '2-4 business days',
    codMessage: 'Cash On Delivery — You pay only when the order arrives',
    freeDelivery: true,
    deliveryFee: 0
  },
  contact: {
    whatsapp: '+971523012934',
    email: '',
    phone: ''
  },
  branding: {
    tagline: 'Luxury Eau de Parfum · Kenya',
    announcement: 'Free Delivery Nationwide · Cash On Delivery · Limited Stock'
  }
};

// Helper functions
function getOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const data = fs.readFileSync(ORDERS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading orders:', error);
    return [];
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
    console.log('Orders saved successfully. Total:', orders.length);
  } catch (error) {
    console.error('Error saving orders:', error);
  }
}

function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return JSON.parse(data);
    }
    // If no settings file, create with defaults
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  } catch (error) {
    console.error('Error reading settings:', error);
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('Settings saved successfully');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

function addOrder(orderData) {
  const orders = getOrders();
  const order = {
    id: 'AUD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase(),
    orderId: 'AUD-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substr(2, 5).toUpperCase(),
    ...orderData,
    timestamp: new Date().toISOString(),
    status: 'new'
  };
  orders.unshift(order);
  saveOrders(orders);
  return order;
}

// Session middleware
function requireAuth(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.query.session;
  if (!sessionId || !sessions.has(sessionId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const session = sessions.get(sessionId);
  if (Date.now() - session.created > SESSION_DURATION) {
    sessions.delete(sessionId);
    return res.status(401).json({ error: 'Session expired' });
  }
  
  next();
}

// Initialize sample data only if orders file is empty
function initializeSampleData() {
  const orders = getOrders();
  if (orders.length === 0) {
    console.log('No orders found. Adding sample data...');
    const sampleOrders = [
      {
        id: 'AUD-LKJHG987',
        orderId: 'AUD-LKJHG987',
        product: 'AUDORA BLACK OUD — Men\'s Fragrance',
        bundle: '2 Bottles',
        price: 'KSH 5,499',
        name: 'Brian Ochieng',
        phone: '+254712345678',
        location: 'Westlands, Nairobi',
        source: 'Facebook',
        country: 'Kenya',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        status: 'new'
      },
      {
        id: 'AUD-MNBVC654',
        orderId: 'AUD-MNBVC654',
        product: 'AUDORA ROSE NOIR — Women\'s Fragrance',
        bundle: '1 Bottle',
        price: 'KSH 2,999',
        name: 'Amina Hassan',
        phone: '+254723456789',
        location: 'Nyali, Mombasa',
        source: 'Instagram',
        country: 'Kenya',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        status: 'confirmed'
      },
      {
        id: 'AUD-POIUY321',
        orderId: 'AUD-POIUY321',
        product: 'His and Hers Bundle (BLACK OUD + ROSE NOIR)',
        bundle: 'His and Hers (2 bottles)',
        price: 'KSH 5,499',
        name: 'Peter Kamau',
        phone: '+254734567890',
        location: 'Kilimani, Nairobi',
        source: 'TikTok',
        country: 'Kenya',
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        status: 'delivered'
      }
    ];
    saveOrders(sampleOrders);
  }
}

// Initialize
initializeSampleData();

// ==================== API ROUTES ====================

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const sessionId = Date.now().toString(36) + Math.random().toString(36);
    sessions.set(sessionId, { created: Date.now() });
    res.json({ success: true, sessionId });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Check session
app.get('/api/check-session', requireAuth, (req, res) => {
  res.json({ valid: true });
});

// Get settings (public endpoint for website)
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  res.json(settings);
});

// Get settings (protected for dashboard)
app.get('/api/admin/settings', requireAuth, (req, res) => {
  const settings = getSettings();
  res.json(settings);
});

// Update settings
app.put('/api/admin/settings', requireAuth, (req, res) => {
  try {
    const newSettings = req.body;
    saveSettings(newSettings);
    res.json({ success: true, settings: newSettings });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Reset settings to default
app.post('/api/admin/settings/reset', requireAuth, (req, res) => {
  saveSettings(DEFAULT_SETTINGS);
  res.json({ success: true, settings: DEFAULT_SETTINGS });
});

// Get all orders with advanced filtering
app.get('/api/orders', requireAuth, (req, res) => {
  const orders = getOrders();
  const { 
    startDate, endDate, productType, source, status,
    country, search, page = 1, limit = 50,
    sortBy = 'timestamp', sortOrder = 'desc'
  } = req.query;

  let filtered = [...orders];

  // Date filtering
  if (startDate || endDate) {
    filtered = filtered.filter(order => {
      const orderDate = new Date(order.timestamp);
      if (startDate && orderDate < new Date(startDate)) return false;
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        if (orderDate > endDateTime) return false;
      }
      return true;
    });
  }

  // Product type filtering
  if (productType) {
    filtered = filtered.filter(order => {
      const prod = order.product.toLowerCase();
      switch(productType) {
        case 'black-oud': return prod.includes('black oud') || prod.includes('men');
        case 'rose-noir': return prod.includes('rose noir') || prod.includes('women');
        case 'gift': return prod.includes('gift') || prod.includes('his and hers');
        default: return true;
      }
    });
  }

  // Source filtering
  if (source) {
    filtered = filtered.filter(order => 
      order.source && order.source.toLowerCase() === source.toLowerCase()
    );
  }

  // Status filtering
  if (status) {
    filtered = filtered.filter(order => order.status === status);
  }

  // Country filtering
  if (country) {
    filtered = filtered.filter(order => 
      order.country && order.country.toLowerCase() === country.toLowerCase()
    );
  }

  // Search across multiple fields
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(order => 
      (order.name && order.name.toLowerCase().includes(searchLower)) ||
      (order.phone && order.phone.includes(search)) ||
      (order.location && order.location.toLowerCase().includes(searchLower)) ||
      (order.orderId && order.orderId.toLowerCase().includes(searchLower)) ||
      (order.product && order.product.toLowerCase().includes(searchLower))
    );
  }

  // Sorting
  filtered.sort((a, b) => {
    let valA, valB;
    switch(sortBy) {
      case 'name':
        valA = (a.name || '').toLowerCase();
        valB = (b.name || '').toLowerCase();
        break;
      case 'price':
        valA = parseFloat((a.price || '0').replace(/[^0-9.]/g, ''));
        valB = parseFloat((b.price || '0').replace(/[^0-9.]/g, ''));
        break;
      case 'timestamp':
      default:
        valA = new Date(a.timestamp).getTime();
        valB = new Date(b.timestamp).getTime();
    }
    return sortOrder === 'desc' ? valB - valA : valA - valB;
  });

  // Pagination
  const totalOrders = filtered.length;
  const totalPages = Math.ceil(totalOrders / parseInt(limit));
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const paginatedOrders = filtered.slice(startIndex, startIndex + parseInt(limit));

  res.json({
    orders: paginatedOrders,
    pagination: {
      currentPage: parseInt(page),
      totalPages,
      totalOrders,
      limit: parseInt(limit)
    }
  });
});

// Get single order
app.get('/api/orders/:id', requireAuth, (req, res) => {
  const orders = getOrders();
  const order = orders.find(o => o.id === req.params.id || o.orderId === req.params.id);
  if (order) {
    res.json(order);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

// Update order status
app.put('/api/orders/:id', requireAuth, (req, res) => {
  const orders = getOrders();
  const index = orders.findIndex(o => o.id === req.params.id || o.orderId === req.params.id);
  if (index !== -1) {
    orders[index] = { ...orders[index], ...req.body };
    saveOrders(orders);
    res.json(orders[index]);
  } else {
    res.status(404).json({ error: 'Order not found' });
  }
});

// Get comprehensive statistics
app.get('/api/stats', requireAuth, (req, res) => {
  const orders = getOrders();
  const now = new Date();
  
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart - 86400000);
  const yesterdayEnd = new Date(todayStart);
  const weekAgo = new Date(todayStart - 7 * 86400000);
  const lastWeekStart = new Date(todayStart - 14 * 86400000);
  const lastWeekEnd = new Date(todayStart - 7 * 86400000);
  const thirtyDaysAgo = new Date(todayStart - 30 * 86400000);
  const sixtyDaysAgo = new Date(todayStart - 60 * 86400000);

  const stats = {
    total: orders.length,
    today: orders.filter(o => new Date(o.timestamp) >= todayStart).length,
    yesterday: orders.filter(o => {
      const d = new Date(o.timestamp);
      return d >= yesterdayStart && d < yesterdayEnd;
    }).length,
    thisWeek: orders.filter(o => new Date(o.timestamp) >= weekAgo).length,
    lastWeek: orders.filter(o => {
      const d = new Date(o.timestamp);
      return d >= lastWeekStart && d < lastWeekEnd;
    }).length,
    last30Days: orders.filter(o => new Date(o.timestamp) >= thirtyDaysAgo).length,
    last60Days: orders.filter(o => new Date(o.timestamp) >= sixtyDaysAgo).length,
    byProductType: {
      'BLACK OUD': 0,
      'ROSE NOIR': 0,
      'GIFT BUNDLE': 0
    },
    bySource: {},
    byCountry: {},
    byStatus: {
      'new': 0, 'confirmed': 0, 'processing': 0, 'delivered': 0, 'cancelled': 0
    },
    byBundle: {},
    totalRevenue: 0,
    averageOrderValue: 0,
    recentOrders: orders.slice(0, 10)
  };

  orders.forEach(order => {
    const prod = order.product.toLowerCase();
    if (prod.includes('black oud') || prod.includes('men')) {
      stats.byProductType['BLACK OUD']++;
    } else if (prod.includes('rose noir') || prod.includes('women')) {
      stats.byProductType['ROSE NOIR']++;
    } else {
      stats.byProductType['GIFT BUNDLE']++;
    }
    
    stats.bySource[order.source] = (stats.bySource[order.source] || 0) + 1;
    const country = order.country || 'Kenya';
    stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;
    stats.byBundle[order.bundle] = (stats.byBundle[order.bundle] || 0) + 1;
    stats.byStatus[order.status] = (stats.byStatus[order.status] || 0) + 1;
    
    const price = parseFloat((order.price || '0').replace(/[^0-9.]/g, ''));
    if (!isNaN(price)) stats.totalRevenue += price;
  });

  stats.averageOrderValue = orders.length > 0 ? Math.round(stats.totalRevenue / orders.length) : 0;
  res.json(stats);
});

// Create order
app.post('/api/create-order', (req, res) => {
  try {
    const order = addOrder(req.body);
    console.log('New order:', order.orderId);
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Webhook for pixel tracking
app.post('/api/track-event', (req, res) => {
  const { event, data } = req.body;
  console.log(`[Pixel] ${event}:`, JSON.stringify(data));
  res.json({ success: true });
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/men', (req, res) => res.sendFile(path.join(__dirname, 'public', 'men.html')));
app.get('/women', (req, res) => res.sendFile(path.join(__dirname, 'public', 'women.html')));
app.get('/gift', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gift.html')));
app.get('/thank-you', (req, res) => res.sendFile(path.join(__dirname, 'public', 'thank-you.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// Dynamic pricing script
app.get('/pricing.js', (req, res) => {
  const settings = getSettings();
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`
    window.AUDORA_SETTINGS = ${JSON.stringify(settings)};
    window.AUDORA_PRICING = ${JSON.stringify(settings.products)};
    console.log('AUDORA Pricing loaded');
  `);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    dataDir: DATA_DIR,
    ordersCount: getOrders().length
  });
});

// Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AUDORA running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Orders file: ${ORDERS_FILE}`);
  console.log(`Total orders: ${getOrders().length}`);
});
