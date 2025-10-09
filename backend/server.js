import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import productRoutes from './routes/productRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import shipmentRoutes from './routes/shipmentRoutes.js';
import performanceRoutes from './routes/performanceRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import influencerRoutes from './routes/influencerRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

await connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600
});
app.use(limiter);

app.get('/', (req, res) => res.json({ ok: true, name: 'EAS Backend', currency: process.env.CURRENCY || 'USD' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/influencers', influencerRoutes);

app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

app.listen(PORT, () => console.log(`EAS backend running on :${PORT}`));
