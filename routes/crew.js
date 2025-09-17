const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const Crew = require('../models/Crew');
const { auth, adminAuth } = require('../middleware/auth');
const { sendNewCrewNotification, sendCrewRegistrationConfirmation } = require('../services/notificationService');
// const { processDocumentWithWatermark } = require('../services/watermarkService');

// Function to generate Word document content
const generateWordDocument = (crew) => {
  // Create a simple RTF (Rich Text Format) document that Word can open
  const rtfContent = `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}
{\\colortbl;\\red0\\green0\\blue0;}
\\f0\\fs24
{\\b\\fs28 CURRICULUM VITAE\\par}
\\par
{\\b Name:} ${crew.fullName}\\par
{\\b Email:} ${crew.email}\\par
{\\b Phone:} ${crew.phone}\\par
{\\b Rank:} ${crew.rank}\\par
{\\b Nationality:} ${crew.nationality}\\par
{\\b Current Location:} ${crew.currentLocation}\\par
{\\b Date of Birth:} ${new Date(crew.dateOfBirth).toLocaleDateString()}\\par
{\\b Availability Date:} ${new Date(crew.availabilityDate).toLocaleDateString()}\\par
\\par
${crew.seaTimeSummary ? `{\\b Experience:}\\par ${crew.seaTimeSummary}\\par\\par` : ''}
${crew.preferredVesselType ? `{\\b Preferred Vessel Type:} ${crew.preferredVesselType}\\par` : ''}
${crew.additionalNotes ? `{\\b Additional Notes:}\\par ${crew.additionalNotes}\\par` : ''}
}`;
  
  return Buffer.from(rtfContent, 'utf8');
};

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
router.post('/register', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'passport', maxCount: 1 },
  { name: 'cdc', maxCount: 1 },
  { name: 'stcw', maxCount: 1 },
  { name: 'coc', maxCount: 1 },
  { name: 'seamanBook', maxCount: 1 },
  { name: 'visa', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]), [
  body('fullName').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty().trim(),
  body('rank').notEmpty(),
  body('nationality').notEmpty().trim(),
  body('currentLocation').notEmpty().trim(),
  body('dateOfBirth').custom((value) => {
    if (!value) return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  }).withMessage('Invalid date format'),
  body('availabilityDate').custom((value) => {
    if (!value) return false;
    const date = new Date(value);
    return !isNaN(date.getTime());
  }).withMessage('Invalid date format')
], async (req, res) => {
  try {
    console.log('Crew registration request received');
    console.log('Body:', req.body);
    console.log('Files:', req.files);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      console.log('Request body fields:', Object.keys(req.body));
      console.log('Request body values:', req.body);
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
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
      console.log('Processing files:', Object.keys(req.files));
      Object.keys(req.files).forEach(fieldName => {
        const file = req.files[fieldName][0];
        console.log(`File ${fieldName}:`, file.originalname);
        documents[fieldName] = {
          name: file.originalname,
          url: `/uploads/${file.filename}`
        };
      });
    } else {
      console.log('No files received');
    }
    
    console.log('Processed documents:', Object.keys(documents));

    // Validate required documents (all except photo are required)
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

    // Send notifications
    try {
      await sendNewCrewNotification(crew);
      await sendCrewRegistrationConfirmation(crew);
    } catch (notificationError) {
      console.error('Notification error:', notificationError);
      // Don't fail the registration if notifications fail
    }

    res.status(201).json({
      message: 'Crew registration successful',
      crewId: crew._id
    });
  } catch (error) {
    console.error('Crew registration error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
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
      submissionDateFrom,
      submissionDateTo,
      vesselExperience,
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {};
    
    if (status) query.status = status;
    if (rank) query.rank = rank;
    if (nationality) query.nationality = { $regex: nationality, $options: 'i' };
    if (vesselExperience) query.preferredVesselType = vesselExperience;
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

// Download CV (admin only) - Word file only
router.get('/:id/cv', auth, adminAuth, async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }
    
    if (!crew.documents.cv) {
      return res.status(404).json({ message: 'CV not found' });
    }
    
    // Generate Word document content from crew data
    const wordContent = generateWordDocument(crew);
    
    // Add watermark to the content
    const watermarkedContent = `Captain Cary - Confidential Document
© Captain Cary - ${new Date().getFullYear()}
Downloaded by: ${req.user.fullName} on ${new Date().toLocaleString()}
========================================

${wordContent.toString()}

========================================
End of Document - Captain Cary
========================================`;
    
    // Set RTF document headers (Word can open RTF files)
    res.setHeader('Content-Type', 'application/rtf');
    res.setHeader('Content-Disposition', `attachment; filename="CV_${crew.fullName.replace(/\s+/g, '_')}_CaptainCary.rtf"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    // Send watermarked Word document content
    res.send(watermarkedContent);
  } catch (error) {   
    console.error('Download CV error:', error);
    res.status(500).json({ message: 'Server error' });
  }   
});

// Download raw CV (admin only)
router.get('/:id/cv/raw', auth, adminAuth, async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }
    
    if (!crew.documents.cv) {
      return res.status(404).json({ message: 'CV not found' });
    }
    
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '..', crew.documents.cv.url);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'CV file not found on server' });
    }
    
    res.download(filePath, crew.documents.cv.name);
  } catch (error) {
    console.error('Download raw CV error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reupload CV (admin only)
router.post('/:id/cv/reupload', auth, adminAuth, upload.single('cv'), async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }
    
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Update the CV document
    crew.documents.cv = {
      name: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      uploadedAt: new Date()
    };
    
    await crew.save();
    
    res.json({ 
      message: 'CV reuploaded successfully',
      document: crew.documents.cv
    });
  } catch (error) {
    console.error('CV reupload error:', error);
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
