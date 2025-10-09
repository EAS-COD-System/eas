import mongoose from 'mongoose';
const stockSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  country: { type: mongoose.Schema.Types.ObjectId, ref: 'Country', required: true },
  qty: { type: Number, default: 0 }
}, { timestamps: true });
stockSchema.index({ product: 1, country: 1 }, { unique: true });
export default mongoose.model('Stock', stockSchema);
