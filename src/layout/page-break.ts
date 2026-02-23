/**
 * Post-layout passes for CSS paged-media rules.
 *
 * After Yoga calculates the continuous layout, these passes walk the tree
 * and shift nodes so they conform to page boundaries and margin zones.
 *
 *   1. applyPageFlow — comprehensive page flow:
 *        • page-break-before / page-break-after
 *        • page margin enforcement (header / footer zones)
 *        • implicit break-inside for table rows
 *        • explicit page-break-inside: avoid
 *   2. applyOrphansWidows — orphans / widows
 *   3. applyTheadRepeatShift — thead repeat adjustment
 */

import { PAGE_H, PAGE_MARGIN } from '../constants';
import type { LayoutNode } from './layout-engine';

/**
 * Shift a layout node (and all descendants) by a Y delta.
 */
function shiftSubtree(node: LayoutNode, deltaY: number): void {
  node.y += deltaY;
  for (const child of node.children) {
    shiftSubtree(child, deltaY);
  }
}

/**
 * Helper: push a child to the content start of the next page.
 * Returns the delta applied (0 if no push was needed).
 */
function pushToNextPage(child: LayoutNode, margin: number): number {
  const pageIdx = Math.floor(child.y / PAGE_H);
  const target = (pageIdx + 1) * PAGE_H + margin;
  const delta = target - child.y;
  if (delta > 0) {
    shiftSubtree(child, delta);
  }
  return Math.max(0, delta);
}

/**
 * Comprehensive page-flow pass.
 *
 * Walks the layout tree depth-first and adjusts node positions so that:
 *
 *  1. **page-break-before: always** — forces content to the next page.
 *  2. **Header zone avoidance** — nodes that land in the top margin
 *     area [0, PAGE_MARGIN) of a page are pushed down to PAGE_MARGIN.
 *  3. **Footer zone avoidance** — nodes whose bottom edge enters the
 *     footer margin area [PAGE_H − PAGE_MARGIN, PAGE_H) are pushed to
 *     the next page (when the node fits within CONTENT_H).
 *  4. **Table row integrity** — `<tr>` elements that straddle a page
 *     boundary are pushed to the next page (implicit break-inside).
 *  5. **Explicit break-inside: avoid** — honours the CSS property.
 *  6. **page-break-after: always** — forces the *next* sibling to a
 *     new page.
 *
 * Each push cascades to all subsequent siblings via `extraShift`.
 */
