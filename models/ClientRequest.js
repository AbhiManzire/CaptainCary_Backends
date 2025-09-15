const mongoose = require('mongoose');

const clientRequestSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  crew: { type: mongoose.Schema.Types.ObjectId, ref: 'Crew', required: true },
  requestType: { 
    type: String, 
    enum: ['interview', 'booking', 'hold_candidate'],
    required: true 
  },
  message: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  adminResponse: { type: String },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date }
});

module.exports = mongoose.model('ClientRequest', clientRequestSchema);
