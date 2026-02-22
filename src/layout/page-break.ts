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

import { PAGE_H, PAGE_MARGIN } from '../constants'
import type { LayoutNode } from './layout-engine'

/** Usable content height per page (excluding top + bottom margin). */
const CONTENT_H = PAGE_H - PAGE_MARGIN * 2;

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
function pushToNextPage(child: LayoutNode): number {
  const pageIdx = Math.floor(child.y / PAGE_H);
  const target = (pageIdx + 1) * PAGE_H + PAGE_MARGIN;
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
export function applyPageFlow(root: LayoutNode): void {
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
        if (localY > PAGE_MARGIN + 2) {
          const delta = pushToNextPage(child);
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
        if (pageIdx > 0 && localY < PAGE_MARGIN - 0.5) {
          const delta = PAGE_MARGIN - localY;
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
        const footerTop = (pageIdx + 1) * PAGE_H - PAGE_MARGIN;
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
          const nearFooterThreshold = PAGE_H - 2 * PAGE_MARGIN; // ≈741.89
          const threshold =
            tag === 'tr' && child.height < CONTENT_H / 2
              ? nearFooterThreshold - child.height
              : nearFooterThreshold;

          if (localYOnPage > threshold) {
            const delta = pushToNextPage(child);
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
            const delta = pushToNextPage(child);
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
          if (startPage !== endPage) {
            const delta = pushToNextPage(child);
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
        if (localY > PAGE_MARGIN + 2) {
          const nextTop = (pageIdx + 1) * PAGE_H + PAGE_MARGIN;
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
export function applyMarginZoneCleanup(root: LayoutNode): void {
  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      // Header zone: push down to PAGE_MARGIN
      {
        const pageIdx = Math.floor(child.y / PAGE_H);
        const localY = child.y - pageIdx * PAGE_H;
        if (pageIdx > 0 && localY > 0 && localY < PAGE_MARGIN - 0.5) {
          const delta = PAGE_MARGIN - localY;
          shiftSubtree(child, delta);
          extraShift += delta;
        }
      }

      // Footer zone: conservative push — only elements near the footer
      {
        const childBottom = child.y + child.height;
        const pageIdx = Math.floor(child.y / PAGE_H);
        const footerTop = (pageIdx + 1) * PAGE_H - PAGE_MARGIN;
        const localYOnPage = child.y - pageIdx * PAGE_H;
        const tag = child.tagName || '';
        const isTableContainer =
          tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'table';
        const nearFooterThreshold = PAGE_H - 2 * PAGE_MARGIN;

        if (
          childBottom > footerTop &&
          child.height > 0 &&
          child.height <= CONTENT_H &&
          !isTableContainer &&
          localYOnPage > nearFooterThreshold
        ) {
          const delta = pushToNextPage(child);
          extraShift += delta;
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
export function applyTheadRepeatShift(root: LayoutNode): void {
  const process = (node: LayoutNode): number => {
    let extraShift = 0;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;

      // Apply accumulated shift from preceding table siblings
      if (extraShift > 0) {
        shiftSubtree(child, extraShift);
      }

      if (child.tagName === 'table') {
        const thead = child.children.find(c => c.tagName === 'thead');
        const tbody = child.children.find(c => c.tagName === 'tbody');

        if (thead && tbody && tbody.children.length > 0) {
          const theadHeight = thead.height;
          const theadOrigPage = Math.floor(thead.y / PAGE_H);
          const lastRow = tbody.children[tbody.children.length - 1]!;
          const lastRowEndPage = Math.floor(
            (lastRow.y + lastRow.height - 1) / PAGE_H,
          );

          if (lastRowEndPage > theadOrigPage) {
            // Table spans multiple pages — compute thead-repeat correction.
            // For each continuation page, the renderer pushes tbody rows
            // down by correctShift = max(0, PAGE_MARGIN + theadH - localY).
            // We find the maximum such shift and apply it to subsequent
            // siblings so they don't overlap with the shifted table rows.
            let maxCorrectShift = 0;

            for (let page = theadOrigPage + 1; page <= lastRowEndPage; page++) {
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
                PAGE_MARGIN + theadHeight - localY,
              );
              if (correctShift > maxCorrectShift) {
                maxCorrectShift = correctShift;
              }
            }

            if (maxCorrectShift > 0) {
              extraShift += maxCorrectShift;
            }
          }
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

export function applyOrphansWidows(root: LayoutNode): void {
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
              const nextPageTop = (startPage + 1) * PAGE_H + PAGE_MARGIN;
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
                const nextPageTop = (startPage + 1) * PAGE_H + PAGE_MARGIN;
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