export function applyPageFlow(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const CONTENT_H = PAGE_H - pageMargin * 2;
  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // Apply accumulated shift from previous sibling pushes
      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      // ── 1. page-break-before: always ────────────────────────
      const breakBefore =
        child.styles['page-break-before'] || child.styles['break-before'];
      if (breakBefore === 'always' || breakBefore === 'page') {
        const pageIdx = Math.floor(child.y / PAGE_H);
        const localY = child.y - pageIdx * PAGE_H;
        // Push to the next page unless already at (or near) the
        // content start of the current page.
        if (localY > pageMargin + 2) {
          const delta = pushToNextPage(child, pageMargin);
          extraShift += delta;
        }
      }

      // ── 2. Header zone avoidance ────────────────────────────
      // After shifts, a node may sit in the header zone (localY < PAGE_MARGIN).
      // Push it down to the content start of the same page.
      // Note: we also catch localY === 0 (exact page boundary) — removing the
      // `localY > 0` guard fixes rows landing at the very top of a page.
      {
        const pageIdx = Math.floor(child.y / PAGE_H);
        const localY = child.y - pageIdx * PAGE_H;
        if (pageIdx > 0 && localY < pageMargin - 0.5) {
          const delta = pageMargin - localY;
          shiftSubtree(child, delta);
          extraShift += delta;
        }
      }

      // ── 3. Footer zone avoidance ────────────────────────────
      // Push a node to the next page if its bottom edge enters the footer
      // margin zone AND its top is near the footer zone.
      //
      // We only push elements whose TOP starts near the footer zone to
      // avoid wastefully pushing large elements that barely touch it.
      //
      // For <tr> (short rows): use a lower threshold so rows like
      // Laksaman near the bottom of a page get pushed before the
      // footer overlay hides them.
      //
      // Table containers (table, tbody, thead, tfoot) are excluded
      // — their children handle page flow via recursion.
      {
        const childBottom = child.y + child.height;
        const pageIdx = Math.floor(child.y / PAGE_H);
        const footerTop = (pageIdx + 1) * PAGE_H - pageMargin;
        const localYOnPage = child.y - pageIdx * PAGE_H;
        const tag = child.tagName || '';
        const isTableContainer =
          tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'table';

        if (
          childBottom > footerTop &&
          child.height > 0 &&
          child.height <= CONTENT_H &&
          !isTableContainer
        ) {
          // For short <tr>: lower the threshold by the row's own height
          // so rows near the bottom of the page are caught.
          // For other elements: use the standard threshold.
          const nearFooterThreshold = PAGE_H - 2 * pageMargin;
          const threshold =
            tag === 'tr' && child.height < CONTENT_H / 2
              ? nearFooterThreshold - child.height
              : nearFooterThreshold;

          if (localYOnPage > threshold) {
            const delta = pushToNextPage(child, pageMargin);
            extraShift += delta;
          }
        }
      }

      // ── 4. Table row / section integrity ─────────────────────
      // <tr>, <thead>, <tfoot> elements must not be split across pages.
      {
        const tag = child.tagName || '';
        const isUnsplittable = tag === 'tr' || tag === 'thead' || tag === 'tfoot';
        if (
          isUnsplittable &&
          child.height > 0 &&
          child.height <= CONTENT_H
        ) {
          const startPage = Math.floor(child.y / PAGE_H);
          const endPage = Math.floor((child.y + child.height - 1) / PAGE_H);
          if (startPage !== endPage) {
            const delta = pushToNextPage(child, pageMargin);
            extraShift += delta;
          }
        }
      }

      // ── 5. Explicit break-inside: avoid ─────────────────────
      {
        const breakInside =
          child.styles['page-break-inside'] || child.styles['break-inside'];
        if (breakInside === 'avoid' && child.height > 0 && child.height < CONTENT_H) {
          const startPage = Math.floor(child.y / PAGE_H);
          const endPage = Math.floor((child.y + child.height - 1) / PAGE_H);
          // Also push when the element fits on one page but its bottom edge
          // falls inside the footer margin zone — the engine would otherwise
          // believe there is enough room (startPage === endPage) while the
          // content is actually hidden beneath the footer margin.
          const pageIdx = Math.floor(child.y / PAGE_H);
          const footerTop = (pageIdx + 1) * PAGE_H - pageMargin;
          const bottomInFooter = child.y + child.height > footerTop;
          if (startPage !== endPage || bottomInFooter) {
            const delta = pushToNextPage(child, pageMargin);
            extraShift += delta;
          }
        }
      }

      // ── 6. page-break-after: always ─────────────────────────
      const breakAfter =
        child.styles['page-break-after'] || child.styles['break-after'];
      if (breakAfter === 'always' || breakAfter === 'page') {
        const childBottom = child.y + child.height;
        const pageIdx = Math.floor(childBottom / PAGE_H);
        const localY = childBottom - pageIdx * PAGE_H;
        if (localY > pageMargin + 2) {
          const nextTop = (pageIdx + 1) * PAGE_H + pageMargin;
          const additionalShift = nextTop - childBottom;
          if (additionalShift > 0) {
            extraShift += additionalShift;
          }
        }
      }

      // Update thead context is no longer needed — footer zone avoidance
      // uses a threshold approach instead of tracking thead height.

      // Recurse into children (may cause further shifts)
      const childExtra = process(child);
      extraShift += childExtra;
    }

    return extraShift;
  };

  process(root);
}

/** @deprecated Use applyPageFlow instead */
export function applyPageBreakInside(root: LayoutNode): void {
  // Kept for backward compatibility — applyPageFlow now handles this.
  applyPageFlow(root);
}

// ─── Lightweight margin zone cleanup ───────────────────────────────

/**
 * Lightweight post-pass that ONLY fixes header / footer zone violations.
 *
 * This runs AFTER applyTheadRepeatShift (and applyOrphansWidows) to catch
 * elements that were shifted into the header or footer zone by those passes.
 *
 * Unlike applyPageFlow, this does NOT apply:
 *   - page-break-before / page-break-after
 *   - break-inside: avoid
 *   - thead-aware effective-bottom (not needed here)
 *   - table row / section integrity
 *
 * It simply ensures no small element overlaps the header or footer margin.
 */
