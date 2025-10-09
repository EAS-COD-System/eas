import mongoose from 'mongoose';
const shipmentSchema = new mongoose.Schema({
  type: { type: String, enum: ['CN-KE', 'OTHER'], required: true },
  sourceCountry: { type: mongoose.Schema.Types.ObjectId, ref: 'Country' },
  destCountry: { type: mongoose.Schema.Types.ObjectId, ref: 'Country' },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  qty: { type: Number, required: true },
  shippingCostUSD: { type: Number, default: 0 },
  status: { type: String, enum: ['in_transit', 'arrived'], default: 'in_transit' },
  createdAt: { type: Date, default: Date.now },
  arrivedAt: { type: Date }
}, { timestamps: true });
export default mongoose.model('Shipment', shipmentSchema);
