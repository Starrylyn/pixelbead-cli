/**
 * PNG grid renderer for bead patterns.
 *
 * Renders a BeadPattern as a PNG image with colored grid cells, color codes,
 * legend, and material list using @napi-rs/canvas.
 */

import { createCanvas, Canvas, SKRSContext2D } from '@napi-rs/canvas';
import { BeadPattern } from '../core/color-matcher';
import { BeadColor } from '../palettes/types';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PngGridOptions {
  cellSize?: number;       // default 24
  showCodes?: boolean;     // default true
  showLegend?: boolean;    // default true
  showMaterials?: boolean; // default true
  showNumbers?: boolean;   // default true — row/col coordinate numbers
  boardWidth?: number;     // for board boundary markers
  boardHeight?: number;
  multiBoard?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine a contrasting text color (black or white) based on perceived
 * brightness of the given RGB background color.
 */
export function getContrastColor(r: number, g: number, b: number): string {
  const brightness = r * 0.299 + g * 0.587 + b * 0.114;
  return brightness > 150 ? '#000000' : '#ffffff';
}

/**
 * Convert an RGB triplet to a CSS hex color string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Draw a checkerboard transparency pattern in the given rectangle.
 */
function drawCheckerboard(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  squareSize: number,
): void {
  const cols = Math.ceil(width / squareSize);
  const rows = Math.ceil(height / squareSize);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const isLight = (row + col) % 2 === 0;
      ctx.fillStyle = isLight ? '#eeeeee' : '#cccccc';
      const sx = x + col * squareSize;
      const sy = y + row * squareSize;
      const sw = Math.min(squareSize, x + width - sx);
      const sh = Math.min(squareSize, y + height - sy);
      ctx.fillRect(sx, sy, sw, sh);
    }
  }
}

// ---------------------------------------------------------------------------
// Layout calculation
// ---------------------------------------------------------------------------

interface LayoutMetrics {
  margin: number;
  numberGutter: number;
  gridOriginX: number;
  gridOriginY: number;
  gridPixelWidth: number;
  gridPixelHeight: number;
  legendX: number;
  legendWidth: number;
  legendEntries: { color: BeadColor; count: number }[];
  legendHeight: number;
  materialsY: number;
  materialsHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

function computeLayout(
  pattern: BeadPattern,
  cellSize: number,
  showLegend: boolean,
  showMaterials: boolean,
  showNumbers: boolean,
): LayoutMetrics {
  const margin = 20;
  const numberGutter = showNumbers ? 30 : 0; // space for row/col numbers

  const gridPixelWidth = pattern.width * cellSize;
  const gridPixelHeight = pattern.height * cellSize;

  const gridOriginX = margin + numberGutter;
  const gridOriginY = margin + numberGutter;

  // Legend
  const legendEntries = Array.from(pattern.colorCounts.values())
    .sort((a, b) => b.count - a.count);

  const legendLineHeight = 24;
  const legendTitleHeight = 28;
  const legendWidth = showLegend ? 220 : 0;
  const legendGap = showLegend ? 20 : 0;
  const legendHeight = showLegend
    ? legendTitleHeight + legendEntries.length * legendLineHeight + 10
    : 0;

  const legendX = gridOriginX + gridPixelWidth + legendGap;

  // Materials
  const materialsLineHeight = 18;
  const materialsTitleHeight = 28;
  const materialsHeight = showMaterials
    ? materialsTitleHeight + legendEntries.length * materialsLineHeight + 20
    : 0;

  const materialsY = gridOriginY + gridPixelHeight + 20;

  // Canvas dimensions
  const rightEdge = showLegend
    ? legendX + legendWidth + margin
    : gridOriginX + gridPixelWidth + margin;

  const bottomEdge = showMaterials
    ? materialsY + materialsHeight + margin
    : gridOriginY + gridPixelHeight + margin;

  const canvasWidth = Math.max(rightEdge, gridOriginX + gridPixelWidth + margin);
  const canvasHeight = Math.max(
    bottomEdge,
    showLegend ? gridOriginY + legendHeight + margin : 0,
  );

  return {
    margin,
    numberGutter,
    gridOriginX,
    gridOriginY,
    gridPixelWidth,
    gridPixelHeight,
    legendX,
    legendWidth,
    legendEntries,
    legendHeight,
    materialsY,
    materialsHeight,
    canvasWidth,
    canvasHeight,
  };
}

// ---------------------------------------------------------------------------
// Drawing routines
// ---------------------------------------------------------------------------

function drawGridCells(
  ctx: SKRSContext2D,
  pattern: BeadPattern,
  cellSize: number,
  originX: number,
  originY: number,
): void {
  const checkerSize = Math.max(4, Math.floor(cellSize / 4));

  for (let row = 0; row < pattern.height; row++) {
    for (let col = 0; col < pattern.width; col++) {
      const bead = pattern.grid[row][col];
      const x = originX + col * cellSize;
      const y = originY + row * cellSize;

      // Check for transparent / near-black with zero channels indicating transparency
      const isTransparent =
        bead.hex.toLowerCase() === '#000000' &&
        bead.code.toLowerCase() === 'transparent';

      if (isTransparent) {
        drawCheckerboard(ctx, x, y, cellSize, cellSize, checkerSize);
      } else {
        ctx.fillStyle = rgbToHex(bead.r, bead.g, bead.b);
        ctx.fillRect(x, y, cellSize, cellSize);
      }
    }
  }
}

function drawGridLines(
  ctx: SKRSContext2D,
  pattern: BeadPattern,
  cellSize: number,
  originX: number,
  originY: number,
): void {
  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;

  // Vertical lines
  for (let col = 0; col <= pattern.width; col++) {
    const x = originX + col * cellSize;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, originY);
    ctx.lineTo(x + 0.5, originY + gridH);
    ctx.stroke();
  }

