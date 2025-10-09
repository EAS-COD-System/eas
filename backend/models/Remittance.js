import mongoose from 'mongoose';
const remittanceSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  country: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  orders: { type: Number, default: 0 },
  pieces: { type: Number, default: 0 },
  revenueUSD: { type: Number, default: 0 },
  adCostUSD: { type: Number, default: 0 },
  deliveryCostsUSD: { type: Number, default: 0 },
  profitUSD: { type: Number, default: 0 }
}, { timestamps: true });
export default mongoose.model('Remittance', remittanceSchema);