export function applyMarginZoneCleanup(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const CONTENT_H = PAGE_H - pageMargin * 2;

  // Tags whose internal layout is managed by applyPageFlow (table-aware logic).
  // We must NOT push their children or recurse into them here — doing so creates
  // cascading extraShift that produces phantom gaps between table rows.
  const TABLE_TAGS = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ]);

  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      const tag = child.tagName || '';
      const isTableElement = TABLE_TAGS.has(tag);

      // Header zone: push down to pageMargin (skip table internals)
      if (!isTableElement) {
        const pageIdx = Math.floor(child.y / PAGE_H);
        const localY = child.y - pageIdx * PAGE_H;
        if (pageIdx > 0 && localY > 0 && localY < pageMargin - 0.5) {
          const delta = pageMargin - localY;
          shiftSubtree(child, delta);
          extraShift += delta;
        }
      }

      // Footer zone: conservative push — only non-table elements near the footer
      if (!isTableElement) {
        const childBottom = child.y + child.height;
        const pageIdx = Math.floor(child.y / PAGE_H);
        const footerTop = (pageIdx + 1) * PAGE_H - pageMargin;
        const localYOnPage = child.y - pageIdx * PAGE_H;
        const nearFooterThreshold = PAGE_H - 2 * pageMargin;

        if (
          childBottom > footerTop &&
          child.height > 0 &&
          child.height <= CONTENT_H &&
          localYOnPage > nearFooterThreshold
        ) {
          const delta = pushToNextPage(child, pageMargin);
          extraShift += delta;
        }
      }

      // Recurse into children — but NOT into table structures.
      // Table internal layout (row positions, page breaks) is fully handled
      // by applyPageFlow; recursing here would produce double-shifts.
      if (!isTableElement) {
        const childExtra = process(child);
        extraShift += childExtra;
      }
    }

    return extraShift;
  };

  process(root);
}

// ─── Table Row Gap Compaction ──────────────────────────────────────

/**
 * After applyPageFlow and applyTheadRepeatShift, consecutive table rows
 * may have gaps between them ON THE SAME PAGE.  This happens when:
 *
 *   1. applyPageFlow pushes a row from page N to page N+1 (footer avoidance)
 *   2. applyTheadRepeatShift shifts the table down
 *   3. The pushed row and its predecessor now both sit on page N+1
 *      but their absolute positions still reflect the old page break
 *
 * This pass walks every tbody / thead / tfoot and compacts any within-page
 * gaps between consecutive rows.
 *
 * IMPORTANT: compaction is purely LOCAL — it is NOT propagated to siblings
 * outside the table section.  Propagating negative shifts would cascade
 * across the entire document, pulling subsequent content into header zones.
 * The trade-off is some empty space at the bottom of compacted tables,
 * which is far less visible than displaced content.
 */
