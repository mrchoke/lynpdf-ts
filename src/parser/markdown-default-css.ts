/**
 * Default CSS stylesheet for Markdown-generated HTML.
 *
 * Applied automatically when converting Markdown → HTML → PDF.
 * Users can override any rule via their own CSS file or `--extra-css`.
 *
 * Includes: base typography, tables, code highlight (GitHub Light theme),
 * alert containers, card boxes, color boxes, mermaid fallback.
 */
export const MARKDOWN_DEFAULT_CSS = /* css */ `
/* ── Page ─────────────────────────────────────────────── */
@page {
  margin: 2cm;
}

/* ── Base ─────────────────────────────────────────────── */
body {
  font-family: Sarabun, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: #24292f;
}

/* ── Headings ─────────────────────────────────────────── */
h1 {
  font-size: 28px;
  font-weight: bold;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 6px;
  border-bottom: 1px solid #d0d7de;
}
h2 {
  font-size: 22px;
  font-weight: bold;
  margin-top: 24px;
  margin-bottom: 16px;
  padding-bottom: 4px;
  border-bottom: 1px solid #d0d7de;
}
h3 {
  font-size: 18px;
  font-weight: bold;
  margin-top: 24px;
  margin-bottom: 16px;
}
h4 {
  font-size: 15px;
  font-weight: bold;
  margin-top: 20px;
  margin-bottom: 12px;
}

/* ── Paragraphs & inline ──────────────────────────────── */
p {
  margin-top: 0;
  margin-bottom: 12px;
}
strong, b {
  font-weight: bold;
}
em, i {
  font-style: italic;
}
a {
  color: #0969da;
  text-decoration: underline;
}

/* ── Blockquote ───────────────────────────────────────── */
blockquote {
  padding-left: 16px;
  border-left: 4px solid #d0d7de;
  color: #656d76;
  margin-top: 0;
  margin-bottom: 12px;
}

/* ── Code ─────────────────────────────────────────────── */
code {
  font-family: 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 12px;
  color: #c7254e;
}

/* ── Fenced code blocks ──────────────────────────────── */
/* The highlight function returns <pre class="code-block-wrapper">
   containing an optional <div class="code-lang-badge"> header
   and <code> with inline-styled <span>s for syntax colors. */
pre {
  font-family: 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', monospace;
  background-color: #f6f8fa;
  color: #24292e;
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid #d0d7de;
  margin-top: 0;
  margin-bottom: 14px;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.6;
}
.code-block-wrapper {
  padding: 16px 18px;
}

/* Language badge header bar */
.code-lang-badge {
  padding: 4px 14px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #57606a;
  background-color: #eaeef2;
  border-bottom: 1px solid #d0d7de;
}

/* Code inside fenced blocks */
pre code, .code-block-wrapper code {
  display: block;
  background-color: transparent;
  padding: 16px 18px;
  color: #24292e;
  font-size: 12px;
  line-height: 1.6;
  border-radius: 0;
}

/* ── Horizontal rule ──────────────────────────────────── */
/* In Markdown→PDF, --- (thematic break) acts as a page break. */
hr {
  border: none;
  border-top: 0;
  margin: 0;
  padding: 0;
  height: 0;
  page-break-after: always;
}

/* ── Lists ────────────────────────────────────────────── */
ul, ol {
  margin-top: 0;
  margin-bottom: 12px;
  padding-left: 28px;
}
li {
  margin-bottom: 4px;
}

/* ── Task list ────────────────────────────────────────── */
ul.contains-task-list {
  padding-left: 0;
}
li.task-list-item {
  margin-bottom: 4px;
}

/* ── Tables ───────────────────────────────────────────── */
table {
  border-collapse: collapse;
  margin-top: 0;
  margin-bottom: 12px;
}
th, td {
  padding: 6px 13px;
  border: 1px solid #d0d7de;
  font-size: 13px;
}
th {
  font-weight: bold;
  background-color: #f6f8fa;
}
tr:nth-child(even) {
  background-color: #f6f8fa;
}

/* ── Images ───────────────────────────────────────────── */
img {
  max-width: 100%;
}

/* ── Footnotes ────────────────────────────────────────── */
.footnotes-sep {
  border: none;
  border-top: 1px solid #d0d7de;
  margin-top: 24px;
}
.footnotes ol {
  font-size: 12px;
  color: #656d76;
}

/* ── Strikethrough ────────────────────────────────────── */
s, del {
  text-decoration: line-through;
}

/* ══════════════════════════════════════════════════════════
   Alert / Callout Containers  (:::info, :::warning, etc.)
   ══════════════════════════════════════════════════════════ */
.md-container {
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 0;
  margin-bottom: 12px;
  border-left: 4px solid #d0d7de;
  background-color: #f6f8fa;
}
.md-container-title {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 6px;
}

/* ── Info ──────────────────────────────────── */
.md-info {
  border-left-color: #0969da;
  background-color: #ddf4ff;
}
.md-info .md-container-title {
  color: #0969da;
}

/* ── Tip ──────────────────────────────────── */
.md-tip {
  border-left-color: #1a7f37;
  background-color: #dafbe1;
}
.md-tip .md-container-title {
  color: #1a7f37;
}

/* ── Note ─────────────────────────────────── */
.md-note {
  border-left-color: #0969da;
  background-color: #ddf4ff;
}
.md-note .md-container-title {
  color: #0969da;
}

/* ── Warning ──────────────────────────────── */
.md-warning {
  border-left-color: #bf8700;
  background-color: #fff8c5;
}
.md-warning .md-container-title {
  color: #9a6700;
}

/* ── Caution ──────────────────────────────── */
.md-caution {
  border-left-color: #bf8700;
  background-color: #fff8c5;
}
.md-caution .md-container-title {
  color: #9a6700;
}

/* ── Danger ───────────────────────────────── */
.md-danger {
  border-left-color: #cf222e;
  background-color: #ffebe9;
}
.md-danger .md-container-title {
  color: #cf222e;
}

/* ── Important ────────────────────────────── */
.md-important {
  border-left-color: #8250df;
  background-color: #fbefff;
}
.md-important .md-container-title {
  color: #8250df;
}

/* ══════════════════════════════════════════════════════════
   Card Container  (:::card Title)
   ══════════════════════════════════════════════════════════ */
.md-card {
  border: 1px solid #d0d7de;
  border-radius: 8px;
  padding: 16px 20px;
  margin-top: 0;
  margin-bottom: 12px;
  background-color: #ffffff;
}
.md-card-title {
  font-weight: bold;
  font-size: 16px;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #d0d7de;
}

/* ══════════════════════════════════════════════════════════
   Color Boxes  (:::box-blue Title, :::box-green, etc.)
   ══════════════════════════════════════════════════════════ */
.md-box {
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 0;
  margin-bottom: 12px;
}
.md-box-title {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 6px;
}

.md-box-blue {
  background-color: #ddf4ff;
  border: 1px solid #54aeff;
}
.md-box-blue .md-box-title { color: #0969da; }

.md-box-green {
  background-color: #dafbe1;
  border: 1px solid #4ac26b;
}
.md-box-green .md-box-title { color: #1a7f37; }

.md-box-red {
  background-color: #ffebe9;
  border: 1px solid #ff8182;
}
.md-box-red .md-box-title { color: #cf222e; }

.md-box-yellow {
  background-color: #fff8c5;
  border: 1px solid #d4a72c;
}
.md-box-yellow .md-box-title { color: #9a6700; }

.md-box-purple {
  background-color: #fbefff;
  border: 1px solid #c297ff;
}
.md-box-purple .md-box-title { color: #8250df; }

.md-box-gray {
  background-color: #f6f8fa;
  border: 1px solid #d0d7de;
}
.md-box-gray .md-box-title { color: #656d76; }

.md-box-orange {
  background-color: #fff1e5;
  border: 1px solid #fb8f44;
}
.md-box-orange .md-box-title { color: #bc4c00; }

/* ══════════════════════════════════════════════════════════
   Details / Summary Container
   ══════════════════════════════════════════════════════════ */
.md-details {
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 0;
  margin-bottom: 12px;
}
.md-details-summary {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 8px;
  cursor: pointer;
}

/* ══════════════════════════════════════════════════════════
   Mermaid Diagram — rendered SVG or fallback
   ══════════════════════════════════════════════════════════ */
.md-mermaid {
  margin-top: 0;
  margin-bottom: 12px;
  text-align: center;
}
.md-mermaid-fallback {
  border: 1px dashed #d0d7de;
  border-radius: 6px;
  padding: 12px 16px;
  margin-top: 0;
  margin-bottom: 12px;
  background-color: #f6f8fa;
}
.md-mermaid-label {
  font-weight: bold;
  font-size: 13px;
  color: #656d76;
  margin-bottom: 8px;
}
.md-mermaid-code {
  background-color: transparent;
  padding: 0;
  margin: 0;
}
.md-mermaid-code code {
  font-size: 11px;
  color: #656d76;
}

/* Mermaid source hidden when rendered */
.mermaid-block .mermaid-src {
  display: none;
}
`
