/**
 * PDF template generator for bead patterns.
 *
 * Creates a printable multi-page PDF containing a title page with color
 * legend / material list, followed by grid pages that show each bead cell
 * with its color and code.
 */

import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import { BeadPattern } from '../core/color-matcher';
import { BeadColor } from '../palettes/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfOptions {
  pageSize?: 'A4' | 'Letter';  // default A4
  boardWidth?: number;
  boardHeight?: number;
  multiBoard?: boolean;
  brand?: string;
  showLegend?: boolean;
  showMaterials?: boolean;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const PAGE_MARGIN = 40;

/** Page dimensions in points (width x height, portrait). */
const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
};

const CELL_SIZE = 14;          // pt per grid cell
const HEADER_HEIGHT = 30;      // space for page header
const GRID_FONT_SIZE = 5;      // font size for codes inside cells
const LEGEND_SWATCH_SIZE = 12; // swatch square size on the title page

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a color is perceptually "dark" (so we should use white
 * text on top of it).  Uses the W3C relative luminance formula.
 */
function isDarkColor(color: BeadColor): boolean {
  const luminance =
    0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return luminance < 128;
}

/**
 * Abbreviate a color code so it fits inside a small cell.
 * If the code is longer than `maxLen` characters, truncate and append nothing
 * (the user can refer to the legend).
 */
