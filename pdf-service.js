const PDFDocument = require('pdfkit');
const fs = require('fs');

function generateTablePDF(outputPath, tableData) {
  const doc = new PDFDocument();
  doc.pipe(fs.createWriteStream(outputPath));

  // Starting coordinates
  let startX = 50;
  let startY = 100;
  let rowHeight = 30;
  let colWidth = 150;

  // Draw headers
  tableData.headers.forEach((header, i) => {
    doc.rect(startX + i * colWidth, startY, colWidth, rowHeight).stroke();
    doc.text(header, startX + i * colWidth + 5, startY + 10);
  });

  // Draw rows
  tableData.rows.forEach((row, rowIndex) => {
    row.forEach((cell, i) => {
      let y = startY + (rowIndex + 1) * rowHeight;
      doc.rect(startX + i * colWidth, y, colWidth, rowHeight).stroke();
      doc.text(cell, startX + i * colWidth + 5, y + 10);
    });
  });

  doc.end();
}

// Export the function
module.exports = generateTablePDF;

