const express = require('express');
const { body, validationResult } = require('express-validator');
const Crew = require('../models/Crew');
const ClientRequest = require('../models/ClientRequest');
const { auth, clientAuth } = require('../middleware/auth');
const { sendClientRequestNotification } = require('../services/notificationService');

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

// All routes require client authentication
router.use(auth, clientAuth);

// Get approved crew for client view
router.get('/crew', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      search,
      rank,
      nationality,
      vesselType,
      availabilityDate
    } = req.query;

    const query = { 
      status: 'approved',
      approvedForClients: true 
    };
    
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { rank: { $regex: search, $options: 'i' } },
        { nationality: { $regex: search, $options: 'i' } }
      ];
    }
    if (rank) query.rank = rank;
    if (nationality) query.nationality = { $regex: nationality, $options: 'i' };
    if (vesselType) query.preferredVesselType = vesselType;
    if (availabilityDate) {
      query.availabilityDate = { $lte: new Date(availabilityDate) };
    }

    const crews = await Crew.find(query)
      .select('-documents -internalComments -adminNotes -tags -priority -email -phone -address')
      .sort({ submittedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Crew.countDocuments(query);

    // Log client access for audit
    console.log(`[AUDIT] Client ${req.user._id} accessed crew list - ${crews.length} records viewed`);

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

// Get crew details for client view (with privacy protection)
router.get('/crew/:id', async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id)
      .select('-internalComments -adminNotes -email -phone -address -tags -priority');
    
    if (!crew || crew.status !== 'approved' || !crew.approvedForClients) {
      return res.status(404).json({ message: 'Crew not found or not available' });
    }
    
    // Remove CV from documents for client view (privacy protection)
    if (crew.documents && crew.documents.cv) {
      crew.documents.cv = null;
    }
    
    // Log client access for audit
    console.log(`[AUDIT] Client ${req.user._id} viewed crew details for ${crew.fullName} (ID: ${crew._id})`);
    
    res.json(crew);
  } catch (error) {
    console.error('Get crew details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Download CV (DISABLED for clients - Data Privacy Requirement)
router.get('/crew/:id/cv', async (req, res) => {
  try {
    // Log the attempt for audit
    console.log(`[AUDIT] Client ${req.user._id} attempted to download CV for crew ${req.params.id} - BLOCKED`);
    
    // Return error - clients cannot download raw CVs
    res.status(403).json({ 
      message: 'Access denied. CV downloads are not available for clients. Please contact admin for CV access.' 
    });
  } catch (error) {
    console.error('Download CV error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// View certificate (view-only for clients)
router.get('/crew/:id/certificate/:docType', async (req, res) => {
  try {
    const { id, docType } = req.params;
    
    // Only allow certain document types for client view
    const allowedDocs = ['passport', 'cdc', 'stcw', 'coc', 'seamanBook', 'visa'];
    if (!allowedDocs.includes(docType)) {
      return res.status(403).json({ message: 'Access denied for this document type' });
    }
    
    const crew = await Crew.findById(id);
    if (!crew || crew.status !== 'approved' || !crew.approvedForClients) {
      return res.status(404).json({ message: 'Crew not found or not available' });
    }
    
    if (!crew.documents[docType]) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    // Log client access for audit
    console.log(`[AUDIT] Client ${req.user._id} viewed ${docType} for crew ${crew.fullName} (ID: ${crew._id})`);
    
    // Return document info (view-only, no download)
    res.json({
      documentType: docType,
      fileName: crew.documents[docType].name,
      uploadedAt: crew.documents[docType].uploadedAt,
      message: 'Document available for viewing only. Contact admin for download access.'
    });
  } catch (error) {
    console.error('View certificate error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Shortlist crew member
router.post('/shortlist', [
  body('crewId').isMongoId()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewId } = req.body;
    
    const crew = await Crew.findById(crewId);
    if (!crew || crew.status !== 'approved') {
      return res.status(404).json({ message: 'Crew not found or not approved' });
    }

    // Add client to shortlist if not already there
    if (!crew.clientShortlists.includes(req.user._id)) {
      crew.clientShortlists.push(req.user._id);
      await crew.save();
      
      // Log shortlist action for audit
      console.log(`[AUDIT] Client ${req.user._id} shortlisted crew member ${crew.fullName} (ID: ${crew._id})`);
    }

    res.json({ message: 'Crew shortlisted successfully' });
  } catch (error) {
    console.error('Shortlist crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Remove from shortlist
router.delete('/shortlist/:crewId', async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.crewId);
    if (!crew) {
      return res.status(404).json({ message: 'Crew not found' });
    }

    crew.clientShortlists = crew.clientShortlists.filter(
      clientId => clientId.toString() !== req.user._id.toString()
    );
    await crew.save();

    res.json({ message: 'Crew removed from shortlist' });
  } catch (error) {
    console.error('Remove from shortlist error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get shortlisted crew
router.get('/shortlisted', async (req, res) => {
  try {
    const crews = await Crew.find({
      clientShortlists: req.user._id,
      status: 'approved'
    }).select('-documents -internalComments -adminNotes -tags -priority');

    res.json(crews);
  } catch (error) {
    console.error('Get shortlisted crew error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Submit request for crew member
router.post('/requests', [
  body('crewId').isMongoId(),
  body('requestType').notEmpty(),
  body('message').optional().isString(),
  body('urgency').optional().isIn(['normal', 'urgent', 'asap'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { crewId, requestType, message, urgency = 'normal' } = req.body;
    
    const crew = await Crew.findById(crewId);
    if (!crew || crew.status !== 'approved') {
      return res.status(404).json({ message: 'Crew not found or not approved' });
    }

    const request = new ClientRequest({
      client: req.user._id,
      crew: crewId,
      requestType,
      message,
      urgency,
      status: 'pending'
    });

    await request.save();

    // Send notification to admin
    try {
      await sendClientRequestNotification({
        requestType,
        message,
        urgency,
        client: req.user,
        crew: {
          fullName: crew.fullName,
          rank: crew.rank
        }
      });
    } catch (notificationError) {
      console.error('Notification error:', notificationError);
      // Don't fail the request if notifications fail
    }

    // Log request submission for audit
    console.log(`[AUDIT] Client ${req.user._id} submitted ${requestType} request for crew ${crew.fullName} (ID: ${crew._id}) - Request ID: ${request._id}`);

    res.status(201).json({
      message: 'Request submitted successfully',
      requestId: request._id
    });
  } catch (error) {
    console.error('Submit request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get client's request history
router.get('/requests', async (req, res) => {
  try {
    const requests = await ClientRequest.find({ client: req.user._id })
      .populate('crew', 'fullName rank nationality')
      .sort({ requestedAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error('Get request history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get client dashboard data
router.get('/dashboard', async (req, res) => {
  try {
    console.log('Client dashboard request for user:', req.user._id);
    
    const availableCrewCount = await Crew.countDocuments({
      status: 'approved',
      approvedForClients: true
    });

    const shortlistedCount = await Crew.countDocuments({
      clientShortlists: req.user._id,
      status: 'approved'
    });

    const requestsCount = await ClientRequest.countDocuments({
      client: req.user._id
    });

    const approvedRequestsCount = await ClientRequest.countDocuments({
      client: req.user._id,
      status: 'approved'
    });

    const recentRequests = await ClientRequest.find({ client: req.user._id })
      .populate('crew', 'fullName rank')
      .sort({ requestedAt: -1 })
      .limit(5);

    const response = {
      availableCrewCount,
      shortlistedCount,
      requestsCount,
      approvedRequestsCount,
      recentRequests
    };

    console.log('Dashboard response:', response);
    res.json(response);
  } catch (error) {
    console.error('Get client dashboard error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;