function abbreviateCode(code: string, maxLen: number): string {
  if (code.length <= maxLen) {
    return code;
  }
  return code.slice(0, maxLen);
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw the title page: title, summary info, color legend, material list.
 */
function drawTitlePage(
  doc: PDFKit.PDFDocument,
  pattern: BeadPattern,
  options: Required<Pick<PdfOptions, 'pageSize' | 'boardWidth' | 'boardHeight' | 'multiBoard' | 'brand'>>,
): void {
  const pageW = PAGE_SIZES[options.pageSize].width;

  // Title
  let y = PAGE_MARGIN;
  doc.fontSize(24).fillColor('#000000');
  doc.text('Bead Pattern / \u62FC\u8C46\u56FE\u7EB8', PAGE_MARGIN, y, {
    width: pageW - PAGE_MARGIN * 2,
    align: 'center',
  });
  y += 40;

  // Summary info
  doc.fontSize(11).fillColor('#333333');

  const boardCols = options.boardWidth > 0
    ? Math.ceil(pattern.width / options.boardWidth)
    : 1;
  const boardRows = options.boardHeight > 0
    ? Math.ceil(pattern.height / options.boardHeight)
    : 1;
  const boardCount = boardCols * boardRows;

  const summaryLines = [
    `Grid size: ${pattern.width} x ${pattern.height}`,
    `Total beads: ${pattern.totalBeads}`,
    `Distinct colors: ${pattern.colorCounts.size}`,
    `Board count: ${boardCount} (${boardCols} x ${boardRows})`,
    `Brand: ${options.brand || 'N/A'}`,
  ];

  for (const line of summaryLines) {
    doc.text(line, PAGE_MARGIN, y);
    y += 16;
  }

  y += 12;

  // Color legend heading
  doc.fontSize(14).fillColor('#000000');
  doc.text('Color Legend', PAGE_MARGIN, y);
  y += 22;

  // Sort colors by count descending for both legend and material list
  const sortedColors = Array.from(pattern.colorCounts.values()).sort(
    (a, b) => b.count - a.count,
  );

  const legendColumnWidth = (pageW - PAGE_MARGIN * 2) / 2;
  const startY = y;
  let col = 0;

  doc.fontSize(8);

  for (let i = 0; i < sortedColors.length; i++) {
    const entry = sortedColors[i];
    const { color, count } = entry;

    const xBase = PAGE_MARGIN + col * legendColumnWidth;

    // Swatch
    doc
      .rect(xBase, y, LEGEND_SWATCH_SIZE, LEGEND_SWATCH_SIZE)
      .fill(color.hex);

    // Code + name + count
    const textColor = '#000000';
    doc.fillColor(textColor);
    const label = `${color.code} - ${color.nameEn} (${count})`;
    doc.text(label, xBase + LEGEND_SWATCH_SIZE + 4, y + 1, {
      width: legendColumnWidth - LEGEND_SWATCH_SIZE - 8,
      lineBreak: false,
    });

    y += LEGEND_SWATCH_SIZE + 4;

    // Switch to second column or new page as needed
    const pageH = PAGE_SIZES[options.pageSize].height;
    if (y > pageH - PAGE_MARGIN - 20) {
      if (col === 0) {
        // Move to second column
        col = 1;
        y = startY;
      } else {
        // New page for remaining legend items
        doc.addPage({ size: options.pageSize });
        y = PAGE_MARGIN;
        col = 0;
      }
    }
  }

  // Material list heading (on same or new page)
  y += 20;
  const pageH = PAGE_SIZES[options.pageSize].height;
  if (y > pageH - PAGE_MARGIN - 100) {
    doc.addPage({ size: options.pageSize });
    y = PAGE_MARGIN;
  }

  doc.fontSize(14).fillColor('#000000');
  doc.text('Material List', PAGE_MARGIN, y);
  y += 22;

  // Table header
  doc.fontSize(9).fillColor('#555555');
  doc.text('Code', PAGE_MARGIN, y, { width: 60, lineBreak: false });
  doc.text('Name', PAGE_MARGIN + 65, y, { width: 160, lineBreak: false });
  doc.text('Count', PAGE_MARGIN + 230, y, { width: 60, lineBreak: false });
  y += 14;

  doc.lineWidth(0.5).strokeColor('#cccccc');
  doc.moveTo(PAGE_MARGIN, y).lineTo(pageW - PAGE_MARGIN, y).stroke();
  y += 4;

  doc.fontSize(8).fillColor('#000000');

  for (const entry of sortedColors) {
    const { color, count } = entry;

    if (y > pageH - PAGE_MARGIN - 14) {
      doc.addPage({ size: options.pageSize });
      y = PAGE_MARGIN;
    }

    doc.text(color.code, PAGE_MARGIN, y, { width: 60, lineBreak: false });
    doc.text(color.nameEn, PAGE_MARGIN + 65, y, { width: 160, lineBreak: false });
    doc.text(String(count), PAGE_MARGIN + 230, y, { width: 60, lineBreak: false });
    y += 13;
  }
}

/**
 * Draw all grid pages that tile the full bead pattern across multiple pages.
 */
function drawGridPages(
  doc: PDFKit.PDFDocument,
  pattern: BeadPattern,
  options: Required<Pick<PdfOptions, 'pageSize' | 'boardWidth' | 'boardHeight' | 'multiBoard' | 'brand'>>,
): void {
  const pageDims = PAGE_SIZES[options.pageSize];
  const usableW = pageDims.width - PAGE_MARGIN * 2;
  const usableH = pageDims.height - PAGE_MARGIN * 2 - HEADER_HEIGHT;

  // Number of cells that fit on one page
  // Reserve space on left and top for row/column numbers (~18pt)
  const numberGutter = 18;
  const cellsPerCol = Math.floor((usableH - numberGutter) / CELL_SIZE);
  const cellsPerRow = Math.floor((usableW - numberGutter) / CELL_SIZE);

  // Number of page tiles needed
  const pagesX = Math.ceil(pattern.width / cellsPerRow);
  const pagesY = Math.ceil(pattern.height / cellsPerCol);

  let pageNumber = 0;

  for (let py = 0; py < pagesY; py++) {
    for (let px = 0; px < pagesX; px++) {
      pageNumber++;
      doc.addPage({ size: options.pageSize });

      const startCol = px * cellsPerRow;
      const startRow = py * cellsPerCol;
      const endCol = Math.min(startCol + cellsPerRow, pattern.width);
      const endRow = Math.min(startRow + cellsPerCol, pattern.height);
      const numCols = endCol - startCol;
      const numRows = endRow - startRow;

      // Page header
      doc.fontSize(10).fillColor('#000000');
      const headerText =
        pagesX === 1 && pagesY === 1
          ? `Page ${pageNumber}`
          : `Page ${pageNumber} — Cols ${startCol + 1}-${endCol}, Rows ${startRow + 1}-${endRow}`;
      doc.text(headerText, PAGE_MARGIN, PAGE_MARGIN, {
        width: usableW,
        align: 'center',
      });

      // Origin for the grid drawing area (after header and number gutter)
      const gridOriginX = PAGE_MARGIN + numberGutter;
      const gridOriginY = PAGE_MARGIN + HEADER_HEIGHT + numberGutter;

      // Alignment marks at corners ("+" marks for multi-page alignment)
      if (pagesX > 1 || pagesY > 1) {
        drawAlignmentMarks(
          doc,
          gridOriginX,
          gridOriginY,
          numCols * CELL_SIZE,
          numRows * CELL_SIZE,
        );
      }

      // Column numbers along top
      doc.fontSize(5).fillColor('#666666');
      for (let c = 0; c < numCols; c++) {
        const colNum = startCol + c + 1;
        const cx = gridOriginX + c * CELL_SIZE;
        doc.text(String(colNum), cx, gridOriginY - numberGutter + 4, {
          width: CELL_SIZE,
          align: 'center',
          lineBreak: false,
        });
      }

      // Row numbers along left
      for (let r = 0; r < numRows; r++) {
        const rowNum = startRow + r + 1;
        const ry = gridOriginY + r * CELL_SIZE;
        doc.text(String(rowNum), PAGE_MARGIN, ry + 2, {
          width: numberGutter - 2,
          align: 'right',
          lineBreak: false,
        });
      }

      // Draw colored cells
      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const beadColor = pattern.grid[startRow + r][startCol + c];
          const cx = gridOriginX + c * CELL_SIZE;
          const cy = gridOriginY + r * CELL_SIZE;

          // Fill cell with bead color
          doc.rect(cx, cy, CELL_SIZE, CELL_SIZE).fill(beadColor.hex);

          // Print color code inside cell
          const textColor = isDarkColor(beadColor) ? '#FFFFFF' : '#000000';
          doc.fontSize(GRID_FONT_SIZE).fillColor(textColor);
          const abbrev = abbreviateCode(beadColor.code, 3);
          doc.text(abbrev, cx, cy + (CELL_SIZE - GRID_FONT_SIZE) / 2, {
            width: CELL_SIZE,
            align: 'center',
            lineBreak: false,
          });
        }
      }

      // Draw grid lines
      doc.lineWidth(0.25).strokeColor('#888888');

      // Vertical lines
      for (let c = 0; c <= numCols; c++) {
        const lx = gridOriginX + c * CELL_SIZE;
        doc
          .moveTo(lx, gridOriginY)
          .lineTo(lx, gridOriginY + numRows * CELL_SIZE)
          .stroke();
      }

      // Horizontal lines
      for (let r = 0; r <= numRows; r++) {
        const ly = gridOriginY + r * CELL_SIZE;
        doc
          .moveTo(gridOriginX, ly)
          .lineTo(gridOriginX + numCols * CELL_SIZE, ly)
          .stroke();
      }
    }
  }
}

