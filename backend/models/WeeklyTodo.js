import mongoose from 'mongoose';
const weeklyTodoSchema = new mongoose.Schema({
  weekday: { type: Number, min:0, max:6, required: true },
  text: { type: String, required: true },
  done: { type: Boolean, default: false }
}, { timestamps: true });
export default mongoose.model('WeeklyTodo', weeklyTodoSchema);
