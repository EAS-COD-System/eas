import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Product from '../models/Product.js';
import Stock from '../models/Stock.js';

const router = Router();
router.use(authRequired);

// CRUD
router.get('/', async (req, res) => {
  const list = await Product.find().sort('-createdAt');
  res.json(list);
});
router.post('/', async (req, res) => {
  const p = await Product.create(req.body);
  res.json(p);
});
router.get('/:id', async (req, res) => {
  const p = await Product.findById(req.params.id);
  res.json(p);
});
router.put('/:id', async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(p);
});
router.delete('/:id', async (req, res) => {
  await Product.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});
router.post('/:id/pause', async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, { paused: true }, { new: true });
  res.json(p);
});
router.post('/:id/resume', async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, { paused: false }, { new: true });
  res.json(p);
});

// country-wise stock
router.get('/:id/stock', async (req, res) => {
  const rows = await Stock.find({ product: req.params.id }).populate('country');
  res.json(rows);
});

export default router;
