import mongoose from 'mongoose';
const dailyDeliveredSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  country: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  delivered: { type: Number, default: 0 }
}, { timestamps: true });
dailyDeliveredSchema.index({ date:1, country:1, product:1 }, { unique: true, sparse: true });
export default mongoose.model('DailyDelivered', dailyDeliveredSchema);
