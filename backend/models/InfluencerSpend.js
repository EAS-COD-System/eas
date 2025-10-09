import mongoose from 'mongoose';
const influencerSpendSchema = new mongoose.Schema({
  name: { type: String, required: true },
  country: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  socialHandle: { type: String },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  amountUSD: { type: Number, default: 0 },
  date: { type: Date, required: true }
}, { timestamps: true });
export default mongoose.model('InfluencerSpend', influencerSpendSchema);
