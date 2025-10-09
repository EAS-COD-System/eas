import mongoose from 'mongoose';
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sku: { type: String, unique: true, required: true },
  costFromChina: { type: Number, default: 0 },
  shippingToKenya: { type: Number, default: 0 },
  profitTarget: { type: Number, default: 0 },
  adBudget: { type: Number, default: 0 },
  paused: { type: Boolean, default: false }
}, { timestamps: true });
export default mongoose.model('Product', productSchema);
