const nodemailer = require('nodemailer');
const whatsappService = require('./whatsappService');

// Email configuration (you'll need to set these in your environment variables)
const transporter = nodemailer.createTransport({
  service: 'gmail', // You can change this to your preferred email service
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

// Send notification email to admin when new crew registers
const sendNewCrewNotification = async (crewData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: process.env.ADMIN_EMAIL || 'admin@captaincary.com',
      subject: `🚢 New Crew Registration - ${crewData.fullName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Captain Cary - New Crew Registration</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f8fafc; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
                .header { background: linear-gradient(135deg, #3B82F6, #1D4ED8); color: white; padding: 30px; text-align: center; }
                .header h1 { margin: 0; font-size: 28px; font-weight: bold; }
                .content { padding: 30px; }
                .crew-details { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
                .detail-row { display: flex; margin-bottom: 10px; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
                .detail-row:last-child { border-bottom: none; }
                .label { font-weight: bold; color: #374151; width: 120px; flex-shrink: 0; }
                .value { color: #1f2937; flex: 1; }
                .action-button { display: inline-block; background: linear-gradient(135deg, #10B981, #059669); color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 20px 0; }
                .footer { background: #f3f4f6; padding: 20px; text-align: center; color: #6b7280; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🚢 Captain Cary Maritime Services</h1>
                    <h2>New Crew Registration Alert</h2>
                </div>
                <div class="content">
                    <div class="crew-details">
                        <h3 style="margin-top: 0; color: #1f2937;">👤 Crew Information</h3>
                        <div class="detail-row">
                            <span class="label">Name:</span>
                            <span class="value">${crewData.fullName}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Email:</span>
                            <span class="value">${crewData.email}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Phone:</span>
                            <span class="value">${crewData.phone}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Rank:</span>
                            <span class="value">${crewData.rank}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Nationality:</span>
                            <span class="value">${crewData.nationality}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Location:</span>
                            <span class="value">${crewData.currentLocation}</span>
                        </div>
                        <div class="detail-row">
                            <span class="label">Availability:</span>
                            <span class="value">${new Date(crewData.availabilityDate).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                        <strong>📋 Action Required:</strong> Please review this crew application in the admin dashboard.
                    </p>
                    <a href="http://localhost:3000/admin/crew" class="action-button">
                        🔍 Review in Admin Panel
                    </a>
                </div>
                <div class="footer">
                    <p><strong>Captain Cary Maritime Services</strong></p>
                    <p>Professional Crew Management Solutions</p>
                    <p>Generated on: ${new Date().toLocaleString()}</p>
                </div>
            </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('New crew notification email sent successfully');

    // Send WhatsApp notification if available
    try {
      const adminPhone = process.env.ADMIN_PHONE || '+1234567890'; // Set admin phone in environment
      if (whatsappService.isClientReady()) {
        await whatsappService.sendNewCrewNotification(crewData, adminPhone);
        console.log('New crew notification WhatsApp sent successfully');
      }
    } catch (whatsappError) {
      console.error('Error sending WhatsApp notification:', whatsappError);
    }
  } catch (error) {
    console.error('Error sending new crew notification email:', error);
  }
};

// Send notification email to admin when client makes a request
const sendClientRequestNotification = async (requestData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: process.env.ADMIN_EMAIL || 'admin@captaincary.com',
      subject: `New Client Request - ${requestData.requestType}`,
      html: `
        <h2>New Client Request</h2>
        <p>A client has made a new request:</p>
        <ul>
          <li><strong>Client:</strong> ${requestData.client.companyName}</li>
          <li><strong>Contact Person:</strong> ${requestData.client.contactPerson}</li>
          <li><strong>Request Type:</strong> ${requestData.requestType}</li>
          <li><strong>Crew Member:</strong> ${requestData.crew.fullName} (${requestData.crew.rank})</li>
          <li><strong>Urgency:</strong> ${requestData.urgency}</li>
          ${requestData.message ? `<li><strong>Message:</strong> ${requestData.message}</li>` : ''}
        </ul>
        <p>Please review and respond to this request in the admin dashboard.</p>
        <p>Best regards,<br>Captain Cary System</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Client request notification email sent successfully');

    // Send WhatsApp notification if available
    try {
      const adminPhone = process.env.ADMIN_PHONE || '+1234567890'; // Set admin phone in environment
      if (whatsappService.isClientReady()) {
        await whatsappService.sendClientRequestNotification(requestData, adminPhone);
        console.log('Client request notification WhatsApp sent successfully');
      }
    } catch (whatsappError) {
      console.error('Error sending WhatsApp notification:', whatsappError);
    }
  } catch (error) {
    console.error('Error sending client request notification email:', error);
  }
};

// Send confirmation email to crew member after registration
const sendCrewRegistrationConfirmation = async (crewData) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: crewData.email,
      subject: 'Registration Confirmation - Captain Cary',
      html: `
        <h2>Registration Confirmed</h2>
        <p>Dear ${crewData.fullName},</p>
        <p>Thank you for registering with Captain Cary. Your application has been received and is being reviewed.</p>
        <p><strong>Application Details:</strong></p>
        <ul>
          <li><strong>Name:</strong> ${crewData.fullName}</li>
          <li><strong>Rank:</strong> ${crewData.rank}</li>
          <li><strong>Nationality:</strong> ${crewData.nationality}</li>
          <li><strong>Availability Date:</strong> ${new Date(crewData.availabilityDate).toLocaleDateString()}</li>
        </ul>
        <p>We will review your application and get back to you soon. You can expect to hear from us within 2-3 business days.</p>
        <p>If you have any questions, please don't hesitate to contact us.</p>
        <p>Best regards,<br>Captain Cary Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Crew registration confirmation email sent successfully');
  } catch (error) {
    console.error('Error sending crew registration confirmation email:', error);
  }
};

// Send notification to client when crew status changes
const sendClientCrewStatusNotification = async (clientData, crewData, status) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: clientData.email,
      subject: `Crew Status Update - ${crewData.fullName}`,
      html: `
        <h2>Crew Status Update</h2>
        <p>Dear ${clientData.contactPerson},</p>
        <p>The status of crew member ${crewData.fullName} has been updated:</p>
        <ul>
          <li><strong>Crew Member:</strong> ${crewData.fullName}</li>
          <li><strong>Rank:</strong> ${crewData.rank}</li>
          <li><strong>New Status:</strong> ${status}</li>
          <li><strong>Updated:</strong> ${new Date().toLocaleDateString()}</li>
        </ul>
        <p>You can view the updated profile in your client portal.</p>
        <p>Best regards,<br>Captain Cary Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Client crew status notification email sent successfully');
  } catch (error) {
    console.error('Error sending client crew status notification email:', error);
  }
};

