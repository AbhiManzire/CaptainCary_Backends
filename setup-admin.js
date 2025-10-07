const mongoose = require('mongoose');
const Admin = require('./models/Admin');

async function setupAdmin() {
  try {
    await mongoose.connect('mongodb://localhost:27017/captaincary');
    console.log('Connected to database');
    
    // Delete all existing admins
    await Admin.deleteMany({});
    console.log('Deleted all existing admins');
    
    // Create new admin
    const admin = new Admin({
      username: 'admin',
      email: 'admin@captaincary.com',
      password: 'admin123',
      fullName: 'System Administrator',
      role: 'admin',
      isActive: true
    });
    
    await admin.save();
    console.log('✅ Admin created successfully!');
    console.log('📧 Email: admin@captaincary.com');
    console.log('🔑 Password: admin123');
    console.log('🌐 Login URL: http://localhost:3000/admin/login');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupAdmin();
