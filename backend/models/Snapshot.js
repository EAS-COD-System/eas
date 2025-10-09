import mongoose from 'mongoose';
const snapshotSchema = new mongoose.Schema({
  createdAt: { type: Date, default: Date.now },
  label: { type: String },
  payload: { type: Object, default: {} }
}, { timestamps: true });
export default mongoose.model('Snapshot', snapshotSchema);
