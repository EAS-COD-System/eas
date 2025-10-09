import dotenv from 'dotenv';
import { connectDB } from '../config/db.js';
import Snapshot from '../models/Snapshot.js';
import User from '../models/User.js';
import Country from '../models/Country.js';
import Product from '../models/Product.js';
import Stock from '../models/Stock.js';
import DailyDelivered from '../models/DailyDelivered.js';
import AdSpend from '../models/AdSpend.js';
import Shipment from '../models/Shipment.js';
import Remittance from '../models/Remittance.js';
import FinanceEntry from '../models/FinanceEntry.js';
import Todo from '../models/Todo.js';
import WeeklyTodo from '../models/WeeklyTodo.js';
import InfluencerSpend from '../models/InfluencerSpend.js';

dotenv.config();
await connectDB();

const cmd = process.argv[2];

if (cmd === 'create') {
  const payload = {};
  payload.users = await User.find();
  payload.countries = await Country.find();
  payload.products = await Product.find();
  payload.stock = await Stock.find();
  payload.dailyDelivered = await DailyDelivered.find();
  payload.adSpend = await AdSpend.find();
  payload.shipments = await Shipment.find();
  payload.remittances = await Remittance.find();
  payload.financeEntries = await FinanceEntry.find();
  payload.todos = await Todo.find();
  payload.weeklyTodos = await WeeklyTodo.find();
  payload.influencerSpends = await InfluencerSpend.find();
  const snap = await Snapshot.create({ label: new Date().toISOString(), payload });
  console.log('Snapshot created', snap._id.toString());
  process.exit(0);
} else if (cmd === 'restore') {
  const id = process.argv[3];
  if (!id) { console.error('Usage: npm run restore:snapshot -- <snapshotId>'); process.exit(1); }
  const snap = await Snapshot.findById(id);
  if (!snap) { console.error('Snapshot not found'); process.exit(1); }
  const p = snap.payload;
  // simple destructive restore
  await Promise.all([
    User.deleteMany({}), Country.deleteMany({}), Product.deleteMany({}), Stock.deleteMany({}),
    DailyDelivered.deleteMany({}), AdSpend.deleteMany({}), Shipment.deleteMany({}), Remittance.deleteMany({}),
    FinanceEntry.deleteMany({}), Todo.deleteMany({}), WeeklyTodo.deleteMany({}), InfluencerSpend.deleteMany({})
  ]);
  await Promise.all([
    User.insertMany(p.users || []), Country.insertMany(p.countries || []), Product.insertMany(p.products || []),
    Stock.insertMany(p.stock || []), DailyDelivered.insertMany(p.dailyDelivered || []), AdSpend.insertMany(p.adSpend || []),
    Shipment.insertMany(p.shipments || []), Remittance.insertMany(p.remittances || []), FinanceEntry.insertMany(p.financeEntries || []),
    Todo.insertMany(p.todos || []), WeeklyTodo.insertMany(p.weeklyTodos || []), InfluencerSpend.insertMany(p.influencerSpends || [])
  ]);
  console.log('Restore complete');
  process.exit(0);
} else {
  console.log('Usage: npm run make:snapshot | npm run restore:snapshot -- <snapshotId>');
  process.exit(0);
}
