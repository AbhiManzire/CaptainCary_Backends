const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const Crew = require('../models/Crew');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, JPG, and PNG files are allowed'));
    }
  }
});

// Crew registration (public endpoint)
router.post('/register', [
  body('fullName').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty().trim(),
  body('rank').notEmpty(),
  body('nationality').notEmpty().trim(),
  body('currentLocation').notEmpty().trim(),
  body('dateOfBirth').isISO8601(),
  body('availabilityDate').isISO8601()
], upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'passport', maxCount: 1 },
  { name: 'cdc', maxCount: 1 },
  { name: 'stcw', maxCount: 1 },
  { name: 'coc', maxCount: 1 },
  { name: 'seamanBook', maxCount: 1 },
  { name: 'visa', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      fullName, email, phone, rank, nationality, currentLocation,
      dateOfBirth, availabilityDate, seaTimeSummary, preferredVesselType,
      additionalNotes
    } = req.body;

    // Check if crew already exists
    const existingCrew = await Crew.findOne({ email });
    if (existingCrew) {
      return res.status(400).json({ message: 'Crew member already registered with this email' });
    }

    // Process uploaded files
    const documents = {};
    if (req.files) {
      Object.keys(req.files).forEach(fieldName => {
        const file = req.files[fieldName][0];
        documents[fieldName] = {
          name: file.originalname,
          url: `/uploads/${file.filename}`
        };
      });
    }

    // Validate required documents
    const requiredDocs = ['cv', 'passport', 'cdc', 'stcw', 'coc', 'seamanBook', 'visa'];
    const missingDocs = requiredDocs.filter(doc => !documents[doc]);
    
    if (missingDocs.length > 0) {
      const docNames = missingDocs.map(doc => {
        switch(doc) {
          case 'cv': return 'CV';
          case 'passport': return 'Passport';
          case 'cdc': return 'CDC';
          case 'stcw': return 'STCW Certificates';
          case 'coc': return 'COC';
          case 'seamanBook': return 'Seaman Book';
          case 'visa': return 'Visa';
          default: return doc;
        }
      });
      return res.status(400).json({ 
        message: `Required documents missing: ${docNames.join(', ')}` 
      });
    }

    const crew = new Crew({
      fullName,
      email,
      phone,
      rank,
      nationality,
      currentLocation,
      dateOfBirth: new Date(dateOfBirth),
      availabilityDate: new Date(availabilityDate),
      seaTimeSummary,
      preferredVesselType,
      additionalNotes,
      documents
    });

    await crew.save();

    res.status(201).json({
      message: 'Crew registration successful',
      crewId: crew._id
    });
  } catch (error) {
    console.error('Crew registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all crew (admin only)
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      rank,
      nationality,
      search,
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    
    if (status) query.status = status;
    if (rank) query.rank = rank;
    if (nationality) query.nationality = nationality;
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
      .select('-documents'); // Exclude documents for list view

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

// Get crew by ID (admin only)
router.get('/:id', auth, adminAuth, async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }
    res.json(crew);
  } catch (error) {
    console.error('Get crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update crew status (admin only)
router.patch('/:id/status', auth, adminAuth, [
  body('status').isIn(['pending', 'approved', 'rejected', 'missing_docs']),
  body('priority').optional().isBoolean(),
  body('tags').optional().isArray(),
  body('internalComments').optional().isString(),
  body('adminNotes').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, priority, tags, internalComments, adminNotes } = req.body;
    
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    const updateData = { status };
    if (priority !== undefined) updateData.priority = priority;
    if (tags) updateData.tags = tags;
    if (internalComments !== undefined) updateData.internalComments = internalComments;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

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

// Get crew statistics (admin only)
router.get('/stats/overview', auth, adminAuth, async (req, res) => {
  try {
    const stats = await Crew.aggregate([
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

    const rankStats = await Crew.aggregate([
      { $group: { _id: '$rank', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const nationalityStats = await Crew.aggregate([
      { $group: { _id: '$nationality', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      overview: stats[0] || { total: 0, pending: 0, approved: 0, rejected: 0, missingDocs: 0, urgent: 0 },
      rankStats,
      nationalityStats
    });
  } catch (error) {
    console.error('Get crew stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
