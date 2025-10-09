import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Remittance from '../models/Remittance.js';
import Product from '../models/Product.js';
import mongoose from 'mongoose';

const router = Router();
router.use(authRequired);

// Top Delivered Products (last N days)
router.get('/top-delivered', async (req, res) => {
  const days = parseInt(req.query.days || '8', 10);
  const since = new Date(Date.now() - days*24*60*60*1000);
  const agg = await Remittance.aggregate([
    { $match: { date: { $gte: since } } },
    { $group: { _id: '$product', deliveries: { $sum: '$pieces' }, adSpend: { $sum: '$adCostUSD' }, revenue: { $sum: '$revenueUSD' }, profit: { $sum: '$profitUSD' } } },
    { $sort: { deliveries: -1 } },
    { $limit: 50 }
  ]);
  const products = await Product.find({ _id: { $in: agg.map(a => a._id) } });
  const map = Object.fromEntries(products.map(p => [p._id.toString(), p]));
  res.json(agg.map(a => ({
    product: map[a._id.toString()]?.name || a._id,
    deliveries: a.deliveries,
    adSpend: a.adSpend,
    revenue: a.revenue,
    totalProfit: a.profit
  })));
});

// Remittance CRUD
router.get('/remittances', async (req, res) => {
  const list = await Remittance.find().sort('-date');
  res.json(list);
});

router.post('/remittances', async (req, res) => {
  const r = await Remittance.create(req.body);
  res.json(r);
});

router.put('/remittances/:id', async (req, res) => {
  const r = await Remittance.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(r);
});

router.delete('/remittances/:id', async (req, res) => {
  await Remittance.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