export function compactTableRowGaps(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const visit = (node: LayoutNode) => {
    if (
      node.tagName === 'tbody' ||
      node.tagName === 'thead' ||
      node.tagName === 'tfoot'
    ) {
      let compaction = 0;

      for (let r = 0; r < node.children.length; r++) {
        const row = node.children[r]!;
        if (row.tagName !== 'tr') continue;

        if (compaction < 0) {
          shiftSubtree(row, compaction);
        }

        // Look ahead: is the next tr on the same page with a gap?
        if (r + 1 < node.children.length) {
          const next = node.children[r + 1]!;
          if (next.tagName !== 'tr') continue;

          const nextY = next.y + compaction;
          const rowEnd = row.y + row.height;
          const rowPage = Math.floor(row.y / PAGE_H);
          const nextPage = Math.floor(nextY / PAGE_H);

          if (rowPage === nextPage) {
            const gap = nextY - rowEnd;
            if (gap > 1) {
              compaction -= gap;
            }
          }
        }
      }
      // Compaction stays local — NOT returned to parent
      return;
    }

    // Recurse for non-table-section nodes to find nested tables
    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
}

// ─── Table Row Position Enforcement ────────────────────────────────

/**
 * Final cleanup for table rows: fix header-zone violations and rows
 * that straddle page boundaries.
 *
 * After applyTheadRepeatShift shifts entire tables, some rows may end up:
 *   - In the header zone (localY < pageMargin)
 *   - Straddling a page boundary (start and end on different pages)
 *
 * This pass walks each tbody/thead/tfoot, fixes rows within it, and
 * cascades shifts to subsequent sibling rows — but NEVER propagates
 * beyond the table section container.
 */
export function fixTableRowPositions(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const CONTENT_H = PAGE_H - pageMargin * 2;

  const visit = (node: LayoutNode) => {
    if (
      node.tagName === 'tbody' ||
      node.tagName === 'thead' ||
      node.tagName === 'tfoot'
    ) {
      let extraShift = 0;

      for (const row of node.children) {
        if (row.tagName !== 'tr') continue;

        if (extraShift > 0) {
          shiftSubtree(row, extraShift);
        }

        // Header zone: push down to pageMargin
        const pageIdx = Math.floor(row.y / PAGE_H);
        const localY = row.y - pageIdx * PAGE_H;
        if (pageIdx > 0 && localY > 0 && localY < pageMargin - 0.5) {
          const delta = pageMargin - localY;
          shiftSubtree(row, delta);
          extraShift += delta;
        }

        // Row integrity: don't let a row straddle pages
        if (row.height > 0 && row.height <= CONTENT_H) {
          const startPage = Math.floor(row.y / PAGE_H);
          const endPage = Math.floor((row.y + row.height - 1) / PAGE_H);
          if (startPage !== endPage) {
            const delta = pushToNextPage(row, pageMargin);
            extraShift += delta;
          }
        }
      }
      // Shifts stay local — NOT propagated beyond the section
      return;
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
}

// ─── Sibling Gap Compaction ────────────────────────────────────────

/**
 * Return the deepest visual bottom of a node (max of all descendant y+h).
 * Unlike node.height (which is the Yoga container height and may be stale
 * after row pushes), this reflects where content ACTUALLY ends.
 */
function actualBottom(node: LayoutNode): number {
  let b = node.y + node.height;
  for (const child of node.children) {
    b = Math.max(b, actualBottom(child));
  }
  return b;
}

/**
 * Final compaction pass: close same-page gaps between non-table siblings.
 *
 * **Why this is needed:**
 *
 * applyPageFlow pushes elements that straddle the footer zone to the next
 * page.  The push delta is added to extraShift, so subsequent siblings
 * receive additional shift.  When applyTheadRepeatShift then shifts
 * everything further forward, elements that were on *different* pages
 * may end up on the *same* page — but with a stale page-break gap
 * between them (100–150 pt of blank white space).
 *
 * This pass walks every non-table container and, for each pair of
 * consecutive same-page children, removes excess gap beyond the
 * expected CSS margin.  It cascades the compaction to all subsequent
 * siblings (like compactTableRowGaps) but does NOT cross page
 * boundaries or pull elements from one page to another.
 */
export function compactSiblingGaps(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const TABLE_TAGS = new Set([
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  ]);

  const process = (node: LayoutNode) => {
    const tag = node.tagName || '';

    // Don't touch table internals — handled by compactTableRowGaps
    if (TABLE_TAGS.has(tag)) return;

    let compaction = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // Apply pending compaction — but NEVER pull an element across a page
      // boundary backward (from page N to page N-1).
      if (compaction < 0) {
        const origPage = Math.floor(child.y / PAGE_H);
        const newY = child.y + compaction;
        const newPage = Math.floor(newY / PAGE_H);

        if (newPage < origPage) {
          // Compaction would cross a page boundary.
          // Limit: at most move the child to the content start of its
          // current page (pageMargin), preserving the page break.
          const pageTop = origPage * PAGE_H + pageMargin;
          const limitedShift = pageTop - child.y;
          if (limitedShift < -0.5) {
            shiftSubtree(child, limitedShift);
            compaction = limitedShift; // reset cascade to this reduced amount
          } else {
            // Already at or past the content start — skip compaction entirely
            compaction = 0;
          }
        } else {
          shiftSubtree(child, compaction);
          // Ensure we don't land in the header zone after compaction
          const localY = child.y - Math.floor(child.y / PAGE_H) * PAGE_H;
          if (Math.floor(child.y / PAGE_H) > 0 && localY < pageMargin - 0.5) {
            const fix = pageMargin - localY;
            shiftSubtree(child, fix);
            compaction += fix; // reduce compaction magnitude
          }
        }
      }

      // Look ahead: gap to next sibling on same page?
      if (i + 1 < node.children.length) {
        const next = node.children[i + 1]!;
        const nextY = next.y + compaction; // where next will land after compaction

        // Compute actual visual bottom (including pushed descendants)
        const childActBottom = actualBottom(child);

        const bottomPage = Math.floor(childActBottom / PAGE_H);
        const nextPage = Math.floor(nextY / PAGE_H);

        if (bottomPage === nextPage) {
          const gap = nextY - childActBottom;

          // Expected gap from CSS margins
          const prevMB = parseFloat(child.styles['margin-bottom'] || '0') || 0;
          const nextMT = parseFloat(next.styles['margin-top'] || '0') || 0;
          let expectedGap = prevMB + nextMT;

          // For multi-page tables with thead, the renderer shifts tbody
          // rows on continuation pages by theadHeight.  The layout's
          // applyTheadRepeatShift accounts for this by shifting
          // siblings, but that produces a "gap" from the layout's
          // perspective.  We must NOT compact this renderer-needed gap.
          if (child.tagName === 'table') {
            const thead = child.children.find((c: LayoutNode) => c.tagName === 'thead');
            const tbody = child.children.find((c: LayoutNode) => c.tagName === 'tbody');
            if (thead && tbody) {
              const tableStartPage = Math.floor(child.y / PAGE_H);
              const tableEndPage = Math.floor(childActBottom / PAGE_H);
              if (tableEndPage > tableStartPage) {
                expectedGap += thead.height;
              }
            }
          }

          // Add a small tolerance; the CSS margin parsing may be slightly off
          const maxGap = Math.max(expectedGap + 5, 20);

          if (gap > maxGap) {
            const excess = gap - maxGap;

            // Safety: shifted element must stay on the same page AND
            // not land in the header zone
            const newNextY = nextY - excess;
            const newNextPage = Math.floor(newNextY / PAGE_H);
            const newLocalY = newNextY - newNextPage * PAGE_H;
            if (newNextPage === bottomPage && newLocalY >= pageMargin - 0.5) {
              compaction -= excess;
            }
          }
        }
      }
    }

    // Recurse into non-table children
    for (const child of node.children) {
      process(child);
    }
  };

  process(root);
}

// ─── Orphans / Widows ──────────────────────────────────────────────

/**
 * Estimate the number of visual text lines in a block element.
 * Uses the total height of text-node children divided by the per-line
 * height derived from font-size + line-height.
 */
function estimateLineCount(block: LayoutNode): { lineCount: number; lineH: number } {
  // Collect all text children (may be nested inside intermediate nodes)
  let totalTextH = 0;
  let fontSize = 16;
  let lineHeightMultiplier = 1.3; // match NATURAL_LH default

  const collectText = (n: LayoutNode) => {
    if (n.type === 'text') {
      totalTextH += n.height;
      const fs = parseInt(n.styles['font-size'] || '16', 10);
      if (fs > 0) fontSize = fs;
      const lhRaw = n.styles['line-height'];
      if (lhRaw) {
        const v = parseFloat(lhRaw);
        if (!isNaN(v)) {
          lineHeightMultiplier = lhRaw.endsWith('px') ? v / fontSize : v;
        }
      }
    }
    for (const c of n.children) collectText(c);
  };
  collectText(block);

  const lineH = fontSize * Math.max(lineHeightMultiplier, 1.0);
  const lineCount = lineH > 0 ? Math.max(1, Math.round(totalTextH / lineH)) : 1;
  return { lineCount, lineH };
}

/**
 * Apply CSS orphans/widows rules to the layout tree.
 *
 * For each block element that has `orphans` or `widows` set and straddles
 * a page boundary, adjust its Y position so that:
 *   - At least `orphans` lines remain on the first page (default: 2)
 *   - At least `widows` lines appear on the second page (default: 2)
 *
 * If both constraints cannot be satisfied simultaneously (block too short),
 * the block is pushed entirely to the next page.
 */
/**
 * Apply cumulative shift to subsequent siblings of tables whose thead
 * headers will be repeated on continuation pages.
 *
 * When a table spans multiple pages the renderer repeats the thead at
 * the top of each continuation page and shifts tbody rows down to make
 * room.  This post-layout pass shifts all siblings that follow such a
 * table by the same correction amount so they don't overlap with the
 * shifted table content.
 */
export function applyTheadRepeatShift(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // ── Reset shift at page-break boundaries ──────────────
      // A page-break-before: always forces a fresh page context.
      // Thead-repeat shifts from previous multi-page tables must NOT
      // cascade across forced page breaks — the content after the break
      // is on a new page and unrelated to the prior table layout.
      const breakBefore =
        child.styles['page-break-before'] || child.styles['break-before'];
      if ((breakBefore === 'always' || breakBefore === 'page') && extraShift > 0) {
        extraShift = 0;
      }

      // Apply accumulated shift from preceding table siblings
      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      if (child.tagName === 'table') {
        const thead = child.children.find(c => c.tagName === 'thead');
        const tbody = child.children.find(c => c.tagName === 'tbody');

        if (thead && tbody && tbody.children.length > 0) {
          // Check CSS opt-out: -lynpdf-repeat: none on thead or table
          const theadRepeat = thead.styles['-lynpdf-repeat'] || child.styles['-lynpdf-repeat'];
          if (theadRepeat === 'none') {
            // Skip thead-repeat shift entirely
          } else {

          const theadHeight = thead.height;
          // Use actual thead row positions to determine which pages
          // already contain thead content (container .y may be stale
          // after applyPageFlow shifts individual TRs).
          const theadRows = thead.children.filter(c => c.tagName === 'tr');
          const theadContentPages = new Set<number>(
            theadRows.map(r => Math.floor(r.y / PAGE_H)),
          );
          const lastRow = tbody.children[tbody.children.length - 1]!;
          const lastRowEndPage = Math.floor(
            (lastRow.y + lastRow.height - 1) / PAGE_H,
          );

          // Find pages where tbody rows exist but thead content doesn't
          const tbodyPages = new Set<number>(
            tbody.children.map(r => Math.floor(r.y / PAGE_H)),
          );
          const needsRepeatOnAnyPage = [...tbodyPages].some(
            p => !theadContentPages.has(p),
          );

          if (needsRepeatOnAnyPage) {
            // Table spans multiple pages — compute thead-repeat correction.
            // For each continuation page, the renderer pushes tbody rows
            // down by correctShift = max(0, PAGE_MARGIN + theadH - localY).
            // We find the maximum such shift and apply it to subsequent
            // siblings so they don't overlap with the shifted table rows.
            let maxCorrectShift = 0;

            // Only process pages that don't already have thead content
            const minTbodyPage = Math.min(...[...tbodyPages]);
            const maxTbodyPage = Math.max(...[...tbodyPages]);
            for (let page = minTbodyPage; page <= maxTbodyPage; page++) {
              // Skip pages where thead content already exists
              if (theadContentPages.has(page)) continue;

              const rowsOnPage = tbody.children.filter(
                r => Math.floor(r.y / PAGE_H) === page,
              );
              if (rowsOnPage.length === 0) continue;

              // Mirror the renderer's logic: skip thead repeat when only
              // the very last tbody row sits alone on a continuation page.
              const isOnlyLastRow =
                rowsOnPage.length === 1 &&
                rowsOnPage[0] === tbody.children[tbody.children.length - 1];
              if (isOnlyLastRow) continue;

              const firstRow = rowsOnPage[0]!;
              const localY = firstRow.y - page * PAGE_H;
              const correctShift = Math.max(
                0,
                pageMargin + theadHeight - localY,
              );
              if (correctShift > maxCorrectShift) {
                maxCorrectShift = correctShift;
              }
            }

            if (maxCorrectShift > 0) {
              extraShift += maxCorrectShift;

              // The renderer also shifts ALL tbody rows on continuation
              // pages by the same correctShift.  This means the table's
              // VISUAL bottom in the rendered PDF extends beyond the
              // layout's actualBottom by maxCorrectShift.  If the next
              // sibling (after the extraShift is applied) would overlap
              // with this renderer-adjusted bottom, add extra shift.
              const tableActBot = actualBottom(child);
              const rendererVisualBot = tableActBot + maxCorrectShift;
              if (i + 1 < node.children.length) {
                const nextSib = node.children[i + 1]!;
                const nextSibPredY = nextSib.y + extraShift;
                if (nextSibPredY < rendererVisualBot) {
                  const overlap = rendererVisualBot - nextSibPredY;
                  extraShift += overlap;
                }
              }
            }
          }
          } // end of theadRepeat !== 'none'
        }
      }

      // Recurse into children (shifts from deeper tables propagate up)
      const childExtra = process(child);
      extraShift += childExtra;
    }

    return extraShift;
  };

  process(root);
}

