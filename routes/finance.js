const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Get finance categories
router.get('/categories', requireAuth, (req, res) => {
  const categories = db.load().finance.categories;
  res.json(categories);
});

// Add finance category
router.post('/categories', requireAuth, (req, res) => {
  const { type, name } = req.body;
  
  if (!type || !name) {
    return res.status(400).json({ error: 'Type and name are required' });
  }

  if (!['debit', 'credit'].includes(type)) {
    return res.status(400).json({ error: 'Type must be debit or credit' });
  }

  const data = db.load();
  if (!data.finance.categories[type].includes(name)) {
    data.finance.categories[type].push(name);
    db.save(data);
  }

  res.json({ ok: true, categories: data.finance.categories });
});

// Delete finance category
router.delete('/categories', requireAuth, (req, res) => {
  const { type, name } = req.query;
  
  if (!type || !name) {
    return res.status(400).json({ error: 'Type and name are required' });
  }

  const data = db.load();
  data.finance.categories[type] = data.finance.categories[type].filter(c => c !== name);
  db.save(data);

  res.json({ ok: true, categories: data.finance.categories });
});

// Get finance entries
router.get('/entries', requireAuth, (req, res) => {
  const { start, end } = req.query;
  let entries = db.load().finance.entries || [];
  
  // Filter by date range
  if (start) entries = entries.filter(e => e.date >= start);
  if (end) entries = entries.filter(e => e.date <= end);
  
  // Calculate balances
  const runningBalance = (db.load().finance.entries || []).reduce((total, entry) => {
    return total + (entry.type === 'credit' ? entry.amount : -entry.amount);
  }, 0);
  
  const periodBalance = entries.reduce((total, entry) => {
    return total + (entry.type === 'credit' ? entry.amount : -entry.amount);
  }, 0);

  res.json({ 
    entries, 
    running: runningBalance,
    balance: periodBalance 
  });
});

// Add finance entry
router.post('/entries', requireAuth, (req, res) => {
  const { date, type, category, amount, note } = req.body;
  
  if (!date || !type || !category) {
    return res.status(400).json({ error: 'Date, type, and category are required' });
  }

  const entry = {
    id: uuidv4(),
    date,
    type,
    category,
    amount: Math.max(0, Number(amount) || 0),
    note: note || '',
    createdAt: new Date().toISOString()
  };

  const data = db.load();
  data.finance.entries.push(entry);
  db.save(data);

  res.json({ ok: true, entry });
});

// Delete finance entry
router.delete('/entries/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  data.finance.entries = data.finance.entries.filter(e => e.id !== id);
  db.save(data);
  
  res.json({ ok: true });
});

module.exports = router;
