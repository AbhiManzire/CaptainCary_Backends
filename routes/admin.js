const express = require('express');
const { body, validationResult } = require('express-validator');
const Admin = require('../models/Admin');
const Client = require('../models/Client');
const Crew = require('../models/Crew');
const ClientRequest = require('../models/ClientRequest');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(auth, adminAuth);

// Get dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    const crewStats = await Crew.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          missingDocs: { $sum: { $cond: [{ $eq: ['$status', 'missing_docs'] }, 1, 0] } },
          urgent: { $sum: { $cond: ['$priority', 1, 0] } }
        }
      }
    ]);

    const recentCrew = await Crew.find()
      .sort({ submittedAt: -1 })
      .limit(5)
      .select('fullName rank nationality status submittedAt');

    const clientStats = await Client.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } }
        }
      }
    ]);

    const pendingRequests = await ClientRequest.find({ status: 'pending' })
      .populate('client', 'companyName contactPerson')
      .populate('crew', 'fullName rank nationality')
      .sort({ requestedAt: -1 })
      .limit(10);

    res.json({
      crewStats: crewStats[0] || { total: 0, pending: 0, approved: 0, rejected: 0, missingDocs: 0, urgent: 0 },
      clientStats: clientStats[0] || { total: 0, active: 0 },
      recentCrew,
      pendingRequests
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all clients
router.get('/clients', async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    
    const query = {};
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const clients = await Client.find(query)
      .select('-password')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Client.countDocuments(query);

    res.json({
      clients,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get clients error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new client
router.post('/clients', [
  body('companyName').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('contactPerson').notEmpty().trim(),
  body('phone').notEmpty().trim(),
  body('address').notEmpty().trim(),
  body('industry').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { companyName, email, password, contactPerson, phone, address, industry } = req.body;

    // Check if client already exists
    const existingClient = await Client.findOne({ email });
    if (existingClient) {
      return res.status(400).json({ message: 'Client already exists with this email' });
    }

    const client = new Client({
      companyName,
      email,
      password,
      contactPerson,
      phone,
      address,
      industry
    });

    await client.save();

    res.status(201).json({
      message: 'Client created successfully',
      client: {
        id: client._id,
        companyName: client.companyName,
        email: client.email,
        contactPerson: client.contactPerson,
        phone: client.phone,
        address: client.address,
        industry: client.industry
      }
    });
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update client status
router.patch('/clients/:id/status', [
  body('isActive').isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { isActive } = req.body;
    const client = await Client.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true }
    ).select('-password');

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    res.json(client);
  } catch (error) {
    console.error('Update client status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get client requests
router.get('/requests', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = {};
    if (status) query.status = status;

    const requests = await ClientRequest.find(query)
      .populate('client', 'companyName contactPerson email')
      .populate('crew', 'fullName rank nationality email')
      .sort({ requestedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ClientRequest.countDocuments(query);

    res.json({
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Respond to client request
router.patch('/requests/:id/respond', [
  body('status').isIn(['approved', 'rejected', 'completed']),
  body('adminResponse').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, adminResponse } = req.body;
    
    const request = await ClientRequest.findByIdAndUpdate(
      req.params.id,
      { 
        status, 
        adminResponse,
        respondedAt: new Date()
      },
      { new: true }
    ).populate('client', 'companyName contactPerson email')
     .populate('crew', 'fullName rank nationality email');

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Respond to request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Export crew data
router.get('/export/crew', async (req, res) => {
  try {
    const { status, rank, nationality } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (rank) query.rank = rank;
    if (nationality) query.nationality = nationality;

    const crews = await Crew.find(query)
      .select('-documents -internalComments -adminNotes')
      .sort({ submittedAt: -1 });

    // Convert to CSV format
    const csvHeader = 'Name,Email,Phone,Rank,Nationality,Location,DOB,Availability,Status,Priority,Submitted\n';
    const csvData = crews.map(crew => 
      `"${crew.fullName}","${crew.email}","${crew.phone}","${crew.rank}","${crew.nationality}","${crew.currentLocation}","${crew.dateOfBirth.toISOString().split('T')[0]}","${crew.availabilityDate.toISOString().split('T')[0]}","${crew.status}","${crew.priority}","${crew.submittedAt.toISOString().split('T')[0]}"`
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=crew-data.csv');
    res.send(csvHeader + csvData);
  } catch (error) {
    console.error('Export crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
