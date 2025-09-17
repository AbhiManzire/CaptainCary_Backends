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
      subject: `New Crew Registration - ${crewData.fullName}`,
      html: `
        <h2>New Crew Registration</h2>
        <p>A new crew member has registered:</p>
        <ul>
          <li><strong>Name:</strong> ${crewData.fullName}</li>
          <li><strong>Email:</strong> ${crewData.email}</li>
          <li><strong>Phone:</strong> ${crewData.phone}</li>
          <li><strong>Rank:</strong> ${crewData.rank}</li>
          <li><strong>Nationality:</strong> ${crewData.nationality}</li>
          <li><strong>Availability Date:</strong> ${new Date(crewData.availabilityDate).toLocaleDateString()}</li>
        </ul>
        <p>Please review the application in the admin dashboard.</p>
        <p>Best regards,<br>Captain Cary System</p>
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
