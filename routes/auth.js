const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Admin = require('../models/Admin');
const Client = require('../models/Client');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT token
const generateToken = (id, type) => {
  return jwt.sign({ id, type }, process.env.JWT_SECRET, { expiresIn: '24h' }); // 24 hours session
};

// Admin login
router.post('/admin/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    console.log('Admin login attempt:', { email, passwordLength: password?.length });
    
    const admin = await Admin.findOne({ email });
    console.log('Admin found:', !!admin);
    
    if (!admin || !admin.isActive) {
      console.log('Admin not found or inactive');
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await admin.comparePassword(password);
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      console.log('Password does not match');
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    admin.lastLogin = new Date();
    await admin.save();

    const token = generateToken(admin._id, 'admin');
    res.json({
      token,
      user: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Client login
router.post('/client/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;
    const client = await Client.findOne({ email });
    
    if (!client || !client.isActive) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await client.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    client.lastLogin = new Date();
    await client.save();

    const token = generateToken(client._id, 'client');
    res.json({
      token,
      user: {
        id: client._id,
        companyName: client.companyName,
        email: client.email,
        contactPerson: client.contactPerson
      }
    });
  } catch (error) {
    console.error('Client login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: req.user,
      userType: req.userType
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Refresh token endpoint
router.post('/refresh', auth, async (req, res) => {
  try {
    // Generate new token with same user info
    const newToken = generateToken(req.user._id, req.userType);
    
    res.json({
      token: newToken,
      user: req.user,
      userType: req.userType
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user info endpoint
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: req.user,
      userType: req.userType
    });
  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Keep alive endpoint to prevent session timeout
router.get('/keep-alive', auth, async (req, res) => {
  try {
    // Update last activity timestamp
    if (req.userType === 'admin') {
      await Admin.findByIdAndUpdate(req.user._id, { lastActivity: new Date() });
    } else if (req.userType === 'client') {
      await Client.findByIdAndUpdate(req.user._id, { lastActivity: new Date() });
    }
    
    res.json({ 
      message: 'Session is alive',
      user: req.user,
      userType: req.userType,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Keep alive error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create admin (for initial setup)
router.post('/admin/register', [
  body('username').isLength({ min: 3 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('fullName').isLength({ min: 2 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password, fullName, role = 'admin' } = req.body;

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ $or: [{ email }, { username }] });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists' });
    }

    const admin = new Admin({
      username,
      email,
      password,
      fullName,
      role
    });

    await admin.save();

    const token = generateToken(admin._id, 'admin');
    res.status(201).json({
      token,
      user: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
