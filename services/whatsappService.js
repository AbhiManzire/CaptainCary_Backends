const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCode = null;
  }

  async initialize() {
    try {
      this.client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
      });

      this.client.on('qr', (qr) => {
        console.log('WhatsApp QR Code generated');
        this.qrCode = qr;
        qrcode.generate(qr, { small: true });
      });

      this.client.on('ready', () => {
        console.log('WhatsApp client is ready!');
        this.isReady = true;
        this.qrCode = null;
      });

      this.client.on('authenticated', () => {
        console.log('WhatsApp client authenticated');
      });

      this.client.on('auth_failure', (msg) => {
        console.error('WhatsApp authentication failed:', msg);
      });

      this.client.on('disconnected', (reason) => {
        console.log('WhatsApp client disconnected:', reason);
        this.isReady = false;
      });

      await this.client.initialize();
    } catch (error) {
      console.error('Error initializing WhatsApp service:', error);
    }
  }

  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      // Format phone number (remove any non-digit characters and add country code if needed)
      const formattedNumber = phoneNumber.replace(/\D/g, '');
      const chatId = formattedNumber.includes('@c.us') ? formattedNumber : `${formattedNumber}@c.us`;
      
      await this.client.sendMessage(chatId, message);
      console.log(`WhatsApp message sent to ${phoneNumber}`);
      return true;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  async sendNewCrewNotification(crewData, adminPhone) {
    const message = `🚢 *New Crew Registration - Captain Cary*

*Name:* ${crewData.fullName}
*Rank:* ${crewData.rank}
*Nationality:* ${crewData.nationality}
*Email:* ${crewData.email}
*Phone:* ${crewData.phone}
*Availability:* ${new Date(crewData.availabilityDate).toLocaleDateString()}

Please review the application in the admin dashboard.

Best regards,
Captain Cary System`;

    return await this.sendMessage(adminPhone, message);
  }

  async sendClientRequestNotification(requestData, adminPhone) {
    const message = `📋 *New Client Request - Captain Cary*

*Client:* ${requestData.client.companyName}
*Contact:* ${requestData.client.contactPerson}
*Request Type:* ${requestData.requestType}
*Crew Member:* ${requestData.crew.fullName} (${requestData.crew.rank})
*Urgency:* ${requestData.urgency}
${requestData.message ? `*Message:* ${requestData.message}` : ''}

Please review and respond to this request in the admin dashboard.

Best regards,
Captain Cary System`;

    return await this.sendMessage(adminPhone, message);
  }

  getQRCode() {
    return this.qrCode;
  }

  isClientReady() {
    return this.isReady;
  }

  async disconnect() {
    if (this.client) {
      await this.client.destroy();
      this.isReady = false;
    }
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;
