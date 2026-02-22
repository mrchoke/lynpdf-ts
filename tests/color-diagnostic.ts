import * as fs from 'fs'
import PDFDocument from 'pdfkit'

/**
 * Color inversion diagnostic:
 * Generates a PDF with labeled color swatches using hex, array, and named format.
 * Uses BOTH doc.fillColor().rect().fill() AND doc.rect().fill(color) patterns.
 * If colors look correct here but wrong in main output, it's our rendering code.
 * If colors look wrong here too, it's a PDFKit / viewer issue.
 */

const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
const stream = fs.createWriteStream('tests/output/color-diagnostic.pdf');
doc.pipe(stream);

doc.registerFont('Sarabun', 'fonts/Sarabun-Regular.ttf');
doc.font('Sarabun').fontSize(11);

let y = 30;
doc.fillColor('#000000').text('Color Diagnostic — bufferPages:true, margin:0', 50, y);
y += 25;
doc.fillColor('#000000').text('If red/green/blue look correct, PDF is fine (viewer issue if main tests look wrong)', 50, y);
y += 30;

const colors: Array<{label: string, fill: string | [number, number, number]}> = [
  { label: 'Hex #ff0000 (RED)', fill: '#ff0000' },
  { label: 'Hex #00ff00 (GREEN)', fill: '#00ff00' },
  { label: 'Hex #0000ff (BLUE)', fill: '#0000ff' },
  { label: 'Array [255,0,0] (RED)', fill: [255, 0, 0] },
  { label: 'Array [0,255,0] (GREEN)', fill: [0, 255, 0] },
  { label: 'Array [0,0,255] (BLUE)', fill: [0, 0, 255] },
  { label: 'Hex #3498db (BLUE web)', fill: '#3498db' },
  { label: 'Hex #e74c3c (RED web)', fill: '#e74c3c' },
  { label: 'Hex #2ecc71 (GREEN web)', fill: '#2ecc71' },
  { label: 'Hex #f39c12 (ORANGE)', fill: '#f39c12' },
  { label: 'Hex #9b59b6 (PURPLE)', fill: '#9b59b6' },
  { label: 'Hex #ff6b6b (LIGHT RED)', fill: '#ff6b6b' },
  { label: 'Hex #4ecdc4 (TEAL)', fill: '#4ecdc4' },
];

// Method 1: save/restore + fillOpacity + fill(color) — like our background rendering
doc.fillColor('#000000').text('Method 1: save() → fillOpacity(1) → rect() → fill(color) → restore()', 50, y);
y += 20;

for (const c of colors) {
  doc.save();
  doc.rect(50, y, 200, 25);
  doc.fillOpacity(1).fill(c.fill as string);
  doc.restore();

  doc.save();
  doc.fillOpacity(1).fillColor('#ffffff').font('Sarabun').fontSize(11);
  doc.text(c.label, 60, y + 6, { width: 180, lineBreak: false });
  doc.restore();
  y += 28;
}

y += 15;

// Method 2: direct fill without save/restore
doc.fillColor('#000000').text('Method 2: rect().fill(color) — no save/restore', 50, y);
y += 20;

for (const c of colors.slice(0, 6)) {
  doc.rect(300, y, 200, 25).fill(c.fill as string);
  doc.fillColor('#ffffff').text(c.label, 310, y + 6, { width: 180, lineBreak: false });
  y += 28;
}

doc.flushPages();
doc.end();

stream.on('finish', () => {
  console.log('Created: tests/output/color-diagnostic.pdf');
  console.log('Please open and check if colors match their labels');
});
