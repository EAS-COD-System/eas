const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Get all shipments
router.get('/shipments', requireAuth, (req, res) => {
  const shipments = db.getShipments();
  res.json({ shipments });
});

// Create new shipment
router.post('/shipments', requireAuth, (req, res) => {
  const { productId, fromCountry, toCountry, qty, shipCost, departedAt, arrivedAt } = req.body;
  
  if (!productId || !fromCountry || !toCountry) {
    return res.status(400).json({ error: 'Product, from country, and to country are required' });
  }

  const shipment = {
    id: uuidv4(),
    productId,
    fromCountry: fromCountry.toLowerCase(),
    toCountry: toCountry.toLowerCase(),
    qty: Math.max(0, Number(qty) || 0),
    shipCost: Math.max(0, Number(shipCost) || 0),
    departedAt: departedAt || new Date().toISOString().slice(0, 10),
    arrivedAt: arrivedAt || null,
    status: arrivedAt ? 'arrived' : 'transit',
    createdAt: new Date().toISOString()
  };

  const data = db.load();
  data.inventory.shipments.push(shipment);
  db.save(data);

  res.json({ ok: true, shipment });
});

// Update shipment
router.put('/shipments/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const data = db.load();
  const shipment = data.inventory.shipments.find(s => s.id === id);
  
  if (!shipment) {
    return res.status(404).json({ error: 'Shipment not found' });
  }

  if (updates.qty !== undefined) shipment.qty = Math.max(0, Number(updates.qty) || 0);
  if (updates.shipCost !== undefined) shipment.shipCost = Math.max(0, Number(updates.shipCost) || 0);
  if (updates.departedAt !== undefined) shipment.departedAt = updates.departedAt;
  if (updates.arrivedAt !== undefined) {
    shipment.arrivedAt = updates.arrivedAt;
    shipment.status = updates.arrivedAt ? 'arrived' : 'transit';
  }
  
  db.save(data);
  res.json({ ok: true, shipment });
});

// Delete shipment
router.delete('/shipments/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  const data = db.load();
  data.inventory.shipments = data.inventory.shipments.filter(s => s.id !== id);
  db.save(data);
  
  res.json({ ok: true });
});

// Get deliveries
router.get('/deliveries', requireAuth, (req, res) => {
  const deliveries = db.load().inventory.deliveries || [];
  res.json({ deliveries });
});

// Add delivery
router.post('/deliveries', requireAuth, (req, res) => {
  const { date, country, delivered } = req.body;
  
  if (!date || !country) {
    return res.status(400).json({ error: 'Date and country are required' });
  }

  const delivery = {
    id: uuidv4(),
    date,
    country: country.toLowerCase(),
    delivered: Math.max(0, Number(delivered) || 0),
    recordedAt: new Date().toISOString()
  };

  const data = db.load();
  data.inventory.deliveries.push(delivery);
  db.save(data);

  res.json({ ok: true, delivery });
});

// Get stock levels by country
router.get('/stock-levels', requireAuth, (req, res) => {
  const data = db.load();
  const countries = data.business.countries.filter(c => c !== 'china');
  const stockLevels = {};
  
  // Initialize stock levels
  countries.forEach(country => {
    stockLevels[country] = {
      stock: 0,
      adSpend: 0,
      inTransit: 0
    };
  });

  // Calculate stock from shipments
  data.inventory.shipments.forEach(shipment => {
    if (shipment.arrivedAt) {
      // Add to destination country
      if (shipment.toCountry !== 'china' && stockLevels[shipment.toCountry]) {
        stockLevels[shipment.toCountry].stock += shipment.qty;
      }
      // Remove from origin country  
      if (shipment.fromCountry !== 'china' && stockLevels[shipment.fromCountry]) {
        stockLevels[shipment.fromCountry].stock -= shipment.qty;
      }
    }
  });

  // Subtract delivered pieces
  data.sales.remittances.forEach(remittance => {
    if (remittance.country !== 'china' && stockLevels[remittance.country]) {
      stockLevels[remittance.country].stock -= remittance.pieces;
    }
  });

  // Calculate in-transit shipments
  data.inventory.shipments.forEach(shipment => {
    if (!shipment.arrivedAt && shipment.toCountry !== 'china' && stockLevels[shipment.toCountry]) {
      stockLevels[shipment.toCountry].inTransit += shipment.qty;
    }
  });

  // Add ad spend
  data.marketing.adSpend.forEach(ad => {
    if (ad.country !== 'china' && stockLevels[ad.country]) {
      stockLevels[ad.country].adSpend += ad.amount;
    }
  });

  res.json({ stockLevels });
});

module.exports = router;
