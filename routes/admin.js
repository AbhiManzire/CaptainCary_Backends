const express = require('express');
const { body, validationResult } = require('express-validator');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
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

    // Get urgent crew (available within next 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    const urgentCrew = await Crew.find({
      availabilityDate: {
        $gte: new Date(),
        $lte: sevenDaysFromNow
      }
    })
    .sort({ availabilityDate: 1 })
    .select('fullName rank nationality availabilityDate priority status');

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
      pendingRequests,
      urgentCrew
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get crew status counts
router.get('/crew/status-counts', async (req, res) => {
  try {
    const statusCounts = await Crew.aggregate([
      {
        $group: {
          _id: null,
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          missingDocs: { $sum: { $cond: [{ $eq: ['$status', 'missing_docs'] }, 1, 0] } },
          priority: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } }
        }
      }
    ]);

    res.json(statusCounts[0] || { pending: 0, approved: 0, rejected: 0, missingDocs: 0, priority: 0 });
  } catch (error) {
    console.error('Status counts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all crew (admin only)
router.get('/crew', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      rank,
      nationality,
      search,
      submissionDateFrom,
      submissionDateTo,
      vesselExperience,
      visaAvailability,
      priority,
      tags,
      hasVisa,
      assignedClients,
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    
    if (status) query.status = status;
    if (rank) query.rank = rank;
    if (nationality) query.nationality = { $regex: nationality, $options: 'i' };
    if (vesselExperience) query.preferredVesselType = vesselExperience;
    if (priority) {
      if (priority === 'true') query.priority = true;
      else if (priority === 'false') query.priority = false;
      else if (priority === 'urgent') query.priority = true;
    }
    if (tags) {
      if (tags === 'untagged') query.tags = { $exists: false, $size: 0 };
      else query.tags = { $in: [tags] };
    }
    if (assignedClients) {
      if (assignedClients === 'assigned') query.clientShortlists = { $exists: true, $ne: [] };
      else if (assignedClients === 'unassigned') query.clientShortlists = { $exists: true, $size: 0 };
      else if (assignedClients === 'multiple') query.clientShortlists = { $exists: true, $size: { $gt: 1 } };
    }
    if (visaAvailability) {
      if (visaAvailability === 'yes') query['documents.visa'] = { $exists: true };
      else if (visaAvailability === 'no') query['documents.visa'] = { $exists: false };
    }
    if (hasVisa) {
      const now = new Date();
      if (hasVisa === 'immediate') {
        query.availabilityDate = { $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) };
      } else if (hasVisa === 'short') {
        query.availabilityDate = { 
          $lte: new Date(now.getTime() + 4 * 7 * 24 * 60 * 60 * 1000),
          $gte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        };
      } else if (hasVisa === 'medium') {
        query.availabilityDate = { 
          $lte: new Date(now.getTime() + 3 * 30 * 24 * 60 * 60 * 1000),
          $gte: new Date(now.getTime() + 4 * 7 * 24 * 60 * 60 * 1000)
        };
      } else if (hasVisa === 'long') {
        query.availabilityDate = { $gte: new Date(now.getTime() + 3 * 30 * 24 * 60 * 60 * 1000) };
      }
    }
    if (submissionDateFrom || submissionDateTo) {
      query.submittedAt = {};
      if (submissionDateFrom) query.submittedAt.$gte = new Date(submissionDateFrom);
      if (submissionDateTo) query.submittedAt.$lte = new Date(submissionDateTo);
    }
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const crews = await Crew.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-documents') // Exclude documents for list view
      .populate('clientShortlists', 'companyName contactPerson');

    const total = await Crew.countDocuments(query);

    res.json({
      crews,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get crews error:', error);
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


// Remove crew from client shortlist
router.delete('/crew/:crewId/remove-client/:clientId', async (req, res) => {
  try {
    const { crewId, clientId } = req.params;

    const crew = await Crew.findById(crewId);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    // Remove client from crew's shortlist
    crew.clientShortlists = crew.clientShortlists.filter(id => id.toString() !== clientId);
    await crew.save();

    res.json({
      message: 'Crew removed from client shortlist successfully',
      crew: crew
    });
  } catch (error) {
    console.error('Remove crew from client error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get crew assigned to specific client
router.get('/clients/:clientId/crew', async (req, res) => {
  try {
    const { clientId } = req.params;
    const { page = 1, limit = 10, status, rank, search } = req.query;

    const query = { clientShortlists: clientId };
    
    if (status) query.status = status;
    if (rank) query.rank = rank;
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const crews = await Crew.find(query)
      .select('-documents')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ submittedAt: -1 });

    const total = await Crew.countDocuments(query);

    res.json({
      crews,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get client crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk assign crew to client
router.post('/crew/bulk-assign-client', [
  body('crewIds').isArray().notEmpty(),
  body('clientId').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewIds, clientId } = req.body;

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const results = await Promise.all(
      crewIds.map(async (crewId) => {
        try {
          const crew = await Crew.findById(crewId);
          if (!crew) {
            return { crewId, success: false, error: 'Crew not found' };
          }

          if (!crew.clientShortlists.includes(clientId)) {
            crew.clientShortlists.push(clientId);
            await crew.save();
          }

          return { crewId, success: true };
        } catch (error) {
          return { crewId, success: false, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Bulk assignment completed: ${successful} successful, ${failed} failed`,
      results,
      summary: { successful, failed, total: crewIds.length }
    });
  } catch (error) {
    console.error('Bulk assign crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update individual crew status
router.patch('/crew/:id/status', [
  body('status').isIn(['pending', 'approved', 'rejected', 'missing_docs']),
  body('priority').optional().isBoolean(),
  body('tags').optional().isArray(),
  body('internalComments').optional().isString(),
  body('adminNotes').optional().isString(),
  body('approvedForClients').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, priority, tags, internalComments, adminNotes, approvedForClients } = req.body;
    
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    const updateData = { status };
    if (priority !== undefined) updateData.priority = priority;
    if (tags) updateData.tags = tags;
    if (internalComments !== undefined) updateData.internalComments = internalComments;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (approvedForClients !== undefined) updateData.approvedForClients = approvedForClients;

    const updatedCrew = await Crew.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(updatedCrew);
  } catch (error) {
    console.error('Update crew status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk update crew status
router.patch('/crew/bulk-status', [
  body('crewIds').isArray().notEmpty(),
  body('status').isIn(['pending', 'approved', 'rejected', 'missing_docs']),
  body('priority').optional().isBoolean(),
  body('tags').optional().isArray(),
  body('internalComments').optional().isString(),
  body('adminNotes').optional().isString(),
  body('approvedForClients').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewIds, status, priority, tags, internalComments, adminNotes, approvedForClients } = req.body;

    const updateData = { status };
    if (priority !== undefined) updateData.priority = priority;
    if (tags) updateData.tags = tags;
    if (internalComments !== undefined) updateData.internalComments = internalComments;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    if (approvedForClients !== undefined) updateData.approvedForClients = approvedForClients;

    const results = await Promise.all(
      crewIds.map(async (crewId) => {
        try {
          const crew = await Crew.findByIdAndUpdate(crewId, updateData, { new: true });
          if (!crew) {
            return { crewId, success: false, error: 'Crew not found' };
          }
          return { crewId, success: true };
        } catch (error) {
          return { crewId, success: false, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Bulk status update completed: ${successful} successful, ${failed} failed`,
      results,
      summary: { successful, failed, total: crewIds.length }
    });
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk assign tags
router.patch('/crew/bulk-tags', [
  body('crewIds').isArray().notEmpty(),
  body('tags').isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewIds, tags } = req.body;

    const results = await Promise.all(
      crewIds.map(async (crewId) => {
        try {
          const crew = await Crew.findById(crewId);
          if (!crew) {
            return { crewId, success: false, error: 'Crew not found' };
          }

          // Merge new tags with existing ones
          const existingTags = crew.tags || [];
          const newTags = [...new Set([...existingTags, ...tags])];
          crew.tags = newTags;
          await crew.save();

          return { crewId, success: true };
        } catch (error) {
          return { crewId, success: false, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Bulk tag assignment completed: ${successful} successful, ${failed} failed`,
      results,
      summary: { successful, failed, total: crewIds.length }
    });
  } catch (error) {
    console.error('Bulk tag assignment error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk export crew data
router.post('/crew/bulk-export', [
  body('crewIds').isArray().notEmpty(),
  body('format').optional().isIn(['csv', 'excel'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewIds, format = 'csv' } = req.body;

    const crews = await Crew.find({ _id: { $in: crewIds } })
      .select('-documents')
      .populate('clientShortlists', 'companyName contactPerson');

    if (format === 'excel') {
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(crews.map(crew => ({
        'Full Name': crew.fullName,
        'Email': crew.email,
        'Phone': crew.phone,
        'Rank': crew.rank,
        'Nationality': crew.nationality,
        'Current Location': crew.currentLocation,
        'Date of Birth': new Date(crew.dateOfBirth).toLocaleDateString(),
        'Availability Date': new Date(crew.availabilityDate).toLocaleDateString(),
        'Status': crew.status,
        'Priority': crew.priority ? 'Yes' : 'No',
        'Tags': crew.tags ? crew.tags.join(', ') : '',
        'Assigned Clients': crew.clientShortlists ? crew.clientShortlists.map(c => c.companyName).join(', ') : '',
        'Submitted At': new Date(crew.submittedAt).toLocaleDateString()
      })));

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Crew Data');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="crew-data.xlsx"');
      res.send(buffer);
    } else {
      // CSV format
      const csvData = crews.map(crew => ({
        'Full Name': crew.fullName,
        'Email': crew.email,
        'Phone': crew.phone,
        'Rank': crew.rank,
        'Nationality': crew.nationality,
        'Current Location': crew.currentLocation,
        'Date of Birth': new Date(crew.dateOfBirth).toLocaleDateString(),
        'Availability Date': new Date(crew.availabilityDate).toLocaleDateString(),
        'Status': crew.status,
        'Priority': crew.priority ? 'Yes' : 'No',
        'Tags': crew.tags ? crew.tags.join(', ') : '',
        'Assigned Clients': crew.clientShortlists ? crew.clientShortlists.map(c => c.companyName).join(', ') : '',
        'Submitted At': new Date(crew.submittedAt).toLocaleDateString()
      }));

      const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(csvData));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="crew-data.csv"');
      res.send(csv);
    }
  } catch (error) {
    console.error('Bulk export error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get advanced analytics and reporting data
router.get('/analytics/overview', adminAuth, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    console.log('Analytics request for period:', period);
    
    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case '7d':
        dateFilter = { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case '30d':
        dateFilter = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        break;
      case '90d':
        dateFilter = { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
        break;
      case '1y':
        dateFilter = { $gte: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) };
        break;
    }
    
    console.log('Date filter:', dateFilter);

    // Crew statistics
    const crewStats = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          missingDocs: { $sum: { $cond: [{ $eq: ['$status', 'missing_docs'] }, 1, 0] } },
          priority: { $sum: { $cond: ['$priority', 1, 0] } },
          withVisa: { $sum: { $cond: [{ $ne: ['$documents.visa', null] }, 1, 0] } }
        }
      }
    ]);

    // Nationality distribution
    const nationalityStats = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      { $group: { _id: '$nationality', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Rank distribution
    const rankStats = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      { $group: { _id: '$rank', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 }
    ]);

    // Vessel type preferences
    const vesselStats = await Crew.aggregate([
      { 
        $match: { 
          preferredVesselType: { $exists: true, $ne: null },
          submittedAt: dateFilter
        } 
      },
      { $group: { _id: '$preferredVesselType', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Monthly submission trends
    const monthlyTrends = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$submittedAt' },
            month: { $month: '$submittedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // Document completion rates
    const documentStats = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      {
        $project: {
          hasCV: { $cond: [{ $ne: ['$documents.cv', null] }, 1, 0] },
          hasPassport: { $cond: [{ $ne: ['$documents.passport', null] }, 1, 0] },
          hasCDC: { $cond: [{ $ne: ['$documents.cdc', null] }, 1, 0] },
          hasSTCW: { $cond: [{ $ne: ['$documents.stcw', null] }, 1, 0] },
          hasCOC: { $cond: [{ $ne: ['$documents.coc', null] }, 1, 0] },
          hasSeamanBook: { $cond: [{ $ne: ['$documents.seamanBook', null] }, 1, 0] },
          hasVisa: { $cond: [{ $ne: ['$documents.visa', null] }, 1, 0] },
          hasPhoto: { $cond: [{ $ne: ['$documents.photo', null] }, 1, 0] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          cvComplete: { $sum: '$hasCV' },
          passportComplete: { $sum: '$hasPassport' },
          cdcComplete: { $sum: '$hasCDC' },
          stcwComplete: { $sum: '$hasSTCW' },
          cocComplete: { $sum: '$hasCOC' },
          seamanBookComplete: { $sum: '$hasSeamanBook' },
          visaComplete: { $sum: '$hasVisa' },
          photoComplete: { $sum: '$hasPhoto' }
        }
      }
    ]);

    // Client assignment statistics
    const clientStats = await Crew.aggregate([
      {
        $match: {
          submittedAt: dateFilter
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          assigned: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$clientShortlists', []] } }, 0] }, 1, 0] } },
          unassigned: { $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ['$clientShortlists', []] } }, 0] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      crewStats: crewStats[0] || { total: 0, pending: 0, approved: 0, rejected: 0, missingDocs: 0, priority: 0, withVisa: 0 },
      nationalityStats,
      rankStats,
      vesselStats,
      monthlyTrends,
      documentStats: documentStats[0] || {},
      clientStats: clientStats[0] || { total: 0, assigned: 0, unassigned: 0 }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get screening analytics
router.get('/screening-analytics', adminAuth, async (req, res) => {
  try {
    // Status distribution
    const statusDistribution = await Crew.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    // Country distribution
    const countryDistribution = await Crew.aggregate([
      { $group: { _id: '$nationality', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    // Recent submissions
    const recentSubmissions = await Crew.find()
      .sort({ submittedAt: -1 })
      .limit(10)
      .select('fullName rank nationality status submittedAt');

    // Monthly trends
    const monthlyTrends = await Crew.aggregate([
      {
        $group: {
          _id: {
            year: { $year: '$submittedAt' },
            month: { $month: '$submittedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 }
    ]);

    res.json({
      statusDistribution: statusDistribution.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      countryDistribution,
      recentSubmissions,
      monthlyTrends
    });
  } catch (error) {
    console.error('Screening analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin users
router.get('/admins', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role } = req.query;
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) {
      query.role = role;
    }

    const admins = await Admin.find(query)
      .select('-password')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 })
      .lean(); // Use lean() for better performance

    const total = await Admin.countDocuments(query);

    res.json({
      admins,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new admin user
router.post('/admins', [
  body('name').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('role').isIn(['super_admin', 'admin', 'moderator'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, role } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists with this email' });
    }

    // Create admin with correct field mapping
    const admin = new Admin({
      username: email, // Use email as username
      fullName: name,  // Map name to fullName
      email,
      password, // Let the pre-save hook handle hashing
      role
    });

    await admin.save();

    res.status(201).json({
      message: 'Admin created successfully',
      admin: {
        id: admin._id,
        name: admin.fullName,
        email: admin.email,
        role: admin.role,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update admin user
router.patch('/admins/:id', [
  body('name').optional().notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('role').optional().isIn(['super_admin', 'admin', 'moderator']),
  body('isActive').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, role, isActive } = req.body;
    const updateData = {};

    if (name) updateData.fullName = name;
    if (email) {
      updateData.email = email;
      updateData.username = email; // Update username when email changes
    }
    if (role) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.json({
      message: 'Admin updated successfully',
      admin
    });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Change admin password
router.patch('/admins/:id/password', [
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const admin = await Admin.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword },
      { new: true }
    ).select('-password');

    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.json({
      message: 'Password updated successfully',
      admin
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete admin user
router.delete('/admins/:id', async (req, res) => {
  try {
    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    res.json({ message: 'Admin deleted successfully' });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get system logs
router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, level, startDate, endDate } = req.query;
    const query = {};
    
    if (level) query.level = level;
    if (startDate && endDate) {
      query.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // This would typically come from a logging system
    // For now, we'll return a mock response
    const logs = [
      {
        id: '1',
        level: 'info',
        message: 'Crew member John Doe submitted application',
        timestamp: new Date(),
        userId: 'crew123',
        action: 'crew_submission'
      },
      {
        id: '2',
        level: 'warning',
        message: 'Document upload failed for crew member Jane Smith',
        timestamp: new Date(),
        userId: 'crew456',
        action: 'document_upload'
      },
      {
        id: '3',
        level: 'error',
        message: 'Email notification failed to send',
        timestamp: new Date(),
        userId: 'admin789',
        action: 'notification'
      }
    ];

    res.json({
      logs,
      totalPages: 1,
      currentPage: page,
      total: logs.length
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get system statistics
router.get('/system-stats', async (req, res) => {
  try {
    const crewCount = await Crew.countDocuments();
    const clientCount = await Client.countDocuments();
    const adminCount = await Admin.countDocuments();
    
    const recentCrew = await Crew.countDocuments({
      submittedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    const recentClients = await Client.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    res.json({
      crewCount,
      clientCount,
      adminCount,
      recentCrew,
      recentClients,
      systemHealth: 'healthy',
      lastBackup: new Date(),
      storageUsed: '2.5 GB',
      uptime: '99.9%'
    });
  } catch (error) {
    console.error('Get system stats error:', error);
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

    console.log('Admin requests response:', {
      total,
      totalPages: Math.ceil(total / limit),
      requestsCount: requests.length,
      firstRequest: requests[0] ? {
        id: requests[0]._id,
        client: requests[0].client,
        crew: requests[0].crew,
        requestType: requests[0].requestType
      } : null
    });

    res.json({
      requests,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
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
      createdBy: req.user ? req.user._id : null
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

// Get admin settings
router.get('/settings', async (req, res) => {
  try {
    // Return default settings structure
    const defaultSettings = {
      profile: {
        name: req.user.fullName || '',
        email: req.user.email || '',
        phone: req.user.phone || '',
        role: req.user.role || 'admin'
      },
      notifications: {
        emailNotifications: true,
        smsNotifications: false,
        pushNotifications: true,
        reminderNotifications: true
      },
      system: {
        autoBackup: true,
        dataRetention: '1year',
        sessionTimeout: '30min',
        maintenanceMode: false
      },
      security: {
        twoFactorAuth: false,
        passwordExpiry: '90days',
        loginAttempts: 5,
        ipWhitelist: []
      }
    };

    res.json(defaultSettings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update admin settings
router.put('/settings', async (req, res) => {
  try {
    const { profile, notifications, system, security } = req.body;

    // Update admin profile if provided
    if (profile) {
      const updateData = {};
      if (profile.name) updateData.fullName = profile.name;
      if (profile.email) updateData.email = profile.email;
      if (profile.phone) updateData.phone = profile.phone;
      if (profile.role) updateData.role = profile.role;

      if (Object.keys(updateData).length > 0) {
        await Admin.findByIdAndUpdate(req.user._id, updateData);
      }
    }

    // For now, just return success - in a real app, you'd save these to a settings collection
    res.json({ 
      message: 'Settings updated successfully',
      settings: { profile, notifications, system, security }
    });
  } catch (error) {
    console.error('Update settings error:', error);
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

// Get reports data
router.get('/reports', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    console.log('Reports request params:', { startDate, endDate });
    
    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    
    console.log('Date filter:', dateFilter);
    
    // Get crew statistics
    const crewMatchFilter = Object.keys(dateFilter).length > 0 ? { submittedAt: dateFilter } : {};
    console.log('Crew match filter:', crewMatchFilter);
    
    const crewStats = await Crew.aggregate([
      { $match: crewMatchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const crewStatsObj = crewStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});
    
    // Get client statistics
    const clientMatchFilter = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};
    console.log('Client match filter:', clientMatchFilter);
    
    const clientStats = await Client.aggregate([
      { $match: clientMatchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const clientStatsObj = clientStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});
    
    // Get request statistics
    const requestMatchFilter = Object.keys(dateFilter).length > 0 ? { requestedAt: dateFilter } : {};
    console.log('Request match filter:', requestMatchFilter);
    
    const requestStats = await ClientRequest.aggregate([
      { $match: requestMatchFilter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const requestStatsObj = requestStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});
    
    // Get total counts
    const totalCrew = await Crew.countDocuments();
    const totalClients = await Client.countDocuments();
    const totalRequests = await ClientRequest.countDocuments();
    
    console.log('Aggregation results:', {
      crewStats,
      clientStats,
      requestStats,
      totalCrew,
      totalClients,
      totalRequests
    });
    
    // Get additional client stats
    const activeClients = await Client.countDocuments({ isActive: true });
    const inactiveClients = await Client.countDocuments({ isActive: false });
    
    // Get crew priority count
    const priorityCrew = await Crew.countDocuments({ priority: true });
    
    const responseData = {
      crewStats: {
        total: totalCrew,
        approved: crewStatsObj.approved || 0,
        pending: crewStatsObj.pending || 0,
        rejected: crewStatsObj.rejected || 0,
        missingDocs: crewStatsObj.missing_docs || 0,
        priority: priorityCrew
      },
      clientStats: {
        total: totalClients,
        active: activeClients,
        inactive: inactiveClients,
        newThisMonth: 0, // TODO: Calculate based on date
        totalRequests: totalRequests
      },
      requestStats: {
        total: totalRequests,
        pending: requestStatsObj.pending || 0,
        approved: requestStatsObj.approved || 0,
        rejected: requestStatsObj.rejected || 0,
        completed: requestStatsObj.completed || 0
      },
      monthlyData: []
    };
    
    console.log('Final response data:', responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Get reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Export reports
router.get('/reports/export', async (req, res) => {
  try {
    const { type, startDate, endDate } = req.query;
    
    // Build date filter
    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);
    
    let data = [];
    let filename = '';
    let worksheetName = '';
    
    switch (type) {
      case 'crew':
        data = await Crew.find(Object.keys(dateFilter).length > 0 ? { submittedAt: dateFilter } : {})
          .select('fullName email phone rank nationality status submittedAt')
          .lean();
        filename = 'crew-report';
        worksheetName = 'Crew Members';
        break;
        
      case 'clients':
        const clientFilter = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};
        data = await Client.find(clientFilter)
          .select('companyName contactPerson email phone isActive createdAt')
          .lean();
        filename = 'clients-report';
        worksheetName = 'Clients';
        break;
        
      case 'requests':
        const requestFilter = Object.keys(dateFilter).length > 0 ? { requestedAt: dateFilter } : {};
        data = await ClientRequest.find(requestFilter)
          .populate('client', 'companyName contactPerson')
          .populate('crew', 'fullName rank')
          .select('requestType status message requestedAt respondedAt')
          .lean();
        filename = 'requests-report';
        worksheetName = 'Requests';
        break;
        
      default:
        // Overview report with all data
        const crewData = await Crew.find().select('fullName rank nationality status submittedAt').lean();
        const clientData = await Client.find().select('companyName contactPerson isActive createdAt').lean();
        const requestData = await ClientRequest.find()
          .populate('client', 'companyName')
          .populate('crew', 'fullName rank')
          .select('requestType status requestedAt')
          .lean();
        
        data = {
          'Crew Members': crewData,
          'Clients': clientData,
          'Requests': requestData
        };
        filename = 'overview-report';
    }
    
    // Create Excel workbook
    const workbook = XLSX.utils.book_new();
    
    if (type === 'overview') {
      // Multiple sheets for overview
      Object.keys(data).forEach(sheetName => {
        const worksheet = XLSX.utils.json_to_sheet(data[sheetName]);
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      });
    } else {
      // Single sheet for specific reports
      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
    }
    
    // Generate Excel buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Set headers for Excel download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}-${new Date().toISOString().split('T')[0]}.xlsx"`);
    res.send(excelBuffer);
    
  } catch (error) {
    console.error('Export reports error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get screening analytics
router.get('/screening-analytics', adminAuth, async (req, res) => {
  try {
    console.log('Fetching screening analytics...');
    
    // Get recent screening submissions (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentSubmissions = await Crew.find({
      createdAt: { $gte: thirtyDaysAgo }
    })
    .select('fullName nationality rank status createdAt')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
    
    // Get status distribution
    const statusDistribution = await Crew.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // Convert to object format
    const statusDist = {};
    statusDistribution.forEach(item => {
      statusDist[item._id] = item.count;
    });
    
    // Get country distribution
    const countryDistribution = await Crew.aggregate([
      {
        $group: {
          _id: '$nationality',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);
    
    // Convert to object format
    const countryDist = {};
    countryDistribution.forEach(item => {
      countryDist[item._id] = item.count;
    });
    
    // Get monthly trends (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyTrends = await Crew.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1 }
      }
    ]);
    
    // Format recent submissions for frontend
    const formattedSubmissions = recentSubmissions.map(crew => ({
      crewName: crew.fullName,
      nationality: crew.nationality,
      rank: crew.rank,
      status: crew.status,
      submittedAt: crew.createdAt
    }));
    
    const analytics = {
      recentSubmissions: formattedSubmissions,
      statusDistribution: statusDist,
      countryDistribution: countryDist,
      monthlyTrends: monthlyTrends
    };
    
    console.log('Screening analytics data:', analytics);
    res.json(analytics);
    
  } catch (error) {
    console.error('Screening analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
