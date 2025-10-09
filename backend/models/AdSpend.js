import mongoose from 'mongoose';
const adSpendSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  country: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  platform: { type: String, enum: ['Facebook','TikTok','Google'], required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  amountUSD: { type: Number, default: 0 }
}, { timestamps: true });
adSpendSchema.index({ date:1, country:1, platform:1, product:1 }, { unique: true });
export default mongoose.model('AdSpend', adSpendSchema);
