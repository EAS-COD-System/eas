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

// Orders storage file
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// Initialize orders file if not exists
if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
}

// Helper functions
function getOrders() {
  try {
    const data = fs.readFileSync(ORDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function addOrder(orderData) {
  const orders = getOrders();
  const order = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2),
    ...orderData,
    timestamp: new Date().toISOString(),
    status: 'new'
  };
  orders.push(order);
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

// API Routes

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

// Get all orders
app.get('/api/orders', requireAuth, (req, res) => {
  const orders = getOrders();
  const { 
    startDate, 
    endDate, 
    product, 
    source,
    page = 1,
    limit = 50 
  } = req.query;

  let filtered = [...orders];

  // Date filtering
  if (startDate || endDate) {
    filtered = filtered.filter(order => {
      const orderDate = new Date(order.timestamp);
      if (startDate && orderDate < new Date(startDate)) return false;
      if (endDate && orderDate > new Date(endDate + 'T23:59:59')) return false;
      return true;
    });
  }

  // Product filtering
  if (product) {
    filtered = filtered.filter(order => 
      order.product && order.product.toLowerCase().includes(product.toLowerCase())
    );
  }

  // Source filtering
  if (source) {
    filtered = filtered.filter(order => order.source === source);
  }

  // Sort by newest first
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Pagination
  const totalOrders = filtered.length;
  const totalPages = Math.ceil(totalOrders / limit);
  const startIndex = (page - 1) * limit;
  const paginatedOrders = filtered.slice(startIndex, startIndex + limit);

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

// Get order statistics
app.get('/api/stats', requireAuth, (req, res) => {
  const orders = getOrders();
  const now = new Date();
  
  // Date ranges
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today - 86400000);
  const weekAgo = new Date(today - 7 * 86400000);
  const lastWeekStart = new Date(today - 14 * 86400000);
  const lastWeekEnd = new Date(today - 7 * 86400000);
  const thirtyDaysAgo = new Date(today - 30 * 86400000);
  const sixtyDaysAgo = new Date(today - 60 * 86400000);

  const stats = {
    total: orders.length,
    today: orders.filter(o => new Date(o.timestamp) >= today).length,
    yesterday: orders.filter(o => {
      const d = new Date(o.timestamp);
      return d >= yesterday && d < today;
    }).length,
    thisWeek: orders.filter(o => new Date(o.timestamp) >= weekAgo).length,
    lastWeek: orders.filter(o => {
      const d = new Date(o.timestamp);
      return d >= lastWeekStart && d < lastWeekEnd;
    }).length,
    last30Days: orders.filter(o => new Date(o.timestamp) >= thirtyDaysAgo).length,
    last60Days: orders.filter(o => new Date(o.timestamp) >= sixtyDaysAgo).length,
    byProduct: {},
    bySource: {},
    byCountry: {},
    totalRevenue: 0,
    averageOrderValue: 0
  };

  // Aggregate data
  orders.forEach(order => {
    // Product breakdown
    stats.byProduct[order.product] = (stats.byProduct[order.product] || 0) + 1;
    
    // Source breakdown
    stats.bySource[order.source] = (stats.bySource[order.source] || 0) + 1;
    
    // Country breakdown
    const country = order.country || 'Unknown';
    stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;
    
    // Revenue
    const price = parseFloat(order.price.replace(/[^0-9.]/g, ''));
    if (!isNaN(price)) {
      stats.totalRevenue += price;
    }
  });

  stats.averageOrderValue = orders.length > 0 ? 
    Math.round(stats.totalRevenue / orders.length) : 0;

  res.json(stats);
});

// Create order
app.post('/api/create-order', (req, res) => {
  try {
    const order = addOrder(req.body);
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Webhook endpoint for pixel tracking
app.post('/api/track-event', (req, res) => {
  const { event, data } = req.body;
  console.log(`[Pixel Event] ${event}:`, data);
  res.json({ success: true });
});

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/men', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'men.html'));
});

app.get('/women', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'women.html'));
});

app.get('/gift', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gift.html'));
});

// Thank you page
app.get('/thank-you', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AUDORA Luxury Fragrances — server running on port ${PORT}`);
});
