/**
 * Image loading and conversion to a bead grid using dominant color extraction.
 *
 * Uses sharp for image I/O and a color-bucketing approach for dominant color
 * extraction.  The bucketing prevents gray halos at colour boundaries: at a
 * boundary between red and blue pixels we pick either red or blue, never
 * purple.
 */

import sharp from 'sharp';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A grid of RGBA pixels, one per bead position. */
export interface PixelGrid {
  width: number;   // grid width in beads
  height: number;  // grid height in beads
  pixels: Uint8Array; // RGBA data, length = width * height * 4
}

/** Named board size. */
export interface BoardSize {
  width: number;
  height: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

/**
 * Load an image from disk and convert it to raw RGBA pixel data.
 *
 * @param filePath - Absolute or relative path to the image file.
 * @returns An object containing the image width, height, and raw RGBA buffer.
 * @throws If the file does not exist or the format is unsupported.
 */
export async function loadImage(
  filePath: string,
): Promise<{ width: number; height: number; data: Buffer }> {
  // Check existence first so we can give a clear error message.
  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  try {
    const image = sharp(filePath);
    const metadata = await image.metadata();

    if (metadata.width === undefined || metadata.height === undefined) {
      throw new Error(
        `Unable to read image dimensions from: ${filePath}`,
      );
    }

    const { data, info } = await image
      .ensureAlpha() // guarantee 4 channels (RGBA)
      .raw()
      .toBuffer({ resolveWithObject: true });

    return {
      width: info.width,
      height: info.height,
      data,
    };
  } catch (err: unknown) {
    // Re-throw our own errors as-is.
    if (err instanceof Error && err.message.startsWith('Image file not found')) {
      throw err;
    }
    if (err instanceof Error && err.message.startsWith('Unable to read image dimensions')) {
      throw err;
    }

    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load image "${filePath}": ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Dominant colour extraction via 5-bit bucketing
// ---------------------------------------------------------------------------

/**
 * Quantize an RGB triplet to a 15-bit bucket key by reducing each channel to
 * 5 bits (dividing by 8).  This groups perceptually similar colours so we can
 * find the dominant bucket quickly.
 */
function colorBucketKey(r: number, g: number, b: number): number {
  return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/**
 * Divide the source image into a grid of cells and extract the dominant colour
 * for each cell using a 5-bit-per-channel colour bucketing approach.
 *
 * For every cell the algorithm:
 *   1. Iterates over every source pixel that falls inside the cell.
 *   2. Quantizes the pixel's RGB to a 15-bit bucket key (5 bits/channel).
 *   3. Tracks the count and running RGB sum for each bucket.
 *   4. Selects the bucket with the highest count and uses its average RGB as
 *      the cell colour.
 *
 * This avoids colour averaging, which would produce grey halos at boundaries
 * between distinct colours (e.g. red / blue -> purple).
 *
 * @param imageData   Raw RGBA buffer of the source image.
 * @param imageWidth  Width of the source image in pixels.
 * @param imageHeight Height of the source image in pixels.
 * @param gridWidth   Desired grid width (number of bead columns).
 * @param gridHeight  Desired grid height (number of bead rows).
 * @returns A {@link PixelGrid} with one RGBA pixel per bead position.
 */
export function extractDominantColors(
  imageData: Buffer,
  imageWidth: number,
  imageHeight: number,
  gridWidth: number,
  gridHeight: number,
): PixelGrid {
  const pixels = new Uint8Array(gridWidth * gridHeight * 4);

  const cellW = imageWidth / gridWidth;
  const cellH = imageHeight / gridHeight;

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      // Determine source-pixel boundaries for this cell.
      const srcX0 = Math.floor(gx * cellW);
      const srcY0 = Math.floor(gy * cellH);
      const srcX1 = Math.min(Math.floor((gx + 1) * cellW), imageWidth);
      const srcY1 = Math.min(Math.floor((gy + 1) * cellH), imageHeight);

      // Bucket map: key -> { count, sumR, sumG, sumB, sumA }
      const buckets = new Map<
        number,
        { count: number; sumR: number; sumG: number; sumB: number; sumA: number }
      >();

      for (let sy = srcY0; sy < srcY1; sy++) {
        for (let sx = srcX0; sx < srcX1; sx++) {
          const idx = (sy * imageWidth + sx) * 4;
          const r = imageData[idx];
          const g = imageData[idx + 1];
          const b = imageData[idx + 2];
          const a = imageData[idx + 3];

          const key = colorBucketKey(r, g, b);
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.count++;
            bucket.sumR += r;
            bucket.sumG += g;
            bucket.sumB += b;
            bucket.sumA += a;
          } else {
            buckets.set(key, { count: 1, sumR: r, sumG: g, sumB: b, sumA: a });
          }
        }
      }

      // Find the dominant bucket (highest count).
      let bestBucket: { count: number; sumR: number; sumG: number; sumB: number; sumA: number } | null = null;
      let bestCount = 0;

      for (const bucket of buckets.values()) {
        if (bucket.count > bestCount) {
          bestCount = bucket.count;
          bestBucket = bucket;
        }
      }

      const outIdx = (gy * gridWidth + gx) * 4;
      if (bestBucket && bestBucket.count > 0) {
        pixels[outIdx] = Math.round(bestBucket.sumR / bestBucket.count);
        pixels[outIdx + 1] = Math.round(bestBucket.sumG / bestBucket.count);
        pixels[outIdx + 2] = Math.round(bestBucket.sumB / bestBucket.count);
        pixels[outIdx + 3] = Math.round(bestBucket.sumA / bestBucket.count);
      } else {
        // Empty cell (should not happen in practice) — transparent black.
        pixels[outIdx] = 0;
        pixels[outIdx + 1] = 0;
        pixels[outIdx + 2] = 0;
        pixels[outIdx + 3] = 0;
      }
    }
  }

  return { width: gridWidth, height: gridHeight, pixels };
}

// ---------------------------------------------------------------------------
// Board size parsing
// ---------------------------------------------------------------------------

/** Predefined board-size presets. */
const BOARD_PRESETS: Record<string, BoardSize> = {
  '29x29': { width: 29, height: 29, name: 'Standard square board' },
  '39x39': { width: 39, height: 39, name: 'Large square board' },
  '29x58': { width: 29, height: 58, name: 'Double board' },
};

/**
 * Parse a board size specification string.
 *
 * Recognised formats:
 *   - Named presets: "29x29", "39x39", "29x58"
 *   - Custom sizes : "WxH" where W and H are positive integers
 *
 * @param spec - Board size string, e.g. "29x29" or "60x80".
 * @returns A {@link BoardSize} with width, height, and a descriptive name.
 * @throws If the string does not match the expected format or dimensions are
 *         not positive integers.
 */
export function parseBoardSize(spec: string): BoardSize {
  // Check presets first.
  const preset = BOARD_PRESETS[spec];
  if (preset) {
    return { ...preset };
  }

  // Parse custom "WxH".
  const match = /^(\d+)x(\d+)$/.exec(spec);
  if (!match) {
    throw new Error(
      `Invalid board size format: "${spec}". Expected "WxH" (e.g. "29x29").`,
    );
  }

  const width = parseInt(match[1], 10);
  const height = parseInt(match[2], 10);

  if (width <= 0 || height <= 0) {
    throw new Error(
      `Board dimensions must be positive integers. Got: ${width}x${height}`,
    );
  }

  return { width, height, name: `Custom ${width}x${height}` };
}

// ---------------------------------------------------------------------------
// Adaptive intermediate scale factor
// ---------------------------------------------------------------------------

/**
 * Determine the intermediate resize multiplier based on board dimensions.
 *
 * Smaller boards benefit from a higher multiplier so that each cell in the
 * intermediate image contains more source pixels, preserving fine details
 * during dominant-colour extraction.
 *
 * - Small boards  (<= 39x39): 8x
 * - Medium boards (<= 80x80): 6x
 * - Large boards  (> 80x80):  5x
 *
 * @param boardWidth  Number of bead columns.
 * @param boardHeight Number of bead rows.
 * @returns The integer multiplier to apply.
 */
function getIntermediateScale(boardWidth: number, boardHeight: number): number {
  const maxDim = Math.max(boardWidth, boardHeight);

  if (maxDim <= 39) {
    return 8;
  }
  if (maxDim <= 80) {
    return 6;
  }
  return 5;
}

// ---------------------------------------------------------------------------
// High-level: image -> PixelGrid
// ---------------------------------------------------------------------------

/**
 * Load an image, resize it to the target bead-grid dimensions, and extract
 * dominant colours per cell.
 *
 * The image is first resized using sharp with a lanczos3 kernel to produce a
 * high-quality intermediate at the exact grid resolution.  Then
 * {@link extractDominantColors} picks the dominant colour for each cell (which,
 * after the resize, is a single pixel per cell --- but the bucketing still
 * applies to the pre-resize image when cell sizes are larger than 1:1).
 *
 * The intermediate size is determined adaptively by
 * {@link getIntermediateScale}: smaller boards use a higher multiplier so that
 * each cell has more source pixels for the bucketing algorithm, preserving
 * more of the original image's detail.
 *
 * @param filePath    Path to the source image.
 * @param boardWidth  Number of bead columns.
 * @param boardHeight Number of bead rows.
 * @returns A {@link PixelGrid} ready for palette matching.
 */
export async function imageToGrid(
  filePath: string,
  boardWidth: number,
  boardHeight: number,
): Promise<PixelGrid> {
  // Check existence early.
  if (!fs.existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }

  // Resize to an intermediate that is Nx the target grid (adaptive) so that
  // each cell still covers a small region of pixels, giving the bucketing
  // algorithm enough data to pick a dominant colour instead of just a single
  // pixel.
  const scale = getIntermediateScale(boardWidth, boardHeight);
  const intermediateWidth = boardWidth * scale;
  const intermediateHeight = boardHeight * scale;

  try {
    const { data, info } = await sharp(filePath)
      .resize(intermediateWidth, intermediateHeight, {
        kernel: sharp.kernel.lanczos3,
        fit: 'fill',
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return extractDominantColors(
      data,
      info.width,
      info.height,
      boardWidth,
      boardHeight,
    );
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to process image "${filePath}": ${message}`);
  }
}