// Send notification to client when request is approved/rejected
const sendClientRequestStatusNotification = async (clientData, requestData, status) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: clientData.email,
      subject: `Request Update - ${requestData.requestType}`,
      html: `
        <h2>Request Status Update</h2>
        <p>Dear ${clientData.contactPerson},</p>
        <p>Your request has been ${status}:</p>
        <ul>
          <li><strong>Request Type:</strong> ${requestData.requestType}</li>
          <li><strong>Crew Member:</strong> ${requestData.crew.fullName} (${requestData.crew.rank})</li>
          <li><strong>Status:</strong> ${status}</li>
          <li><strong>Updated:</strong> ${new Date().toLocaleDateString()}</li>
        </ul>
        ${status === 'approved' ? 
          '<p>Please contact us to proceed with the next steps.</p>' : 
          '<p>If you have any questions, please don\'t hesitate to contact us.</p>'
        }
        <p>Best regards,<br>Captain Cary Team</p>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Client request status notification email sent successfully');
  } catch (error) {
    console.error('Error sending client request status notification email:', error);
  }
};

module.exports = {
  sendNewCrewNotification,
  sendClientRequestNotification,
  sendCrewRegistrationConfirmation,
  sendClientCrewStatusNotification,
  sendClientRequestStatusNotification
};
