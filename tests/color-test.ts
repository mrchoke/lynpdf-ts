import * as fs from 'fs';
import PDFDocument from 'pdfkit';

// Test A: Simple mode (no bufferPages)
const docA = new PDFDocument({ size: 'A4', margin: 50 });
const streamA = fs.createWriteStream('tests/output/color-test-simple.pdf');
docA.pipe(streamA);
docA.registerFont('Sarabun', 'fonts/Sarabun-Regular.ttf');
docA.font('Sarabun').fontSize(14);

docA.text('Color Test A: Simple (no bufferPages)', 50, 30);

// Red
docA.rect(50, 80, 150, 50).fill('#ff0000');
docA.fillColor('#ffffff').text('Red #ff0000', 55, 95, { width: 140 });

// Green
docA.rect(210, 80, 150, 50).fill('#00ff00');
docA.fillColor('#000000').text('Green #00ff00', 215, 95, { width: 140 });

// Blue
docA.rect(370, 80, 150, 50).fill('#0000ff');
docA.fillColor('#ffffff').text('Blue #0000ff', 375, 95, { width: 140 });

// Named colors
docA.rect(50, 150, 150, 50).fill('red');
docA.fillColor('#ffffff').text('Named: red', 55, 165, { width: 140 });

docA.rect(210, 150, 150, 50).fill('green');
docA.fillColor('#ffffff').text('Named: green', 215, 165, { width: 140 });

docA.rect(370, 150, 150, 50).fill('blue');
docA.fillColor('#ffffff').text('Named: blue', 375, 165, { width: 140 });

// RGB arrays
docA.rect(50, 220, 150, 50).fill([255, 0, 0]);
docA.fillColor('#ffffff').text('Array [255,0,0]', 55, 235, { width: 140 });

docA.rect(210, 220, 150, 50).fill([0, 255, 0]);
docA.fillColor('#000000').text('Array [0,255,0]', 215, 235, { width: 140 });

docA.rect(370, 220, 150, 50).fill([0, 0, 255]);
docA.fillColor('#ffffff').text('Array [0,0,255]', 375, 235, { width: 140 });

docA.end();
streamA.on('finish', () => console.log('Created: tests/output/color-test-simple.pdf'));

// Test B: With bufferPages (like our renderer)
const docB = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
const streamB = fs.createWriteStream('tests/output/color-test-buffered.pdf');
docB.pipe(streamB);
docB.registerFont('Sarabun', 'fonts/Sarabun-Regular.ttf');
docB.font('Sarabun').fontSize(14);

docB.text('Color Test B: bufferPages=true', 50, 30);

// With save/restore (like our renderer)
docB.save();
docB.rect(50, 80, 150, 50);
docB.fillOpacity(1).fill('#ff0000');
docB.restore();
docB.save();
docB.fillOpacity(1).fillColor('#ffffff').font('Sarabun').text('Red #ff0000', 55, 95, { width: 140 });
docB.restore();

docB.save();
docB.rect(210, 80, 150, 50);
docB.fillOpacity(1).fill('#00ff00');
docB.restore();
docB.save();
docB.fillOpacity(1).fillColor('#000000').font('Sarabun').text('Green #00ff00', 215, 95, { width: 140 });
docB.restore();

docB.save();
docB.rect(370, 80, 150, 50);
docB.fillOpacity(1).fill('#0000ff');
docB.restore();
docB.save();
docB.fillOpacity(1).fillColor('#ffffff').font('Sarabun').text('Blue #0000ff', 375, 95, { width: 140 });
docB.restore();

docB.flushPages();
docB.end();
streamB.on('finish', () => console.log('Created: tests/output/color-test-buffered.pdf'));
