import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import InfluencerSpend from '../models/InfluencerSpend.js';

const router = Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const { from, to, country } = req.query;
  const q = {};
  if (country) q.country = country;
  if (from || to) q.date = {};
  if (from) q.date.$gte = new Date(from);
  if (to) q.date.$lte = new Date(to);
  const list = await InfluencerSpend.find(q).populate('country product').sort('-date');
  const total = list.reduce((a, b) => a + (b.amountUSD || 0), 0);
  res.json({ total, items: list });
});
router.post('/', async (req, res) => res.json(await InfluencerSpend.create(req.body)));
router.put('/:id', async (req, res) => res.json(await InfluencerSpend.findByIdAndUpdate(req.params.id, req.body, { new: true })));
router.delete('/:id', async (req, res) => { await InfluencerSpend.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

export default router;
