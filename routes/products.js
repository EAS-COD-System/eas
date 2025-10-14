const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Get all products
router.get('/', requireAuth, (req, res) => {
  const products = db.getProducts();
  res.json({ products });
});

// Create new product
router.post('/', requireAuth, (req, res) => {
  const { name, sku, cost_china, ship_china_to_kenya, margin_budget } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  const product = {
    id: uuidv4(),
    name: name.trim(),
    sku: (sku || '').trim(),
    cost_china: Math.max(0, Number(cost_china) || 0),
    ship_china_to_kenya: Math.max(0, Number(ship_china_to_kenya) || 0),
    margin_budget: Math.max(0, Number(margin_budget) || 0),
    status: 'active',
    budgets: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const data = db.load();
  data.products.push(product);
  db.save(data);

  res.json({ ok: true, product });
});

// Update product
router.put('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const data = db.load();
  const product = data.products.find(p => p.id === id);
  
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // Update allowed fields
  if (updates.name !== undefined) product.name = updates.name;
  if (updates.sku !== undefined) product.sku = updates.sku;
  if (updates.cost_china !== undefined) product.cost_china = Math.max(0, Number(updates.cost_china) || 0);
  if (updates.ship_china_to_kenya !== undefined) product.ship_china_to_kenya = Math.max(0, Number(updates.ship_china_to_kenya) || 0);
  if (updates.margin_budget !== undefined) product.margin_budget = Math.max(0, Number(updates.margin_budget) || 0);
  if (updates.budgets !== undefined) product.budgets = updates.budgets;
  
  product.updatedAt = new Date().toISOString();
  
  db.save(data);
  res.json({ ok: true, product });
});

// Update product status
router.post('/:id/status', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const data = db.load();
  const product = data.products.find(p => p.id === id);
  
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  product.status = ['active', 'paused'].includes(status) ? status : 'active';
  product.updatedAt = new Date().toISOString();
  
  db.save(data);
  res.json({ ok: true, product });
});

// Delete product
router.delete('/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  
  // Remove product and related data
  data.products = data.products.filter(p => p.id !== id);
  data.marketing.adSpend = data.marketing.adSpend.filter(a => a.productId !== id);
  data.inventory.shipments = data.inventory.shipments.filter(s => s.productId !== id);
  data.sales.remittances = data.sales.remittances.filter(r => r.productId !== id);
  data.marketing.influencerSpends = data.marketing.influencerSpends.filter(s => s.productId !== id);
  
  db.save(data);
  res.json({ ok: true });
});

module.exports = router;
