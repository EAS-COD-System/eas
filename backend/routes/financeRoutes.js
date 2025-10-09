import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import FinanceEntry from '../models/FinanceEntry.js';

const router = Router();
router.use(authRequired);

router.get('/entries', async (req, res) => {
  const { from, to } = req.query;
  const q = {};
  if (from || to) q.date = {};
  if (from) q.date.$gte = new Date(from);
  if (to) q.date.$lte = new Date(to);
  const list = await FinanceEntry.find(q).sort('-date');
  const balance = list.reduce((acc, e) => acc + (e.type === 'credit' ? e.amountUSD : -e.amountUSD), 0);
  res.json({ balance, entries: list });
});

router.post('/entries', async (req, res) => {
  const e = await FinanceEntry.create(req.body);
  res.json(e);
});

router.delete('/entries/:id', async (req, res) => {
  await FinanceEntry.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
