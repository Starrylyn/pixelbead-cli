/**
 * Main `convert` command handler.
 *
 * Ties together every step of the image-to-bead-pattern pipeline:
 *   image loading -> background removal -> dithering -> color matching ->
 *   noise cleaning -> outline enhancement -> output rendering.
 */

import * as path from 'path';
import * as fs from 'fs';
import { getPalette, BrandName } from '../palettes';
import { BeadColor } from '../palettes/types';
import { imageToGrid, parseBoardSize } from '../core/image-loader';
import { matchColors, matchColorsWithLimit, filterPaletteBySubset, applyDithering } from '../core/color-matcher';
import { cleanNoise } from '../core/noise-cleaner';
import { removeBackground } from '../core/background-remover';
import { addOutline, addBlackOutline } from '../core/outline';
import { generateMaterialList, formatMaterialListText } from '../core/materials';
import { renderTerminalPreview, renderTerminalMaterialList } from '../output/terminal';
import { renderPngGrid } from '../output/png-grid';
import { renderPdfTemplate } from '../output/pdf-template';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConvertOptions {
  brand: BrandName;
  board: string;         // e.g. "29x29"
  output?: string;       // output file path (png or pdf)
  maxColors?: number;
  mergeThreshold?: number;
  removeBg?: boolean;
  dither?: boolean;
  outline?: boolean;
  outlineBlack?: boolean;
  colors?: string;       // comma-separated color codes
  multiBoard?: boolean;
  materialsOnly?: boolean;
  noLabels?: boolean;
  noLegend?: boolean;
  noMaterials?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a progress message to stderr so it does not interfere with piped
 * stdout output (e.g. terminal preview text piped to a file).
 */
function progress(message: string): void {
  process.stderr.write(message + '\n');
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runConvert(inputPath: string, options: ConvertOptions): Promise<void> {
  try {
    // ------------------------------------------------------------------
    // 1. Validate input
    // ------------------------------------------------------------------

    const resolvedInput = path.resolve(inputPath);

    if (!fs.existsSync(resolvedInput)) {
      throw new Error(`Input file not found: ${resolvedInput}`);
    }

    // Validate brand (getPalette will throw if unknown, but give a
    // friendlier message here).
    const validBrands: string[] = ['artkal', 'hama', 'perler', 'mard', 'coco'];
    if (!validBrands.includes(options.brand)) {
      throw new Error(
        `Unknown brand "${options.brand}". Available brands: ${validBrands.join(', ')}`,
      );
    }

    // ------------------------------------------------------------------
    // 2. Parse board size
    // ------------------------------------------------------------------

    progress('Parsing board size...');
    const boardSize = parseBoardSize(options.board);
    const boardWidth = boardSize.width;
    const boardHeight = boardSize.height;

    // ------------------------------------------------------------------
    // 3. Get palette (optionally filter by --colors subset)
    // ------------------------------------------------------------------

    progress('Loading palette...');
    const fullPalette = getPalette(options.brand);
    let paletteColors: BeadColor[] = fullPalette.colors;

    if (options.colors) {
      const codes = options.colors
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (codes.length > 0) {
        progress(`Filtering palette to ${codes.length} color(s)...`);
        paletteColors = filterPaletteBySubset(paletteColors, codes);
      }
    }

    // ------------------------------------------------------------------
    // 4. Load image and convert to pixel grid
    // ------------------------------------------------------------------

    progress('Loading image...');
    let pixelGrid = await imageToGrid(resolvedInput, boardWidth, boardHeight);

    // ------------------------------------------------------------------
    // 5. Background removal (optional)
    // ------------------------------------------------------------------

    if (options.removeBg) {
      progress('Removing background...');
      pixelGrid = removeBackground(pixelGrid);
    }

    // ------------------------------------------------------------------
    // 6. Dithering (optional, before color matching)
    // ------------------------------------------------------------------

    if (options.dither) {
      progress('Applying Floyd-Steinberg dithering...');
      pixelGrid = applyDithering(pixelGrid, paletteColors);
    }

    // ------------------------------------------------------------------
    // 7. Color matching
    // ------------------------------------------------------------------

    progress('Matching colors...');
    let pattern =
      options.maxColors !== undefined && options.maxColors > 0
        ? matchColorsWithLimit(pixelGrid, paletteColors, options.maxColors)
        : matchColors(pixelGrid, paletteColors);

    // ------------------------------------------------------------------
    // 8. Noise cleaning (always applied)
    // ------------------------------------------------------------------

    const mergeThreshold = options.mergeThreshold ?? 3;
    progress(`Cleaning noise (threshold=${mergeThreshold})...`);
    pattern = cleanNoise(pattern, mergeThreshold);

    // ------------------------------------------------------------------
    // 9. Outline enhancement (optional)
    // ------------------------------------------------------------------

    if (options.outline) {
      progress('Adding outline enhancement...');
      pattern = addOutline(pattern, paletteColors);
    }

    // ------------------------------------------------------------------
    // 9b. Black outline (optional, expands pattern by 1 bead each side)
    // ------------------------------------------------------------------

    if (options.outlineBlack) {
      progress('Adding black outline (pattern will expand by 2 beads)...');
      pattern = addBlackOutline(pattern, paletteColors);
    }

    // ------------------------------------------------------------------
    // Multi-board information
    // ------------------------------------------------------------------

    const boardsX = Math.ceil(pattern.width / boardWidth);
    const boardsY = Math.ceil(pattern.height / boardHeight);
    const totalBoards = boardsX * boardsY;

    if (totalBoards > 1) {
      progress(
        `Note: Pattern spans ${totalBoards} board(s) (${boardsX} wide x ${boardsY} tall).`,
      );
    }

    // ------------------------------------------------------------------
    // 10. Materials-only mode
    // ------------------------------------------------------------------

    if (options.materialsOnly) {
      progress('Generating material list...');
      const materialList = generateMaterialList(pattern, options.brand);
      const formatted = formatMaterialListText(materialList);
      process.stdout.write(formatted + '\n');
      return;
    }

    // ------------------------------------------------------------------
    // 11. Output
    // ------------------------------------------------------------------

    if (!options.output) {
      // No output file specified: render to terminal
      progress('Rendering terminal preview...');

      const preview = renderTerminalPreview(pattern);
      process.stdout.write(preview + '\n\n');

      const materialList = renderTerminalMaterialList(pattern);
      process.stdout.write(materialList + '\n');
      return;
    }

    const outputPath = path.resolve(options.output);
    const ext = path.extname(outputPath).toLowerCase();

    if (ext === '.png') {
      progress(`Rendering PNG to ${outputPath}...`);
      await renderPngGrid(pattern, outputPath, {
        boardWidth,
        boardHeight,
        multiBoard: options.multiBoard,
        showCodes: options.noLabels === undefined ? true : !options.noLabels,
        showLegend: options.noLegend ? false : true,
        showMaterials: options.noMaterials ? false : true,
        showNumbers: options.noLegend && options.noMaterials && options.noLabels ? false : true,
      });
      progress(`PNG saved: ${outputPath}`);
    } else if (ext === '.pdf') {
      progress(`Rendering PDF to ${outputPath}...`);
      await renderPdfTemplate(pattern, outputPath, {
        boardWidth,
        boardHeight,
        multiBoard: options.multiBoard,
        brand: options.brand,
        showLegend: options.noLegend ? false : true,
        showMaterials: options.noMaterials ? false : true,
      });
      progress(`PDF saved: ${outputPath}`);
    } else {
      // Fallback: unrecognised extension -> terminal preview
      progress('Unrecognised output extension; rendering terminal preview...');

      const preview = renderTerminalPreview(pattern);
      process.stdout.write(preview + '\n\n');

      const materialList = renderTerminalMaterialList(pattern);
      process.stdout.write(materialList + '\n');
    }

    progress('Done.');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}
