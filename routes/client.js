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

// Handle OPTIONS requests for CORS
router.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control, Accept');
  res.sendStatus(200);
});

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
      approvedForClients: true,
      clientShortlists: req.user._id
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
    console.log(`[DEBUG] Client ${req.user._id} requesting crew details for ID: ${req.params.id}`);
    
    const crew = await Crew.findById(req.params.id)
      .select('-internalComments -adminNotes -email -phone -address -tags -priority');
    
    console.log(`[DEBUG] Crew found:`, crew ? 'Yes' : 'No');
    console.log(`[DEBUG] Crew status:`, crew?.status);
    console.log(`[DEBUG] Approved for clients:`, crew?.approvedForClients);
    console.log(`[DEBUG] Documents available:`, crew?.documents ? Object.keys(crew.documents) : 'None');
    
    if (!crew || crew.status !== 'approved' || !crew.approvedForClients) {
      console.log(`[DEBUG] Crew not available - Status: ${crew?.status}, Approved: ${crew?.approvedForClients}`);
      return res.status(404).json({ message: 'Crew not found or not available' });
    }

    // Check if crew is assigned to this client
    if (!crew.clientShortlists.includes(req.user._id)) {
      console.log(`[DEBUG] Crew not assigned to client - Client ID: ${req.user._id}`);
      return res.status(403).json({ message: 'This crew member is not assigned to your company' });
    }
    
    // Keep CV for client view but mark as restricted
    if (crew.documents && crew.documents.cv) {
      crew.documents.cv = {
        ...crew.documents.cv,
        restricted: true,
        message: 'CV Restricted - Contact Admin for full access'
      };
    }
    
    // Log client access for audit
    console.log(`[AUDIT] Client ${req.user._id} viewed crew details for ${crew.fullName} (ID: ${crew._id})`);
    
    res.json(crew);
  } catch (error) {
    console.error('Get crew details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Download CV with watermark (for clients)
router.get('/crew/:id/cv', async (req, res) => {
  try {
    // Handle token-based authentication for iframe access
    if (req.query.token) {
      const jwt = require('jsonwebtoken');
      try {
        const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = { _id: decoded.id }; // Changed from decoded.userId to decoded.id
      } catch (tokenError) {
        console.log('Token verification failed:', tokenError);
        return res.status(401).json({ message: 'Invalid token' });
      }
    }
    
    console.log(`[DEBUG] Client ${req.user._id} requesting CV for crew ID: ${req.params.id}`);
    
    const crew = await Crew.findById(req.params.id);
    
    console.log(`[DEBUG] Crew found:`, crew ? 'Yes' : 'No');
    console.log(`[DEBUG] Crew status:`, crew?.status);
    console.log(`[DEBUG] Approved for clients:`, crew?.approvedForClients);
    console.log(`[DEBUG] CV document exists:`, crew?.documents?.cv ? 'Yes' : 'No');
    console.log(`[DEBUG] CV buffer size:`, crew?.documents?.cv?.buffer?.length || 'No buffer');
    
    if (!crew || crew.status !== 'approved' || !crew.approvedForClients) {
      console.log(`[DEBUG] Crew not available for CV access - Status: ${crew?.status}, Approved: ${crew?.approvedForClients}`);
      return res.status(404).json({ message: 'Crew not found or not available' });
    }
    
    if (!crew.documents || !crew.documents.cv) {
      console.log(`[DEBUG] CV document not available`);
      return res.status(404).json({ message: 'CV not available' });
    }
    
    // Log the access for audit
    console.log(`[AUDIT] Client ${req.user._id} accessed CV for crew ${crew.fullName} (ID: ${crew._id})`);
    
    // Read the file from the filesystem
    const fs = require('fs');
    const path = require('path');
    
    // Fix file path construction - remove leading slash if present
    let filePath = crew.documents.cv.url;
    if (filePath.startsWith('/')) {
      filePath = filePath.substring(1);
    }
    filePath = path.join(__dirname, '..', filePath);
    
    console.log(`[DEBUG] CV URL: ${crew.documents.cv.url}`);
    console.log(`[DEBUG] __dirname: ${__dirname}`);
    console.log(`[DEBUG] Constructed file path: ${filePath}`);
    console.log(`[DEBUG] File exists: ${fs.existsSync(filePath)}`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`[DEBUG] CV file not found at path: ${filePath}`);
      // Try alternative path construction
      const altPath = path.join(__dirname, '..', 'uploads', path.basename(crew.documents.cv.url));
      console.log(`[DEBUG] Trying alternative path: ${altPath}`);
      if (fs.existsSync(altPath)) {
        filePath = altPath;
        console.log(`[DEBUG] Found file at alternative path`);
      } else {
        return res.status(404).json({ message: 'CV file not found on server' });
      }
    }
    
    // Set proper headers for document viewing with CORS - VIEW ONLY
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="CV.pdf"'); // inline prevents download
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Prevent embedding in other sites
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); // Additional security
    
    // Serve the file directly
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error serving file' });
        }
      }
    });
  } catch (error) {
    console.error('CV download error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// View certificate (view-only for clients)
router.get('/crew/:id/certificate/:docType', async (req, res) => {
  try {
    // Handle token-based authentication for iframe access
    if (req.query.token) {
      const jwt = require('jsonwebtoken');
      try {
        const decoded = jwt.verify(req.query.token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = { _id: decoded.id }; // Changed from decoded.userId to decoded.id
      } catch (tokenError) {
        console.log('Token verification failed:', tokenError);
        return res.status(401).json({ message: 'Invalid token' });
      }
    }
    
    const { id, docType } = req.params;
    
    // Only allow certain document types for client view
    const allowedDocs = ['passport', 'cdc', 'stcw', 'coc', 'seamanBook', 'visa', 'photo'];
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
    
    // Return document for viewing (with watermark notice)
    const document = crew.documents[docType];
    
    // Read the file from the filesystem
    const fs = require('fs');
    const path = require('path');
    
    // Fix file path construction - remove leading slash if present
    let filePath = document.url;
    if (filePath.startsWith('/')) {
      filePath = filePath.substring(1);
    }
    filePath = path.join(__dirname, '..', filePath);
    
    console.log(`[DEBUG] ${docType} URL: ${document.url}`);
    console.log(`[DEBUG] __dirname: ${__dirname}`);
    console.log(`[DEBUG] Constructed file path: ${filePath}`);
    console.log(`[DEBUG] File exists: ${fs.existsSync(filePath)}`);
    
    if (!fs.existsSync(filePath)) {
      console.log(`[DEBUG] ${docType} file not found at path: ${filePath}`);
      // Try alternative path construction
      const altPath = path.join(__dirname, '..', 'uploads', path.basename(document.url));
      console.log(`[DEBUG] Trying alternative path: ${altPath}`);
      if (fs.existsSync(altPath)) {
        filePath = altPath;
        console.log(`[DEBUG] Found file at alternative path`);
      } else {
        return res.status(404).json({ message: `${docType} file not found on server` });
      }
    }
    
    // Set proper headers for document viewing with CORS - VIEW ONLY
    let mimeType = 'application/pdf';
    let fileExtension = 'pdf';
    
    if (docType === 'photo') {
      mimeType = 'image/jpeg';
      fileExtension = 'jpg';
    } else if (docType === 'passport') {
      mimeType = 'image/jpeg'; // Changed from image/png to image/jpeg
      fileExtension = 'jpg';
    }
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${docType}.${fileExtension}"`); // inline prevents download
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // Prevent embedding in other sites
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'"); // Additional security
    
    // Serve the file directly
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error serving file' });
        }
      }
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
    if (!crew || crew.status !== 'approved' || !crew.approvedForClients) {
      return res.status(404).json({ message: 'Crew not found or not available for clients' });
    }

    // Check if crew is assigned to this client
    if (!crew.clientShortlists.includes(req.user._id)) {
      return res.status(403).json({ message: 'This crew member is not assigned to your company' });
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
    const {
      page = 1,
      limit = 10,
      status,
      requestType,
      urgency
    } = req.query;

    // Build filter object
    const filter = { client: req.user._id };
    if (status) filter.status = status;
    if (requestType) filter.requestType = requestType;
    if (urgency) filter.urgency = urgency;

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get total count
    const total = await ClientRequest.countDocuments(filter);
    
    // Get requests with pagination
    const requests = await ClientRequest.find(filter)
      .populate('crew', 'fullName rank nationality')
      .populate('client', 'companyName contactPerson email')
      .sort({ requestedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalPages = Math.ceil(total / parseInt(limit));

    console.log('Client requests response:', {
      total,
      totalPages,
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
      total,
      totalPages,
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Get request history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get individual request details
router.get('/requests/:id', async (req, res) => {
  try {
    const request = await ClientRequest.findById(req.params.id)
      .populate('crew', 'fullName rank nationality email phone')
      .populate('client', 'companyName contactPerson email phone');
    
    if (!request || request.client._id.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get request details error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add follow-up message to request
router.patch('/requests/:id/follow-up', [
  body('clientMessage').notEmpty().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { clientMessage } = req.body;
    
    const request = await ClientRequest.findById(req.params.id);
    if (!request || request.client.toString() !== req.user._id.toString()) {
      return res.status(404).json({ message: 'Request not found' });
    }

    // Add follow-up message
    if (!request.followUps) {
      request.followUps = [];
    }
    
    request.followUps.push({
      message: clientMessage,
      sentBy: 'client',
      sentAt: new Date()
    });

    await request.save();

    // Log follow-up for audit
    console.log(`[AUDIT] Client ${req.user._id} added follow-up to request ${request._id}`);

    res.json({ message: 'Follow-up message added successfully' });
  } catch (error) {
    console.error('Add follow-up error:', error);
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