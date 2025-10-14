const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Get ad spend
router.get('/adspend', requireAuth, (req, res) => {
  const adSpend = db.getAdSpend();
  res.json({ adSpend });
});

// Add/update ad spend
router.post('/adspend', requireAuth, (req, res) => {
  const { productId, country, platform, amount } = req.body;
  
  if (!productId || !country || !platform) {
    return res.status(400).json({ error: 'Product, country, and platform are required' });
  }

  const data = db.load();
  const existing = data.marketing.adSpend.find(
    a => a.productId === productId && a.country === country && a.platform === platform
  );

  if (existing) {
    // Update existing
    existing.amount = Math.max(0, Number(amount) || 0);
    existing.updatedAt = new Date().toISOString();
  } else {
    // Create new
    data.marketing.adSpend.push({
      id: uuidv4(),
      productId,
      country: country.toLowerCase(),
      platform,
      amount: Math.max(0, Number(amount) || 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  db.save(data);
  res.json({ ok: true });
});

// Get remittances
router.get('/remittances', requireAuth, (req, res) => {
  const { start, end, country, productId } = req.query;
  let remittances = db.getRemittances();
  
  // Filter remittances
  if (start) remittances = remittances.filter(r => r.start >= start);
  if (end) remittances = remittances.filter(r => r.end <= end);
  if (country) remittances = remittances.filter(r => r.country === country);
  if (productId) remittances = remittances.filter(r => r.productId === productId);
  
  res.json({ remittances });
});

// Add remittance
router.post('/remittances', requireAuth, (req, res) => {
  const { start, end, country, productId, orders, pieces, revenue, adSpend, extraPerPiece } = req.body;
  
  if (!start || !end || !country || !productId) {
    return res.status(400).json({ error: 'Start, end, country, and product are required' });
  }

  if (country.toLowerCase() === 'china') {
    return res.status(400).json({ error: 'China not allowed for remittances' });
  }

  const remittance = {
    id: uuidv4(),
    start,
    end,
    country: country.toLowerCase(),
    productId,
    orders: Math.max(0, Number(orders) || 0),
    pieces: Math.max(0, Number(pieces) || 0),
    revenue: Math.max(0, Number(revenue) || 0),
    adSpend: Math.max(0, Number(adSpend) || 0),
    extraPerPiece: Math.max(0, Number(extraPerPiece) || 0),
    recordedAt: new Date().toISOString()
  };

  const data = db.load();
  data.sales.remittances.push(remittance);
  db.save(data);

  res.json({ ok: true, remittance });
});

// Delete remittance
router.delete('/remittances/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  data.sales.remittances = data.sales.remittances.filter(r => r.id !== id);
  db.save(data);
  
  res.json({ ok: true });
});

// Influencers routes
router.get('/influencers', requireAuth, (req, res) => {
  const influencers = db.load().marketing.influencers || [];
  res.json({ influencers });
});

router.post('/influencers', requireAuth, (req, res) => {
  const { name, social, country } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Influencer name is required' });
  }

  const influencer = {
    id: uuidv4(),
    name: name.trim(),
    social: (social || '').trim(),
    country: (country || '').toLowerCase(),
    createdAt: new Date().toISOString()
  };

  const data = db.load();
  data.marketing.influencers.push(influencer);
  db.save(data);

  res.json({ ok: true, influencer });
});

router.delete('/influencers/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  data.marketing.influencers = data.marketing.influencers.filter(i => i.id !== id);
  data.marketing.influencerSpends = data.marketing.influencerSpends.filter(s => s.influencerId !== id);
  db.save(data);
  
  res.json({ ok: true });
});

// Influencer spend routes
router.get('/influencers/spend', requireAuth, (req, res) => {
  const spends = db.load().marketing.influencerSpends || [];
  res.json({ spends });
});

router.post('/influencers/spend', requireAuth, (req, res) => {
  const { date, influencerId, country, productId, amount } = req.body;
  
  if (!influencerId) {
    return res.status(400).json({ error: 'Influencer is required' });
  }

  const spend = {
    id: uuidv4(),
    date: date || new Date().toISOString().slice(0, 10),
    influencerId,
    country: (country || '').toLowerCase(),
    productId: productId || '',
    amount: Math.max(0, Number(amount) || 0),
    recordedAt: new Date().toISOString()
  };

  const data = db.load();
  data.marketing.influencerSpends.push(spend);
  db.save(data);

  res.json({ ok: true, spend });
});

router.delete('/influencers/spend/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  data.marketing.influencerSpends = data.marketing.influencerSpends.filter(s => s.id !== id);
  db.save(data);
  
  res.json({ ok: true });
});

module.exports = router;
