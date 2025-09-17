module.exports = {
  // Email configuration
  email: {
    service: 'gmail', // Change to your preferred email service
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@captaincary.com'
  },
  
  // Instructions for setting up email notifications:
  // 1. For Gmail:
  //    - Enable 2-factor authentication
  //    - Generate an App Password
  //    - Use the App Password as EMAIL_PASS
  // 2. Set environment variables:
  //    - EMAIL_USER=your-email@gmail.com
  //    - EMAIL_PASS=your-app-password
  //    - ADMIN_EMAIL=admin@captaincary.com
  // 3. Or modify the values directly in this file
};
