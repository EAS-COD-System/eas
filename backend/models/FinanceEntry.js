import mongoose from 'mongoose';
const financeEntrySchema = new mongoose.Schema({
  date: { type: Date, required: true },
  name: { type: String, required: true },
  amountUSD: { type: Number, required: true },
  type: { type: String, enum: ['credit', 'debit'], required: true },
  period: { type: String }
}, { timestamps: true });
export default mongoose.model('FinanceEntry', financeEntrySchema);
