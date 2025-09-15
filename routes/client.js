const express = require('express');
const { body, validationResult } = require('express-validator');
const Crew = require('../models/Crew');
const ClientRequest = require('../models/ClientRequest');
const { auth, clientAuth } = require('../middleware/auth');

const router = express.Router();

// All routes require client authentication
router.use(auth, clientAuth);

// Get approved crew members
router.get('/crew', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      rank,
      nationality,
      availabilityDate,
      vesselType,
      search,
      sortBy = 'submittedAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { 
      status: 'approved',
      approvedForClients: true
    };
    
    if (rank) query.rank = rank;
    if (nationality) query.nationality = nationality;
    if (vesselType) query.preferredVesselType = vesselType;
    if (availabilityDate) {
      query.availabilityDate = { $lte: new Date(availabilityDate) };
    }
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { rank: { $regex: search, $options: 'i' } },
        { nationality: { $regex: search, $options: 'i' } }
      ];
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const crews = await Crew.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-documents -internalComments -adminNotes -priority -tags');

    const total = await Crew.countDocuments(query);

    res.json({
      crews,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get approved crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get crew member details
router.get('/crew/:id', async (req, res) => {
  try {
    const crew = await Crew.findOne({
      _id: req.params.id,
      status: 'approved',
      approvedForClients: true
    }).select('-internalComments -adminNotes -priority -tags');

    if (!crew) {
      return res.status(404).json({ message: 'Crew member not found or not approved' });
    }

    res.json(crew);
  } catch (error) {
    console.error('Get crew details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get crew member's CV (watermarked)
router.get('/crew/:id/cv', async (req, res) => {
  try {
    const crew = await Crew.findOne({
      _id: req.params.id,
      status: 'approved',
      approvedForClients: true
    });

    if (!crew || !crew.documents.cv) {
      return res.status(404).json({ message: 'CV not found' });
    }

    // In a real implementation, you would add watermarking here
    // For now, we'll just serve the file
    res.download(`.${crew.documents.cv.url}`);
  } catch (error) {
    console.error('Get crew CV error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get crew member's documents (view only)
router.get('/crew/:id/documents', async (req, res) => {
  try {
    const crew = await Crew.findOne({
      _id: req.params.id,
      status: 'approved',
      approvedForClients: true
    });

    if (!crew) {
      return res.status(404).json({ message: 'Crew member not found' });
    }

    // Return document info without actual file URLs for security
    const documentInfo = {};
    Object.keys(crew.documents).forEach(docType => {
      if (crew.documents[docType]) {
        documentInfo[docType] = {
          name: crew.documents[docType].name,
          uploadedAt: crew.documents[docType].uploadedAt,
          available: true
        };
      }
    });

    res.json(documentInfo);
  } catch (error) {
    console.error('Get crew documents error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Shortlist crew member
router.post('/crew/:id/shortlist', async (req, res) => {
  try {
    const crew = await Crew.findOne({
      _id: req.params.id,
      status: 'approved',
      approvedForClients: true
    });

    if (!crew) {
      return res.status(404).json({ message: 'Crew member not found' });
    }

    // Add to client's shortlist if not already there
    if (!crew.clientShortlists.includes(req.user._id)) {
      crew.clientShortlists.push(req.user._id);
      await crew.save();
    }

    res.json({ message: 'Crew member added to shortlist' });
  } catch (error) {
    console.error('Shortlist crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove from shortlist
router.delete('/crew/:id/shortlist', async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) {
      return res.status(404).json({ message: 'Crew member not found' });
    }

    crew.clientShortlists = crew.clientShortlists.filter(
      clientId => !clientId.equals(req.user._id)
    );
    await crew.save();

    res.json({ message: 'Crew member removed from shortlist' });
  } catch (error) {
    console.error('Remove from shortlist error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get shortlisted crew
router.get('/shortlist', async (req, res) => {
  try {
    const crews = await Crew.find({
      clientShortlists: req.user._id,
      status: 'approved'
    }).select('-documents -internalComments -adminNotes -priority -tags');

    res.json(crews);
  } catch (error) {
    console.error('Get shortlist error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit request for crew member
router.post('/requests', [
  body('crewId').isMongoId(),
  body('requestType').isIn(['interview', 'booking', 'hold_candidate']),
  body('message').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewId, requestType, message } = req.body;

    // Verify crew exists and is approved
    const crew = await Crew.findOne({
      _id: crewId,
      status: 'approved',
      approvedForClients: true
    });

    if (!crew) {
      return res.status(404).json({ message: 'Crew member not found or not approved' });
    }

    // Check if request already exists
    const existingRequest = await ClientRequest.findOne({
      client: req.user._id,
      crew: crewId,
      status: 'pending'
    });

    if (existingRequest) {
      return res.status(400).json({ message: 'Request already pending for this crew member' });
    }

    const request = new ClientRequest({
      client: req.user._id,
      crew: crewId,
      requestType,
      message
    });

    await request.save();

    res.status(201).json({
      message: 'Request submitted successfully',
      requestId: request._id
    });
  } catch (error) {
    console.error('Submit request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get client's requests
router.get('/requests', async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { client: req.user._id };
    if (status) query.status = status;

    const requests = await ClientRequest.find(query)
      .populate('crew', 'fullName rank nationality')
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
    console.error('Get client requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available ranks and nationalities for filters
router.get('/filters', async (req, res) => {
  try {
    const ranks = await Crew.distinct('rank', { 
      status: 'approved', 
      approvedForClients: true 
    });
    
    const nationalities = await Crew.distinct('nationality', { 
      status: 'approved', 
      approvedForClients: true 
    });
    
    const vesselTypes = await Crew.distinct('preferredVesselType', { 
      status: 'approved', 
      approvedForClients: true 
    }).filter(type => type); // Remove null values

    res.json({
      ranks: ranks.sort(),
      nationalities: nationalities.sort(),
      vesselTypes: vesselTypes.sort()
    });
  } catch (error) {
    console.error('Get filters error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
