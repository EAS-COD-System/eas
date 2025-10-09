import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Shipment from '../models/Shipment.js';

const router = Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const list = await Shipment.find().populate('product sourceCountry destCountry').sort('-createdAt');
  res.json(list);
});

router.post('/', async (req, res) => {
  const s = await Shipment.create(req.body);
  res.json(s);
});

router.post('/:id/arrive', async (req, res) => {
  const s = await Shipment.findByIdAndUpdate(req.params.id, { status: 'arrived', arrivedAt: new Date() }, { new: true });
  res.json(s);
});

router.put('/:id', async (req, res) => {
  const s = await Shipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(s);
});

router.delete('/:id', async (req, res) => {
  await Shipment.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

export default router;
