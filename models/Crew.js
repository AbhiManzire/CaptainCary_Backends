const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now }
});

const crewSchema = new mongoose.Schema({
  // Personal Information
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  rank: { 
    type: String, 
    required: true,
    enum: [
      'Master / Captain', 'Chief Officer', '2nd Officer', '3rd Officer',
      'Chief Engineer', '2nd Engineer', 'ETO', 'AB (Able Seaman)',
      'OS (Ordinary Seaman)', 'Bosun', 'Motorman', 'Oiler',
      'Cook / Chief Cook', 'Messman', 'Deck Cadet', 'Engine Cadet',
      'Welder / Fitter', 'Rigger', 'Crane Operator', 'HLO / HDA',
      'Marine Electrician', 'Safety Officer', 'Yacht Skipper / Delivery Crew',
      'Project Engineer', 'Marine Surveyor', 'Others'
    ]
  },
  nationality: { type: String, required: true },
  currentLocation: { type: String, required: true },
  dateOfBirth: { type: Date, required: true },
  availabilityDate: { type: Date, required: true },
  
  // Optional Information
  seaTimeSummary: { type: String },
  preferredVesselType: { 
    type: String,
    enum: ['Tanker', 'AHTS', 'Yacht', 'Barge', 'Container', 'Bulk Carrier', 'Offshore', 'Other']
  },
  additionalNotes: { type: String },
  
  // Documents
  documents: {
    cv: { type: documentSchema, required: true },
    passport: { type: documentSchema, required: true },
    cdc: { type: documentSchema, required: true },
    stcw: { type: documentSchema, required: true },
    coc: { type: documentSchema, required: true },
    seamanBook: { type: documentSchema, required: true },
    visa: { type: documentSchema, required: true },
    photo: { type: documentSchema } // Only photo is optional
  },
  
  // Admin Management
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'missing_docs'],
    default: 'pending'
  },
  priority: { type: Boolean, default: false },
  tags: [{ type: String }],
  internalComments: { type: String },
  adminNotes: { type: String },
  
  // Client Access
  approvedForClients: { type: Boolean, default: false },
  clientShortlists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Client' }],
  
  // Timestamps
  submittedAt: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now }
});

// Update lastUpdated on save
crewSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

module.exports = mongoose.model('Crew', crewSchema);
