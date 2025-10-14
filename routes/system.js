const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// Get system meta data
router.get('/meta', requireAuth, (req, res) => {
  const data = db.load();
  res.json({
    countries: data.business.countries.filter(c => c !== 'china'),
    currencies: data.business.currencies
  });
});

// Get all countries
router.get('/countries', requireAuth, (req, res) => {
  const countries = db.load().business.countries || [];
  res.json({ countries });
});

// Add country
router.post('/countries', requireAuth, (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Country name is required' });
  }

  const data = db.load();
  const countryName = name.toLowerCase().trim();
  
  if (!data.business.countries.includes(countryName)) {
    data.business.countries.push(countryName);
    data.business.currencies[countryName] = 'USD';
    db.save(data);
  }

  res.json({ ok: true, countries: data.business.countries });
});

// Delete country
router.delete('/countries/:name', requireAuth, (req, res) => {
  const { name } = req.params;
  const countryName = name.toLowerCase();
  
  if (countryName === 'china') {
    return res.status(400).json({ error: 'China cannot be deleted' });
  }

  const data = db.load();
  data.business.countries = data.business.countries.filter(c => c !== countryName);
  delete data.business.currencies[countryName];
  db.save(data);

  res.json({ ok: true, countries: data.business.countries });
});

// Snapshots management
const SNAPSHOT_DIR = path.join(__dirname, '..', 'data', 'snapshots');

router.get('/snapshots', requireAuth, (req, res) => {
  const snapshots = db.load().systemData.snapshots || [];
  res.json({ snapshots });
});

router.post('/snapshots', requireAuth, async (req, res) => {
  const { name } = req.body;
  
  try {
    await fs.ensureDir(SNAPSHOT_DIR);
    
    const snapshotName = (name || `Manual ${new Date().toLocaleString()}`).trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotFile = path.join(SNAPSHOT_DIR, `${timestamp}-${snapshotName.replace(/\s+/g, '_')}.json`);
    
    // Copy current database to snapshot
    await fs.copy(db.DATA_FILE, snapshotFile);
    
    const snapshot = {
      id: uuidv4(),
      name: snapshotName,
      file: snapshotFile,
      createdAt: new Date().toISOString(),
      kind: 'manual'
    };

    const data = db.load();
    data.systemData.snapshots = data.systemData.snapshots || [];
    data.systemData.snapshots.unshift(snapshot);
    db.save(data);

    res.json({ ok: true, snapshot });
  } catch (error) {
    console.error('Snapshot error:', error);
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

router.post('/snapshots/restore', requireAuth, async (req, res) => {
  const { file } = req.body;
  
  if (!file) {
    return res.status(400).json({ error: 'Snapshot file is required' });
  }

  try {
    const safeFile = path.join(SNAPSHOT_DIR, path.basename(file));
    
    if (!await fs.pathExists(safeFile)) {
      return res.status(404).json({ error: 'Snapshot file not found' });
    }

    // Restore from snapshot
    await fs.copy(safeFile, db.DATA_FILE);
    
    res.json({ ok: true, message: 'System restored successfully' });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore snapshot' });
  }
});

router.delete('/snapshots/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  
  try {
    const data = db.load();
    const snapshot = data.systemData.snapshots.find(s => s.id === id);
    
    if (snapshot && snapshot.file && await fs.pathExists(snapshot.file)) {
      await fs.remove(snapshot.file);
    }
    
    data.systemData.snapshots = data.systemData.snapshots.filter(s => s.id !== id);
    db.save(data);
    
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete snapshot error:', error);
    res.status(500).json({ error: 'Failed to delete snapshot' });
  }
});

module.exports = router;
