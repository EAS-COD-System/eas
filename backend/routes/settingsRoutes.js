import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Country from '../models/Country.js';
import Product from '../models/Product.js';
import Snapshot from '../models/Snapshot.js';
import User from '../models/User.js';
import mongoose from 'mongoose';

const router = Router();
router.use(authRequired);

// Countries
router.get('/countries', async (req, res) => {
  const list = await Country.find().sort('name');
  res.json(list);
});
router.post('/countries', async (req, res) => {
  const c = await Country.create({ name: req.body.name });
  res.json(c);
});
router.delete('/countries/:id', async (req, res) => {
  await Country.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// Edit product info quick patch
router.patch('/products/:id', async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(p);
});

// System Restore - snapshots
router.post('/snapshot', async (req, res) => {
  // naive dump of collections
  const payload = {};
  const collections = {
    users: await User.find(),
    countries: await Country.find(),
    products: await Product.find()
  };
  for (const [k,v] of Object.entries(collections)) payload[k] = v;
  const snap = await Snapshot.create({ label: req.body.label, payload });
  res.json({ ok: true, snapshotId: snap._id });
});

router.post('/restore', async (req, res) => {
  const { snapshotId } = req.body;
  const snap = await Snapshot.findById(snapshotId);
  if (!snap) return res.status(404).json({ message: 'Snapshot not found' });
  // Simple selective restore example
  const s = snap.payload;
  if (s.countries) {
    await Country.deleteMany({});
    await Country.insertMany(s.countries.map(d => ({ name: d.name, _id: new mongoose.Types.ObjectId(d._id) })));
  }
  if (s.products) {
    await Product.deleteMany({});
    await Product.insertMany(s.products.map(d => ({ ...d.toObject?.() || d, _id: new mongoose.Types.ObjectId(d._id) })));
  }
  res.json({ ok: true });
});

export default router;
