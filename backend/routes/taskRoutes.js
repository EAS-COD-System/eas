import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import Todo from '../models/Todo.js';
import WeeklyTodo from '../models/WeeklyTodo.js';

const router = Router();
router.use(authRequired);

// To-Do
router.get('/todos', async (req, res) => res.json(await Todo.find().sort('-createdAt')));
router.post('/todos', async (req, res) => res.json(await Todo.create({ text: req.body.text })));
router.post('/todos/:id/toggle', async (req, res) => {
  const t = await Todo.findById(req.params.id);
  t.done = !t.done;
  await t.save();
  res.json(t);
});
router.delete('/todos/:id', async (req, res) => { await Todo.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

// Weekly To-Do
router.get('/weekly', async (req, res) => res.json(await WeeklyTodo.find().sort('weekday')));
router.post('/weekly', async (req, res) => res.json(await WeeklyTodo.create({ weekday: req.body.weekday, text: req.body.text })));
router.post('/weekly/:id/toggle', async (req, res) => {
  const t = await WeeklyTodo.findById(req.params.id);
  t.done = !t.done;
  await t.save();
  res.json(t);
});
router.delete('/weekly/:id', async (req, res) => { await WeeklyTodo.findByIdAndDelete(req.params.id); res.json({ ok: true }); });

export default router;
