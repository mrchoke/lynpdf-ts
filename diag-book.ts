import fs from 'fs';
import { PAGE_H, PAGE_MARGIN } from './src/constants';
import { LayoutEngine, type LayoutNode } from './src/layout/layout-engine';
import { CSSParser } from './src/parser/css-parser';
import { HTMLParser } from './src/parser/html-parser';

const htmlFile = 'examples/book-lynpdf-guide.html';
const htmlContent = fs.readFileSync(htmlFile, 'utf-8');
const dom = HTMLParser.parse(htmlContent);

let css = '';
const extractStyles = (node: any) => {
  if (node.nodeName === 'style' && node.childNodes?.length > 0) {
    css += node.childNodes[0].value + '\n';
  }
  if (node.childNodes) for (const c of node.childNodes) extractStyles(c);
};
extractStyles(dom);

const styles = CSSParser.parse(css);

const result = LayoutEngine.calculate(dom, styles);
const root = result.rootNode;
const CONTENT_H = PAGE_H - PAGE_MARGIN * 2;

function getPage(y: number) { return Math.floor(y / PAGE_H); }
function getLocalY(y: number) { return y - getPage(y) * PAGE_H; }

function actualBottom(node: LayoutNode): number {
  let b = node.y + node.height;
  for (const c of node.children) b = Math.max(b, actualBottom(c));
  return b;
}

function getTextContent(node: LayoutNode, maxLen = 80): string {
  let text = '';
  const walk = (n: LayoutNode) => {
    if (n.type === 'text' && (n as any).content) text += (n as any).content;
    if (n.text) text += n.text;
    for (const c of n.children) { if (text.length < maxLen) walk(c); }
  };
  walk(node);
  return text.substring(0, maxLen).replace(/\n/g, ' ').trim();
}

// ── BODY CHILDREN DUMP ──
// The layout root wraps the <body>; actual content is one level deeper.
const body = root.children[0] || root;
console.log('=== BODY CHILDREN LAYOUT DUMP ===');
console.log(`PAGE_H=${PAGE_H} PAGE_MARGIN=${PAGE_MARGIN} CONTENT_H=${CONTENT_H}`);
console.log(`Total body children: ${body.children.length}\n`);

let prevActBottom = 0;
let prevPage = 0;

for (let i = 0; i < body.children.length; i++) {
  const child = body.children[i]!;
  const page = getPage(child.y);
  const localY = getLocalY(child.y);
  const bottom = child.y + child.height;
  const actBot = actualBottom(child);
  const gap = i > 0 ? child.y - prevActBottom : 0;
  const tag = child.tagName || child.type || '?';
  const text = getTextContent(child, 60);

  const flags: string[] = [];
  if (gap > 50 && page === prevPage && i > 0) flags.push(`⚠️ BIG_GAP=${gap.toFixed(0)}`);
  if (localY < PAGE_MARGIN - 1 && page > 0) flags.push('🔴 HEADER_ZONE');
  if (bottom > (page + 1) * PAGE_H - PAGE_MARGIN && child.height > 0) flags.push('🟡 FOOTER');
  if (child.height === 0) flags.push('(h=0)');
  const pb = child.styles?.['page-break-before'] || child.styles?.['break-before'] || '';
  if (pb === 'always' || pb === 'page') flags.push('📄 PB-BEFORE');

  console.log(
    `[${i}] <${tag}> p${page} ly=${localY.toFixed(1)} y=${child.y.toFixed(1)} h=${child.height.toFixed(1)} ` +
    `actBot=${actBot.toFixed(1)} gap=${gap.toFixed(1)} ${flags.join(' ')}`
  );
  console.log(`     "${text}"`);

  prevActBottom = actBot;
  prevPage = page;
}

// ── PAGE SUMMARY ──
console.log('\n=== PAGE SUMMARY ===');
const totalPages = getPage(actualBottom(body)) + 1;
for (let p = 0; p < totalPages; p++) {
  const pageTop = p * PAGE_H + PAGE_MARGIN;
  const pageBot = (p + 1) * PAGE_H - PAGE_MARGIN;
  const kids = body.children.filter((c: LayoutNode) => getPage(c.y) === p);
  console.log(`\nPage ${p + 1} (${kids.length} children, contentY=${pageTop.toFixed(0)}..${pageBot.toFixed(0)}):`);
  for (const c of kids) {
    const localY = getLocalY(c.y);
    const tag = c.tagName || c.type || '?';
    const text = getTextContent(c, 50);
    const gapFromTop = localY - PAGE_MARGIN;
    const gapFlag = gapFromTop > 100 ? ` *** GAP_FROM_TOP=${gapFromTop.toFixed(0)} ***` : '';
    console.log(`  <${tag}> ly=${localY.toFixed(1)} h=${c.height.toFixed(1)}${gapFlag} "${text}"`);
  }
}

// ── OVERLAP CHECK ──
console.log('\n=== OVERLAP CHECK ===');
for (let i = 0; i < body.children.length - 1; i++) {
  const curr = body.children[i]!;
  const next = body.children[i + 1]!;
  const currBot = actualBottom(curr);
  if (next.y < currBot - 0.5) {
    console.log(
      `🔴 OVERLAP: [${i}]<${curr.tagName}> actBot=${currBot.toFixed(1)} > [${i+1}]<${next.tagName}> y=${next.y.toFixed(1)} ` +
      `overlap=${(currBot - next.y).toFixed(1)}pt`
    );
    console.log(`   [${i}] "${getTextContent(curr, 40)}"`);
    console.log(`   [${i+1}] "${getTextContent(next, 40)}"`);
  }
}

// ── TABLE DETAILS (multi-page only) ──
console.log('\n=== MULTI-PAGE TABLES ===');
let tIdx = 0;
function dumpTables(node: LayoutNode) {
  if (node.tagName === 'table') {
    tIdx++;
    const startP = getPage(node.y);
    const endP = getPage(actualBottom(node));
    if (endP > startP) {
      console.log(`\nTable ${tIdx}: p${startP}-p${endP} y=${node.y.toFixed(1)} h=${node.height.toFixed(1)} actBot=${actualBottom(node).toFixed(1)}`);
      for (const sec of node.children) {
        if (['thead','tbody','tfoot'].includes(sec.tagName || '')) {
          for (const row of sec.children) {
            if (row.tagName === 'tr') {
              const rP = getPage(row.y);
              const rLy = getLocalY(row.y);
              const txt = getTextContent(row, 40);
              console.log(`  ${sec.tagName} tr: p${rP} ly=${rLy.toFixed(1)} y=${row.y.toFixed(1)} h=${row.height.toFixed(1)} "${txt}"`);
            }
          }
        }
      }
    }
  }
  for (const c of node.children) dumpTables(c);
}
dumpTables(root);
