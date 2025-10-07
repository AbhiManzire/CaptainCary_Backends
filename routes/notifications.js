const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const whatsappService = require('../services/whatsappService');

// Send email notification
router.post('/email', async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    if (!email || !subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, subject, and message are required' 
      });
    }

    // Check if email credentials are properly configured
    const emailUser = process.env.EMAIL_USER || 'your-email@gmail.com';
    const emailPass = process.env.EMAIL_PASS || 'your-app-password';
    
    if (!emailUser || !emailPass || emailUser === 'your-email@gmail.com' || emailPass === 'your-app-password') {
      console.log('Email credentials not configured. Skipping email send.');
      console.log('Email would be sent to:', email);
      console.log('Subject:', subject);
      console.log('Message:', message);
      
      return res.json({ 
        success: true, 
        message: 'Email notification logged (credentials not configured)' 
      });
    }

    // Create email transporter with proper credentials
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    // Test the transporter connection before sending
    try {
      await transporter.verify();
      console.log('Email transporter verified successfully');
    } catch (verifyError) {
      console.error('Email transporter verification failed:', verifyError);
      return res.json({ 
        success: false, 
        message: 'Email service not available - invalid credentials',
        error: verifyError.message 
      });
    }

    const mailOptions = {
      from: emailUser,
      to: email,
      subject: subject,
      html: message
    };

    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Email sent successfully' 
    });
  } catch (error) {
    console.error('Email notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send email notification',
      error: error.message 
    });
  }
});

// Send WhatsApp notification
router.post('/whatsapp', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phone number and message are required' 
      });
    }

    // Check if WhatsApp service is available
    if (!whatsappService.isClientReady()) {
      console.log('WhatsApp service not ready. Current status:', {
        isReady: whatsappService.isClientReady(),
        hasQRCode: !!whatsappService.getQRCode()
      });
      
      return res.json({ 
        success: true, 
        message: 'WhatsApp notification logged (service not configured)',
        details: 'WhatsApp client is not ready. This may be due to authentication issues or service not being initialized.'
      });
    }

    // Send WhatsApp message
    await whatsappService.sendMessage(phoneNumber, message);
    
    res.json({ 
      success: true, 
      message: 'WhatsApp message sent successfully' 
    });
  } catch (error) {
    console.error('WhatsApp notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send WhatsApp notification',
      error: error.message 
    });
  }
});

// Send crew registration confirmation
router.post('/crew-confirmation', async (req, res) => {
  try {
    const { crewData } = req.body;

    if (!crewData || !crewData.email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Crew data with email is required' 
      });
    }

    await notificationService.sendCrewRegistrationConfirmation(crewData);
    
    res.json({ 
      success: true, 
      message: 'Crew confirmation email sent successfully' 
    });
  } catch (error) {
    console.error('Crew confirmation notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send crew confirmation notification',
      error: error.message 
    });
  }
});

// Send new crew notification to admin
router.post('/new-crew', async (req, res) => {
  try {
    const { crewData } = req.body;

    if (!crewData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Crew data is required' 
      });
    }

    await notificationService.sendNewCrewNotification(crewData);
    
    res.json({ 
      success: true, 
      message: 'New crew notification sent successfully' 
    });
  } catch (error) {
    console.error('New crew notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send new crew notification',
      error: error.message 
    });
  }
});

// Send client request notification to admin
router.post('/client-request', async (req, res) => {
  try {
    const { requestData } = req.body;

    if (!requestData) {
      return res.status(400).json({ 
        success: false, 
        message: 'Request data is required' 
      });
    }

    await notificationService.sendClientRequestNotification(requestData);
    
    res.json({ 
      success: true, 
      message: 'Client request notification sent successfully' 
    });
  } catch (error) {
    console.error('Client request notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send client request notification',
      error: error.message 
    });
  }
});

// Check WhatsApp service status
router.get('/whatsapp-status', (req, res) => {
  try {
    const status = {
      isReady: whatsappService.isClientReady(),
      hasQRCode: !!whatsappService.getQRCode(),
      qrCode: whatsappService.getQRCode()
    };
    
    res.json({
      success: true,
      status: status,
      message: status.isReady ? 'WhatsApp service is ready' : 'WhatsApp service is not ready'
    });
  } catch (error) {
    console.error('WhatsApp status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check WhatsApp status',
      error: error.message
    });
  }
});

// Send crew status update notification
router.post('/crew-status-update', async (req, res) => {
  try {
    const { crewData, status, adminMessage } = req.body;

    if (!crewData || !status) {
      return res.status(400).json({ 
        success: false, 
        message: 'Crew data and status are required' 
      });
    }

    // Check if email credentials are properly configured
    const emailUser = process.env.EMAIL_USER || 'your-email@gmail.com';
    const emailPass = process.env.EMAIL_PASS || 'your-app-password';
    
    if (!emailUser || !emailPass || emailUser === 'your-email@gmail.com' || emailPass === 'your-app-password') {
      console.log('Email credentials not configured. Skipping crew status update email.');
      console.log('Status update would be sent to:', crewData.email);
      console.log('Status:', status);
      console.log('Admin message:', adminMessage);
      
      return res.json({ 
        success: true, 
        message: 'Crew status update logged (credentials not configured)' 
      });
    }

    // Create email transporter with proper credentials
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    let statusMessage = '';
    switch (status) {
      case 'approved':
        statusMessage = 'Congratulations! Your application has been approved and is now visible to our clients.';
        break;
      case 'rejected':
        statusMessage = 'Unfortunately, your application was not approved at this time.';
        break;
      case 'missing_docs':
        statusMessage = 'Your application is missing some required documents. Please check your email for details.';
        break;
      default:
        statusMessage = 'Your application status has been updated.';
    }

    const message = `Status Update - CFM Crew Portal

${statusMessage}

${adminMessage ? `Admin Message: ${adminMessage}` : ''}

Please log in to your account for more details.

Best regards,
CFM Team`;

    const mailOptions = {
      from: emailUser,
      to: crewData.email,
      subject: 'Application Status Update - CFM',
      html: message.replace(/\n/g, '<br>')
    };

    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Crew status update notification sent successfully' 
    });
  } catch (error) {
    console.error('Crew status update notification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to send crew status update notification',
      error: error.message 
    });
  }
});

module.exports = router;
