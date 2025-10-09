import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Product from '../models/Product.js';
import Country from '../models/Country.js';
import Stock from '../models/Stock.js';
import Shipment from '../models/Shipment.js';
import AdSpend from '../models/AdSpend.js';
import DailyDelivered from '../models/DailyDelivered.js';
import Remittance from '../models/Remittance.js';

const router = Router();
router.use(authRequired);

// 1 Summary stats
router.get('/summary', async (req, res) => {
  const [products, warehouses, inTransit, totalAdSpend] = await Promise.all([
    Product.countDocuments({ paused: { $ne: true } }),
    Country.countDocuments(),
    Shipment.countDocuments({ status: 'in_transit' }),
    AdSpend.aggregate([{ $group: { _id: null, s: { $sum: '$amountUSD' } } }])
  ]);
  const adTotal = totalAdSpend[0]?.s || 0;

  // total delivered Mon-Sun last 7 days
  const since = new Date(Date.now() - 7*24*60*60*1000);
  const deliveredAgg = await DailyDelivered.aggregate([
    { $match: { date: { $gte: since } } },
    { $group: { _id: null, total: { $sum: '$delivered' } } }
  ]);
  res.json({ products, warehouses, transitShipments: inTransit, totalAdvertisingSpendUSD: adTotal, totalDeliveredLast7Days: deliveredAgg[0]?.total || 0 });
});

// 2 Stock by country + ad spend per country
router.get('/stock-by-country', async (req, res) => {
  const stock = await Stock.aggregate([
    { $group: { _id: '$country', qty: { $sum: '$qty' } } }
  ]);
  const ad = await AdSpend.aggregate([
    { $group: { _id: '$country', spend: { $sum: '$amountUSD' } } }
  ]);
  res.json({ stock, ad });
});

// 3 Daily Delivered CRUD
router.get('/daily-delivered', async (req, res) => {
  const { from, to } = req.query;
  const q = {};
  if (from || to) q.date = {};
  if (from) q.date.$gte = new Date(from);
  if (to) q.date.$lte = new Date(to);
  const list = await DailyDelivered.find(q).populate('country product').sort('-date').limit(200);
  res.json(list);
});
router.post('/daily-delivered', async (req, res) => {
  const row = await DailyDelivered.findOneAndUpdate(
    { date: new Date(req.body.date), country: req.body.country, product: req.body.product || null },
    { $set: { delivered: req.body.delivered } },
    { new: true, upsert: true }
  );
  res.json(row);
});

// 4 Daily Ad Spend input
router.post('/ad-spend', async (req, res) => {
  const row = await (await AdSpend.findOneAndUpdate(
    { date: new Date(req.body.date), country: req.body.country, platform: req.body.platform, product: req.body.product },
    { $set: { amountUSD: req.body.amountUSD } },
    { new: true, upsert: true }
  ));
  res.json(row);
});

// 5 Stock Movement (transfer)
router.post('/stock/transfer', async (req, res) => {
  const { sourceCountry, destCountry, product, quantity } = req.body;
  if (String(sourceCountry) === String(destCountry)) return res.status(400).json({ message: 'Source and destination must differ' });
  const from = await Stock.findOneAndUpdate({ product, country: sourceCountry }, { $inc: { qty: -quantity } }, { upsert: true, new: true });
  const to = await Stock.findOneAndUpdate({ product, country: destCountry }, { $inc: { qty: quantity } }, { upsert: true, new: true });
  res.json({ from, to });
});

// 8 Profit summary by country
router.get('/profit-by-country', async (req, res) => {
  const { from, to } = req.query;
  const q = {};
  if (from || to) q.date = {};
  if (from) q.date.$gte = new Date(from);
  if (to) q.date.$lte = new Date(to);
  const agg = await Remittance.aggregate([
    { $match: q },
    { $group: { _id: '$country', revenue: { $sum: '$revenueUSD' }, adSpend: { $sum: '$adCostUSD' }, profit: { $sum: '$profitUSD' } } }
  ]);
  res.json(agg);
});

export default router;
