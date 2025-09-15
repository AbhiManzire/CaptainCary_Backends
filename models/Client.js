const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const clientSchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  contactPerson: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  industry: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  shortlistedCrew: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Crew' }],
  createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
clientSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
clientSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Client', clientSchema);
