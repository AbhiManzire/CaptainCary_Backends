const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');

// Add watermark to PDF documents
const addWatermarkToPDF = async (inputPath, outputPath, watermarkText = 'Captain Cary - Confidential') => {
  try {
    // Read the existing PDF
    const existingPdfBytes = fs.readFileSync(inputPath);
    
    // Load the PDF document
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    
    // Add watermark to each page
    pages.forEach((page) => {
      const { width, height } = page.getSize();
      
      // Add watermark text
      page.drawText(watermarkText, {
        x: width / 2 - 100,
        y: height / 2,
        size: 20,
        color: rgb(0.7, 0.7, 0.7), // Light gray color
        opacity: 0.3,
        rotate: { type: 'degrees', angle: -45 }
      });
      
      // Add additional watermark at bottom
      page.drawText(`© Captain Cary - ${new Date().getFullYear()}`, {
        x: 50,
        y: 50,
        size: 10,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.5
      });
    });
    
    // Save the watermarked PDF
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    return true;
  } catch (error) {
    console.error('Error adding watermark to PDF:', error);
    return false;
  }
};

// Create a simple text watermark for non-PDF files
const addTextWatermark = (content, watermarkText = 'Captain Cary - Confidential') => {
  const watermark = `
    
    ================================================
    ${watermarkText}
    © Captain Cary - ${new Date().getFullYear()}
    This document is confidential and proprietary
    ================================================
    
    ${content}
    
    ================================================
    End of Document
    ================================================
  `;
  
  return watermark;
};

// Process document with watermark
const processDocumentWithWatermark = async (inputPath, outputPath, documentType, clientInfo = null) => {
  try {
    const ext = path.extname(inputPath).toLowerCase();
    
    if (ext === '.pdf') {
      // For PDF files, add visual watermark
      const watermarkText = clientInfo 
        ? `Captain Cary - ${clientInfo.companyName} - ${new Date().toLocaleDateString()}`
        : 'Captain Cary - Confidential';
      
      return await addWatermarkToPDF(inputPath, outputPath, watermarkText);
    } else {
      // For other files, add text watermark
      const content = fs.readFileSync(inputPath, 'utf8');
      const watermarkedContent = addTextWatermark(content, 
        clientInfo 
          ? `Captain Cary - ${clientInfo.companyName} - ${new Date().toLocaleDateString()}`
          : 'Captain Cary - Confidential'
      );
      
      fs.writeFileSync(outputPath, watermarkedContent);
      return true;
    }
  } catch (error) {
    console.error('Error processing document with watermark:', error);
    return false;
  }
};

module.exports = {
  addWatermarkToPDF,
  addTextWatermark,
  processDocumentWithWatermark
};
