const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const bcrypt = require('bcryptjs');

async function createCustomAdmin() {
  try {
    await mongoose.connect('mongodb://localhost:27017/captaincary');
    console.log('✅ Connected to database');
    
    // Delete existing admin
    await Admin.deleteMany({});
    console.log('🗑️ Deleted existing admin');
    
    // Create custom admin
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    const admin = new Admin({
      username: 'admin',
      email: 'admin1@gmail.com', // Your email
      password: hashedPassword,
      fullName: 'Tejas Ghogare',
      role: 'admin',
      isActive: true
    });
    
    await admin.save();
    console.log('✅ Custom admin created successfully!');
    console.log('📧 Email: admin1@gmail.com');
    console.log('🔑 Password: admin123');
    console.log('🌐 Login URL: http://localhost:3000/admin/login');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

createCustomAdmin();