  // Horizontal lines
  for (let row = 0; row <= pattern.height; row++) {
    const y = originY + row * cellSize;
    ctx.beginPath();
    ctx.moveTo(originX, y + 0.5);
    ctx.lineTo(originX + gridW, y + 0.5);
    ctx.stroke();
  }
}

function drawColorCodes(
  ctx: SKRSContext2D,
  pattern: BeadPattern,
  cellSize: number,
  originX: number,
  originY: number,
): void {
  const fontSize = Math.max(7, Math.min(10, Math.floor(cellSize * 0.38)));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let row = 0; row < pattern.height; row++) {
    for (let col = 0; col < pattern.width; col++) {
      const bead = pattern.grid[row][col];
      const cx = originX + col * cellSize + cellSize / 2;
      const cy = originY + row * cellSize + cellSize / 2;

      ctx.fillStyle = getContrastColor(bead.r, bead.g, bead.b);

      // Truncate code if too long to fit
      let code = bead.code;
      const maxChars = Math.max(2, Math.floor(cellSize / (fontSize * 0.6)));
      if (code.length > maxChars) {
        code = code.substring(0, maxChars);
      }

      ctx.fillText(code, cx, cy, cellSize - 2);
    }
  }
}

function drawRowColNumbers(
  ctx: SKRSContext2D,
  pattern: BeadPattern,
  cellSize: number,
  originX: number,
  originY: number,
): void {
  const fontSize = 10;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = '#555555';

  // Column numbers (every 5th, 1-indexed)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (let col = 0; col < pattern.width; col++) {
    if ((col + 1) % 5 === 0 || col === 0) {
      const x = originX + col * cellSize + cellSize / 2;
      const y = originY - 4;
      ctx.fillText(String(col + 1), x, y);
    }
  }

  // Row numbers (every 5th, 1-indexed)
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < pattern.height; row++) {
    if ((row + 1) % 5 === 0 || row === 0) {
      const x = originX - 6;
      const y = originY + row * cellSize + cellSize / 2;
      ctx.fillText(String(row + 1), x, y);
    }
  }
}

function drawBoardBoundaries(
  ctx: SKRSContext2D,
  pattern: BeadPattern,
  cellSize: number,
  originX: number,
  originY: number,
  boardWidth: number,
  boardHeight: number,
): void {
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;

  const gridW = pattern.width * cellSize;
  const gridH = pattern.height * cellSize;

  // Vertical board boundaries
  for (let col = 0; col <= pattern.width; col += boardWidth) {
    if (col === 0 || col === pattern.width) continue;
    const x = originX + col * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, originY);
    ctx.lineTo(x, originY + gridH);
    ctx.stroke();
  }

  // Horizontal board boundaries
  for (let row = 0; row <= pattern.height; row += boardHeight) {
    if (row === 0 || row === pattern.height) continue;
    const y = originY + row * cellSize;
    ctx.beginPath();
    ctx.moveTo(originX, y);
    ctx.lineTo(originX + gridW, y);
    ctx.stroke();
  }

  // Outer border thicker
  ctx.strokeStyle = '#ff0000';
  ctx.lineWidth = 2;
  ctx.strokeRect(originX, originY, gridW, gridH);
}

