const mongoose = require('mongoose');

const clientRequestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  crew: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Crew',
    required: true
  },
  requestType: {
    type: String,
    required: true,
    enum: ['Interview Request', 'Booking Request', 'Hold Candidate', 'More Information']
  },
  message: {
    type: String,
    maxlength: 1000
  },
  urgency: {
    type: String,
    enum: ['normal', 'urgent', 'asap'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'completed'],
    default: 'pending'
  },
  adminResponse: {
    type: String,
    maxlength: 1000
  },
  requestedAt: {
    type: Date,
    default: Date.now
  },
  respondedAt: {
    type: Date
  },
  followUps: [{
    message: {
      type: String,
      required: true
    },
    sentBy: {
      type: String,
      enum: ['client', 'admin'],
      required: true
    },
    sentAt: {
      type: Date,
      default: Date.now
    }
  }]
});

// Index for better query performance
clientRequestSchema.index({ client: 1, requestedAt: -1 });
clientRequestSchema.index({ crew: 1, requestedAt: -1 });
clientRequestSchema.index({ status: 1, requestedAt: -1 });

module.exports = mongoose.model('ClientRequest', clientRequestSchema);