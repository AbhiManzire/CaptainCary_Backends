const express = require('express');
const { body, validationResult } = require('express-validator');
const Admin = require('../models/Admin');
const Client = require('../models/Client');
const Crew = require('../models/Crew');
const ClientRequest = require('../models/ClientRequest');
const Reminder = require('../models/Reminder');
const { auth, adminAuth } = require('../middleware/auth');
const whatsappService = require('../services/whatsappService');
const { sendClientCrewStatusNotification, sendClientRequestStatusNotification } = require('../services/notificationService');

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

    // Get urgent crew (available within next 7 days)
    const urgentCrew = await Crew.find({
      status: 'approved',
      availabilityDate: { 
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
        $gte: new Date() // Not in the past
      }
    })
      .select('fullName rank nationality availabilityDate priority')
      .sort({ availabilityDate: 1 })
      .limit(10);

    res.json({
      crewStats: crewStats[0] || { total: 0, pending: 0, approved: 0, rejected: 0, missingDocs: 0, urgent: 0 },
      clientStats: clientStats[0] || { total: 0, active: 0 },
      recentCrew,
      pendingRequests,
      urgentCrew
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

// Get client by ID
router.get('/clients/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id).select('-password');
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }
    res.json(client);
  } catch (error) {
    console.error('Get client error:', error);
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
    const { page = 1, limit = 10, status, search } = req.query;
    
    const query = {};
    if (status) query.status = status;

    let requests = await ClientRequest.find(query)
      .populate('client', 'companyName contactPerson email phone')
      .populate('crew', 'fullName rank nationality email')
      .sort({ requestedAt: -1 });

    // Apply search filter after populating
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      requests = requests.filter(request => 
        request.requestType?.match(searchRegex) ||
        request.message?.match(searchRegex) ||
        request.client?.companyName?.match(searchRegex) ||
        request.client?.contactPerson?.match(searchRegex) ||
        request.crew?.fullName?.match(searchRegex) ||
        request.crew?.rank?.match(searchRegex)
      );
    }

    // Apply pagination after filtering
    const total = requests.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    requests = requests.slice(startIndex, endIndex);

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

// Get request by ID
router.get('/requests/:id', async (req, res) => {
  try {
    const request = await ClientRequest.findById(req.params.id)
      .populate('client', 'companyName contactPerson email phone address industry')
      .populate('crew', 'fullName rank nationality email phone currentLocation');
    
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }
    res.json(request);
  } catch (error) {
    console.error('Get request error:', error);
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

    // Send notification to client
    try {
      await sendClientRequestStatusNotification(request.client, request, status);
    } catch (notificationError) {
      console.error('Client notification error:', notificationError);
      // Don't fail the request if notifications fail
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
    if (nationality) query.nationality = { $regex: nationality, $options: 'i' };

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

// Assign crew to specific client shortlist (admin only)
router.post('/crew/:crewId/assign-client', [
  body('clientId').isMongoId().withMessage('Valid client ID required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewId } = req.params;
    const { clientId } = req.body;

    const crew = await Crew.findById(crewId);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Add client to crew's shortlist if not already there
    if (!crew.clientShortlists.includes(clientId)) {
      crew.clientShortlists.push(clientId);
      await crew.save();
    }

    res.json({ 
      message: 'Crew assigned to client shortlist successfully',
      crew: {
        id: crew._id,
        name: crew.fullName,
        rank: crew.rank
      },
      client: {
        id: client._id,
        name: client.companyName
      }
    });
  } catch (error) {
    console.error('Assign crew to client error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove crew from specific client shortlist (admin only)
router.delete('/crew/:crewId/remove-client/:clientId', async (req, res) => {
  try {
    const { crewId, clientId } = req.params;

    const crew = await Crew.findById(crewId);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    crew.clientShortlists = crew.clientShortlists.filter(
      id => id.toString() !== clientId
    );
    await crew.save();

    res.json({ message: 'Crew removed from client shortlist successfully' });
  } catch (error) {
    console.error('Remove crew from client error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all reminders
router.get('/reminders', async (req, res) => {
  try {
    const { status, priority, dueDate } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (dueDate) {
      const date = new Date(dueDate);
      query.dueDate = { $lte: date };
    }

    const reminders = await Reminder.find(query)
      .populate('crewId', 'fullName rank')
      .populate('clientId', 'companyName contactPerson')
      .populate('createdBy', 'fullName')
      .populate('assignedTo', 'fullName')
      .sort({ dueDate: 1 });

    res.json(reminders);
  } catch (error) {
    console.error('Get reminders error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new reminder
router.post('/reminders', [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('dueDate').isISO8601().withMessage('Valid due date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      crewId,
      clientId,
      priority = 'medium',
      dueDate,
      tags = [],
      notes
    } = req.body;

    const reminder = new Reminder({
      title,
      description,
      crewId: crewId || null,
      clientId: clientId || null,
      priority,
      dueDate: new Date(dueDate),
      tags,
      notes,
      createdBy: req.user._id
    });

    await reminder.save();
    await reminder.populate('crewId', 'fullName rank');
    await reminder.populate('clientId', 'companyName contactPerson');

    res.status(201).json(reminder);
  } catch (error) {
    console.error('Create reminder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update reminder status
router.patch('/reminders/:id/status', [
  body('status').isIn(['pending', 'completed', 'cancelled']).withMessage('Valid status required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { status } = req.body;

    const reminder = await Reminder.findById(id);
    if (!reminder) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    reminder.status = status;
    if (status === 'completed') {
      reminder.completedAt = new Date();
      reminder.completedBy = req.user._id;
    }

    await reminder.save();
    res.json(reminder);
  } catch (error) {
    console.error('Update reminder status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete reminder
router.delete('/reminders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const reminder = await Reminder.findById(id);
    if (!reminder) {
      return res.status(404).json({ message: 'Reminder not found' });
    }

    await Reminder.findByIdAndDelete(id);
    res.json({ message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error('Delete reminder error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// WhatsApp Integration Routes
router.get('/whatsapp/status', async (req, res) => {
  try {
    res.json({
      isReady: whatsappService.isClientReady(),
      qrCode: whatsappService.getQRCode()
    });
  } catch (error) {
    console.error('Get WhatsApp status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/whatsapp/initialize', async (req, res) => {
  try {
    await whatsappService.initialize();
    res.json({ message: 'WhatsApp service initialized' });
  } catch (error) {
    console.error('Initialize WhatsApp error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/whatsapp/send-test', [
  body('phoneNumber').notEmpty().withMessage('Phone number is required'),
  body('message').notEmpty().withMessage('Message is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phoneNumber, message } = req.body;
    
    if (!whatsappService.isClientReady()) {
      return res.status(400).json({ message: 'WhatsApp client is not ready' });
    }

    await whatsappService.sendMessage(phoneNumber, message);
    res.json({ message: 'Test message sent successfully' });
  } catch (error) {
    console.error('Send test WhatsApp message error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