function drawLegend(
  ctx: SKRSContext2D,
  legendX: number,
  originY: number,
  entries: { color: BeadColor; count: number }[],
): void {
  const titleFontSize = 16;
  const entryFontSize = 12;
  const swatchSize = 20;
  const lineHeight = 24;

  // Title
  ctx.font = `bold ${titleFontSize}px sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Color Legend', legendX, originY);

  let y = originY + 28;

  ctx.font = `${entryFontSize}px sans-serif`;
  ctx.textBaseline = 'middle';

  for (const entry of entries) {
    const { color } = entry;

    // Swatch
    ctx.fillStyle = rgbToHex(color.r, color.g, color.b);
    ctx.fillRect(legendX, y, swatchSize, swatchSize);

    // Swatch border
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, y, swatchSize, swatchSize);

    // Code and name
    ctx.fillStyle = '#000000';
    const label = `${color.code} - ${color.nameEn}`;
    ctx.fillText(label, legendX + swatchSize + 8, y + swatchSize / 2);

    y += lineHeight;
  }
}

function drawMaterialList(
  ctx: SKRSContext2D,
  materialsY: number,
  originX: number,
  entries: { color: BeadColor; count: number }[],
  totalBeads: number,
): void {
  const titleFontSize = 16;
  const entryFontSize = 12;
  const lineHeight = 18;

  // Title
  ctx.font = `bold ${titleFontSize}px sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Material List', originX, materialsY);

  let y = materialsY + 28;

  ctx.font = `${entryFontSize}px sans-serif`;
  ctx.textBaseline = 'top';

  // Header
  ctx.fillStyle = '#333333';
  ctx.font = `bold ${entryFontSize}px sans-serif`;
  ctx.fillText('Code', originX, y);
  ctx.fillText('Color Name', originX + 60, y);
  ctx.fillText('Brand', originX + 240, y);
  ctx.fillText('Count', originX + 320, y);
  ctx.fillText('%', originX + 380, y);

  y += lineHeight;

  // Separator line
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(originX, y - 2);
  ctx.lineTo(originX + 420, y - 2);
  ctx.stroke();

  ctx.font = `${entryFontSize}px sans-serif`;

  for (const entry of entries) {
    const { color, count } = entry;
    const pct = ((count / totalBeads) * 100).toFixed(1);

    // Small color indicator
    ctx.fillStyle = rgbToHex(color.r, color.g, color.b);
    ctx.fillRect(originX - 14, y + 1, 10, 10);
    ctx.strokeStyle = '#666666';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(originX - 14, y + 1, 10, 10);

    ctx.fillStyle = '#000000';
    ctx.fillText(color.code, originX, y);
    ctx.fillText(color.nameEn, originX + 60, y);
    ctx.fillText(color.brand, originX + 240, y);
    ctx.fillText(String(count), originX + 320, y);
    ctx.fillText(`${pct}%`, originX + 380, y);

    y += lineHeight;
  }

  // Total row
  y += 4;
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(originX, y - 2);
  ctx.lineTo(originX + 420, y - 2);
  ctx.stroke();

  ctx.font = `bold ${entryFontSize}px sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.fillText('TOTAL', originX, y);
  ctx.fillText(String(totalBeads), originX + 320, y);
  ctx.fillText('100%', originX + 380, y);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Render a bead pattern as a PNG grid image with color codes, legend, and
 * material list.  Writes the result to `outputPath`.
 */
export async function renderPngGrid(
  pattern: BeadPattern,
  outputPath: string,
  options?: PngGridOptions,
): Promise<void> {
  const cellSize = options?.cellSize ?? 24;
  const showCodes = options?.showCodes ?? true;
  const showLegend = options?.showLegend ?? true;
  const showMaterials = options?.showMaterials ?? true;
  const showNumbers = options?.showNumbers ?? true;
  const multiBoard = options?.multiBoard ?? false;
  const boardWidth = options?.boardWidth ?? 29;
  const boardHeight = options?.boardHeight ?? 29;

  // ---- Compute layout ----
  const layout = computeLayout(pattern, cellSize, showLegend, showMaterials, showNumbers);

  // ---- Create canvas ----
  const canvas: Canvas = createCanvas(layout.canvasWidth, layout.canvasHeight);
  const ctx: SKRSContext2D = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);

  // ---- Draw grid cells ----
  drawGridCells(ctx, pattern, cellSize, layout.gridOriginX, layout.gridOriginY);

  // ---- Draw grid lines ----
  drawGridLines(ctx, pattern, cellSize, layout.gridOriginX, layout.gridOriginY);

  // ---- Draw color codes in cells ----
  if (showCodes) {
    drawColorCodes(ctx, pattern, cellSize, layout.gridOriginX, layout.gridOriginY);
  }

  // ---- Draw row/column numbers ----
  if (showNumbers) {
    drawRowColNumbers(ctx, pattern, cellSize, layout.gridOriginX, layout.gridOriginY);
  }

  // ---- Draw board boundaries if multiBoard ----
  if (multiBoard) {
    drawBoardBoundaries(
      ctx,
      pattern,
      cellSize,
      layout.gridOriginX,
      layout.gridOriginY,
      boardWidth,
      boardHeight,
    );
  }

  // ---- Draw legend on right side ----
  if (showLegend) {
    drawLegend(ctx, layout.legendX, layout.gridOriginY, layout.legendEntries);
  }

  // ---- Draw material list at bottom ----
  if (showMaterials) {
    drawMaterialList(
      ctx,
      layout.materialsY,
      layout.gridOriginX,
      layout.legendEntries,
      pattern.totalBeads,
    );
  }

  // ---- Save to PNG file ----
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
}