/**
 * Draw "+" alignment marks at the four corners and midpoints of the edges
 * of the grid area.  These help when taping multi-page printouts together.
 */
function drawAlignmentMarks(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const markLen = 6;

  doc.save();
  doc.lineWidth(0.5).strokeColor('#000000');

  const points: Array<{ cx: number; cy: number }> = [
    // Corners
    { cx: x, cy: y },
    { cx: x + w, cy: y },
    { cx: x, cy: y + h },
    { cx: x + w, cy: y + h },
    // Edge midpoints
    { cx: x + w / 2, cy: y },
    { cx: x + w / 2, cy: y + h },
    { cx: x, cy: y + h / 2 },
    { cx: x + w, cy: y + h / 2 },
  ];

  for (const pt of points) {
    // Horizontal stroke
    doc
      .moveTo(pt.cx - markLen, pt.cy)
      .lineTo(pt.cx + markLen, pt.cy)
      .stroke();
    // Vertical stroke
    doc
      .moveTo(pt.cx, pt.cy - markLen)
      .lineTo(pt.cx, pt.cy + markLen)
      .stroke();
  }

  doc.restore();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a bead pattern to a multi-page printable PDF.
 *
 * The PDF contains:
 *   1. A title page with summary info, color legend, and material list.
 *   2. One or more grid pages that tile the full pattern, with colored cells,
 *      codes, grid lines, row/column numbers, and alignment marks.
 *
 * @param pattern    The matched bead pattern to render.
 * @param outputPath Filesystem path for the output PDF file.
 * @param options    Optional rendering / layout options.
 */
export async function renderPdfTemplate(
  pattern: BeadPattern,
  outputPath: string,
  options?: PdfOptions,
): Promise<void> {
  const pageSize = options?.pageSize ?? 'A4';
  const boardWidth = options?.boardWidth ?? 0;
  const boardHeight = options?.boardHeight ?? 0;
  const multiBoard = options?.multiBoard ?? false;
  const brand = options?.brand ?? '';

  const resolvedOptions = { pageSize, boardWidth, boardHeight, multiBoard, brand } as const;
  const showLegend = options?.showLegend !== false;
  const showMaterials = options?.showMaterials !== false;

  const doc = new PDFDocument({
    size: pageSize,
    margin: PAGE_MARGIN,
    autoFirstPage: true,
    info: {
      Title: 'Bead Pattern',
      Author: 'pixelbead',
      Subject: `${pattern.width}x${pattern.height} bead pattern`,
    },
  });

  return new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outputPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    // 1. Title page (uses the auto-created first page)
    if (showLegend || showMaterials) {
      drawTitlePage(doc, pattern, resolvedOptions);
    }

    // 2. Grid pages
    drawGridPages(doc, pattern, resolvedOptions);

    doc.end();
  });
}