export function applyOrphansWidows(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const CONTENT_H = PAGE_H - pageMargin * 2;
  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      // Only process block elements with orphans or widows styles
      const orphansVal = parseInt(child.styles['orphans'] || '0', 10);
      const widowsVal = parseInt(child.styles['widows'] || '0', 10);

      if ((orphansVal > 0 || widowsVal > 0) && child.height > 0) {
        const orphans = orphansVal || 2; // CSS default
        const widows = widowsVal || 2;   // CSS default

        const startPage = Math.floor(child.y / PAGE_H);
        const endPage = Math.floor((child.y + child.height - 1) / PAGE_H);

        if (startPage !== endPage) {
          // Block straddles a page boundary
          const { lineCount, lineH } = estimateLineCount(child);

          if (lineCount <= 1) {
            // Single-line block — nothing to split
          } else if (lineCount < orphans + widows) {
            // Too few lines to satisfy both constraints → push to next page
            if (child.height < CONTENT_H) {
              const nextPageTop = (startPage + 1) * PAGE_H + pageMargin;
              const delta = nextPageTop - child.y;
              shiftSubtree(child, delta);
              extraShift += delta;
            }
          } else {
            // Calculate how many lines are on the first page
            const pageBreakY = (startPage + 1) * PAGE_H;
            const blockLocalBreak = pageBreakY - child.y;
            const linesBeforeBreak = Math.floor(blockLocalBreak / lineH);
            const linesAfterBreak = lineCount - linesBeforeBreak;

            if (linesBeforeBreak < orphans) {
              // Too few lines before the break (orphan violation)
              // Push entire block to next page
              if (child.height < CONTENT_H) {
                const nextPageTop = (startPage + 1) * PAGE_H + pageMargin;
                const delta = nextPageTop - child.y;
                shiftSubtree(child, delta);
                extraShift += delta;
              }
            } else if (linesAfterBreak < widows) {
              // Too few lines after the break (widow violation)
              // Push block down so that exactly `widows` lines land on page 2.
              // That means (lineCount - widows) lines stay on page 1.
              const linesOnFirstPage = lineCount - widows;
              const idealY = pageBreakY - linesOnFirstPage * lineH;
              // Only push downward (never upward)
              if (idealY > child.y) {
                const delta = idealY - child.y;
                shiftSubtree(child, delta);
                extraShift += delta;
              }
            }
          }
        }
      }

      // Recurse into children
      const childExtra = process(child);
      extraShift += childExtra;
    }

    return extraShift;
  };

  process(root);
}

