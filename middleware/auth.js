const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Client = require('../models/Client');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user is admin
    if (decoded.type === 'admin') {
      const admin = await Admin.findById(decoded.id).select('-password');
      if (!admin || !admin.isActive) {
        return res.status(401).json({ message: 'Token is not valid' });
      }
      req.user = admin;
      req.userType = 'admin';
    } 
    // Check if user is client
    else if (decoded.type === 'client') {
      const client = await Client.findById(decoded.id).select('-password');
      if (!client || !client.isActive) {
        return res.status(401).json({ message: 'Token is not valid' });
      }
      req.user = client;
      req.userType = 'client';
    } else {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const adminAuth = (req, res, next) => {
  if (req.userType !== 'admin') {
    return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
  }
  next();
};

const clientAuth = (req, res, next) => {
  if (req.userType !== 'client') {
    return res.status(403).json({ message: 'Access denied. Client privileges required.' });
  }
  next();
};

module.exports = { auth, adminAuth, clientAuth };