// ─── Page Break Anchoring ──────────────────────────────────────────

/**
 * Final safety pass: ensure elements with `page-break-before: always`
 * (or `break-before: page`) sit at exactly `pageMargin` (localY) on
 * their current page.
 *
 * Various passes (thead-repeat, orphans/widows, margin-zone cleanup)
 * can push these elements DOWN from their intended position.  This pass
 * detects the drift and shifts the element — and all subsequent
 * siblings — back UP to the content start of the page.
 *
 * This pass is non-recursive: it only processes direct children of each
 * container (matching the structure that applyPageFlow uses).
 */
export function anchorPageBreaks(root: LayoutNode, pageMargin: number = PAGE_MARGIN): void {
  const process = (node: LayoutNode) => {
    let compaction = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // Apply pending compaction
      if (compaction < 0) {
        shiftSubtree(child, compaction);
      }

      const breakBefore =
        child.styles['page-break-before'] || child.styles['break-before'];
      if (breakBefore === 'always' || breakBefore === 'page') {
        const pageIdx = Math.floor(child.y / PAGE_H);
        const localY = child.y - pageIdx * PAGE_H;
        if (pageIdx > 0 && localY > pageMargin + 1) {
          const drift = localY - pageMargin;
          shiftSubtree(child, -drift);
          compaction = -drift;
        }
      }
    }

    // Recurse into children
    for (const child of node.children) {
      process(child);
    }
  };

  process(root);
}
