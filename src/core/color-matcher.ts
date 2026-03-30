/**
 * Color matching module.
 *
 * Maps pixel colors to bead colors using CIEDE2000 perceptual distance,
 * with support for max color limits, palette subsets, and Floyd-Steinberg
 * dithering.
 */

import { BeadColor } from '../palettes/types';
import { rgbToLab, ciede2000, Lab } from './color-science';
import { PixelGrid } from './image-loader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A bead pattern: a 2D grid of matched bead colors plus summary statistics.
 */
export interface BeadPattern {
  width: number;
  height: number;
  grid: BeadColor[][];  // [row][col] of matched bead colors
  colorCounts: Map<string, { color: BeadColor; count: number }>;  // key = color code
  totalBeads: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Lab cache for a palette so we convert each bead color only once.
 */
function buildLabCache(palette: BeadColor[]): Map<string, Lab> {
  const cache = new Map<string, Lab>();
  for (const color of palette) {
    if (!cache.has(color.code)) {
      cache.set(color.code, rgbToLab(color.r, color.g, color.b));
    }
  }
  return cache;
}

/**
 * Find the nearest bead color for the given RGB value, using a precomputed
 * Lab cache for the palette.
 */
function findNearestBeadColor(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[],
  labCache: Map<string, Lab>,
): BeadColor {
  const targetLab = rgbToLab(r, g, b);

  let bestColor: BeadColor = palette[0];
  let bestDistance = Infinity;

  for (const entry of palette) {
    const entryLab = labCache.get(entry.code)!;
    const dist = ciede2000(targetLab, entryLab);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestColor = entry;
    }
  }

  return bestColor;
}

/**
 * Build a BeadPattern from a pixel grid using the given palette and Lab cache.
 */
function buildPattern(
  pixelGrid: PixelGrid,
  palette: BeadColor[],
  labCache: Map<string, Lab>,
): BeadPattern {
  const { width, height, pixels } = pixelGrid;
  const grid: BeadColor[][] = [];
  const colorCounts = new Map<string, { color: BeadColor; count: number }>();
  let totalBeads = 0;

  for (let row = 0; row < height; row++) {
    const rowColors: BeadColor[] = [];
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const matched = findNearestBeadColor(r, g, b, palette, labCache);
      rowColors.push(matched);
      totalBeads++;

      const existing = colorCounts.get(matched.code);
      if (existing) {
        existing.count++;
      } else {
        colorCounts.set(matched.code, { color: matched, count: 1 });
      }
    }
    grid.push(rowColors);
  }

  return { width, height, grid, colorCounts, totalBeads };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Match every pixel in the grid to the nearest bead color using CIEDE2000.
 *
 * Palette Lab values are cached so each bead color is converted only once.
 */
export function matchColors(
  pixelGrid: PixelGrid,
  palette: BeadColor[],
): BeadPattern {
  if (palette.length === 0) {
    throw new Error('matchColors: palette must not be empty');
  }

  const labCache = buildLabCache(palette);
  return buildPattern(pixelGrid, palette, labCache);
}

/**
 * Identify "edge colors" — colors whose beads frequently appear at colour
 * boundaries.  A bead is at an edge position if at least one of its
 * 4-connected neighbours is a different colour.  If more than 30% of a
 * colour's beads are at edge positions, the colour is considered an edge
 * colour and should be protected from removal during palette reduction.
 *
 * @param grid    The matched bead grid from the first pass.
 * @param width   Grid width.
 * @param height  Grid height.
 * @returns A Set of bead colour codes that are marked as protected.
 */
function identifyEdgeColors(
  grid: BeadColor[][],
  width: number,
  height: number,
): Set<string> {
  /** Per-color tracking: total bead count and count of edge beads. */
  const stats = new Map<string, { total: number; edge: number }>();

  const dx = [0, 0, -1, 1];
  const dy = [-1, 1, 0, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      const key = cell.code;

      let entry = stats.get(key);
      if (!entry) {
        entry = { total: 0, edge: 0 };
        stats.set(key, entry);
      }
      entry.total++;

      // Check if this bead is at an edge (adjacent to a different colour).
      for (let d = 0; d < 4; d++) {
        const nx = x + dx[d];
        const ny = y + dy[d];

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          // Grid boundary counts as an edge.
          entry.edge++;
          break;
        }

        if (grid[ny][nx].code !== key) {
          entry.edge++;
          break;
        }
      }
    }
  }

  // Colours with > 30% edge beads are protected.
  const EDGE_RATIO_THRESHOLD = 0.3;
  const protectedColors = new Set<string>();

  for (const [code, { total, edge }] of stats) {
    if (total > 0 && edge / total > EDGE_RATIO_THRESHOLD) {
      protectedColors.add(code);
    }
  }

  return protectedColors;
}

/**
 * Match pixels to bead colors, but limit the result to at most `maxColors`
 * distinct bead colors.
 *
 * Algorithm:
 *   1. First pass: match all pixels to nearest colors (full palette).
 *   2. Identify edge colors — colors whose beads are predominantly at
 *      colour boundaries (>30% edge ratio).  These are protected.
 *   3. Protected colours are forcibly kept in the reduced palette; the
 *      remaining quota is filled with the most-used non-protected colours.
 *   4. Second pass: re-match all pixels against the reduced palette.
 *
 * This preserves detail-defining edge colours that would otherwise be
 * dropped by a purely usage-based top-N selection.
 */
export function matchColorsWithLimit(
  pixelGrid: PixelGrid,
  palette: BeadColor[],
  maxColors: number,
): BeadPattern {
  if (palette.length === 0) {
    throw new Error('matchColorsWithLimit: palette must not be empty');
  }
  if (maxColors < 1) {
    throw new Error('matchColorsWithLimit: maxColors must be at least 1');
  }

  // First pass: full palette match
  const labCache = buildLabCache(palette);
  const firstPass = buildPattern(pixelGrid, palette, labCache);

  // Check if we need to reduce
  if (firstPass.colorCounts.size <= maxColors) {
    return firstPass;
  }

  // Identify edge colours that should be protected.
  const protectedCodes = identifyEdgeColors(
    firstPass.grid,
    firstPass.width,
    firstPass.height,
  );

  // Build the reduced palette:
  // 1. All protected colours go in first (as long as they were actually used).
  // 2. Remaining slots filled by top-usage non-protected colours.
  const usedEntries = Array.from(firstPass.colorCounts.values());

  const protectedEntries = usedEntries
    .filter((e) => protectedCodes.has(e.color.code))
    .sort((a, b) => b.count - a.count);

  const nonProtectedEntries = usedEntries
    .filter((e) => !protectedCodes.has(e.color.code))
    .sort((a, b) => b.count - a.count);

  const reducedPalette: BeadColor[] = [];
  const addedCodes = new Set<string>();

  // Add protected colours (up to maxColors).
  for (const entry of protectedEntries) {
    if (reducedPalette.length >= maxColors) break;
    if (!addedCodes.has(entry.color.code)) {
      reducedPalette.push(entry.color);
      addedCodes.add(entry.color.code);
    }
  }

  // Fill remaining slots with non-protected colours by usage.
  for (const entry of nonProtectedEntries) {
    if (reducedPalette.length >= maxColors) break;
    if (!addedCodes.has(entry.color.code)) {
      reducedPalette.push(entry.color);
      addedCodes.add(entry.color.code);
    }
  }

  // Build a Lab cache for the reduced palette (subset of the original cache)
  const reducedLabCache = new Map<string, Lab>();
  for (const color of reducedPalette) {
    reducedLabCache.set(color.code, labCache.get(color.code)!);
  }

  // Second pass: re-match using only the reduced palette
  return buildPattern(pixelGrid, reducedPalette, reducedLabCache);
}

/**
 * Filter a palette to include only colors whose codes appear in the given
 * list.
 *
 * @throws Error if any code in `codes` is not found in the palette.
 */
export function filterPaletteBySubset(
  palette: BeadColor[],
  codes: string[],
): BeadColor[] {
  const codeSet = new Set(codes);
  const paletteMap = new Map<string, BeadColor>();

  for (const color of palette) {
    paletteMap.set(color.code, color);
  }

  const filtered: BeadColor[] = [];
  for (const code of codes) {
    const color = paletteMap.get(code);
    if (!color) {
      throw new Error(
        `filterPaletteBySubset: color code "${code}" not found in palette`,
      );
    }
    filtered.push(color);
  }

  return filtered;
}

/**
 * Apply Floyd-Steinberg dithering to a pixel grid.
 *
 * For each pixel (left to right, top to bottom):
 *   1. Find the nearest bead color.
 *   2. Compute the quantization error (original - matched) for R, G, B.
 *   3. Distribute the error to neighboring pixels:
 *      - right:        7/16
 *      - below-left:   3/16
 *      - below:        5/16
 *      - below-right:  1/16
 *
 * Returns a new PixelGrid with dithered pixel values. The original grid is
 * not modified.
 */
export function applyDithering(
  pixelGrid: PixelGrid,
  palette: BeadColor[],
): PixelGrid {
  if (palette.length === 0) {
    throw new Error('applyDithering: palette must not be empty');
  }

  const { width, height, pixels } = pixelGrid;
  const labCache = buildLabCache(palette);

  // Work on a copy of the pixel data using Float64Array for sub-pixel
  // precision during error diffusion (values can go negative or exceed 255).
  const data = new Float64Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i] = pixels[i];
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4;

      // Clamp current pixel values to [0, 255] before matching
      const oldR = Math.max(0, Math.min(255, data[idx]));
      const oldG = Math.max(0, Math.min(255, data[idx + 1]));
      const oldB = Math.max(0, Math.min(255, data[idx + 2]));

      // Find nearest bead color
      const matched = findNearestBeadColor(
        Math.round(oldR),
        Math.round(oldG),
        Math.round(oldB),
        palette,
        labCache,
      );

      // Compute quantization error
      const errR = oldR - matched.r;
      const errG = oldG - matched.g;
      const errB = oldB - matched.b;

      // Write the matched color back into the data
      data[idx] = matched.r;
      data[idx + 1] = matched.g;
      data[idx + 2] = matched.b;
      // Alpha channel is left unchanged

      // Distribute error to neighbors
      // Right: (row, col + 1) -> 7/16
      if (col + 1 < width) {
        const ni = (row * width + (col + 1)) * 4;
        data[ni] += errR * (7 / 16);
        data[ni + 1] += errG * (7 / 16);
        data[ni + 2] += errB * (7 / 16);
      }

      // Below-left: (row + 1, col - 1) -> 3/16
      if (row + 1 < height && col - 1 >= 0) {
        const ni = ((row + 1) * width + (col - 1)) * 4;
        data[ni] += errR * (3 / 16);
        data[ni + 1] += errG * (3 / 16);
        data[ni + 2] += errB * (3 / 16);
      }

      // Below: (row + 1, col) -> 5/16
      if (row + 1 < height) {
        const ni = ((row + 1) * width + col) * 4;
        data[ni] += errR * (5 / 16);
        data[ni + 1] += errG * (5 / 16);
        data[ni + 2] += errB * (5 / 16);
      }

      // Below-right: (row + 1, col + 1) -> 1/16
      if (row + 1 < height && col + 1 < width) {
        const ni = ((row + 1) * width + (col + 1)) * 4;
        data[ni] += errR * (1 / 16);
        data[ni + 1] += errG * (1 / 16);
        data[ni + 2] += errB * (1 / 16);
      }
    }
  }

  // Convert back to Uint8Array, clamping to [0, 255]
  const result = new Uint8Array(width * height * 4);
  for (let i = 0; i < result.length; i++) {
    result[i] = Math.max(0, Math.min(255, Math.round(data[i])));
  }

  return { width, height, pixels: result };
}

// ---------------------------------------------------------------------------
// Color minimization
// ---------------------------------------------------------------------------

/** Default maximum CIEDE2000 distance for merging two colours. */
const MINIMIZE_MERGE_THRESHOLD = 25;

/**
 * Reduce the number of distinct bead colours in a pattern by iteratively
 * merging the two perceptually closest colours.
 *
 * Algorithm:
 *   1. Collect current colour usage from the pattern's `colorCounts`.
 *   2. Sort by usage (ascending — least-used colours are merge candidates).
 *   3. Find the pair of colours with the smallest CIEDE2000 distance.
 *   4. Replace all beads of the less-used colour with the more-used colour.
 *   5. Repeat until `colorCounts.size <= targetCount` or the smallest
 *      pairwise distance exceeds `mergeThreshold` (default 25).
 *
 * The input pattern is **not** mutated; a deep copy is returned.
 *
 * @param pattern        The input bead pattern.
 * @param targetCount    Desired maximum number of distinct colours.
 * @param mergeThreshold Maximum CIEDE2000 distance for a merge (default 25).
 * @returns A new BeadPattern with reduced colour count.
 */
export function minimizeColors(
  pattern: BeadPattern,
  targetCount: number,
  mergeThreshold: number = MINIMIZE_MERGE_THRESHOLD,
): BeadPattern {
  // Deep-clone the grid so we don't mutate the original.
  const { width, height } = pattern;
  const grid: BeadColor[][] = pattern.grid.map((row) =>
    row.map((cell) => ({ ...cell })),
  );

  // Build a mutable map of currently used colours and their counts.
  let colorMap = new Map<string, { color: BeadColor; count: number }>();
  for (const [key, value] of pattern.colorCounts) {
    colorMap.set(key, { color: { ...value.color }, count: value.count });
  }

  // Pre-compute Lab values for all used colours.
  const labMap = new Map<string, Lab>();
  for (const [key, { color }] of colorMap) {
    labMap.set(key, rgbToLab(color.r, color.g, color.b));
  }

  // Iteratively merge until target is met or threshold exceeded.
  while (colorMap.size > targetCount) {
    const codes = Array.from(colorMap.keys());
    if (codes.length <= 1) break;

    // Find the closest pair of colours.
    let bestDist = Infinity;
    let mergeFrom = '';  // less-used colour (will be replaced)
    let mergeInto = '';  // more-used colour (will absorb)

    for (let i = 0; i < codes.length; i++) {
      const labI = labMap.get(codes[i])!;
      const countI = colorMap.get(codes[i])!.count;

      for (let j = i + 1; j < codes.length; j++) {
        const labJ = labMap.get(codes[j])!;
        const dist = ciede2000(labI, labJ);

        if (dist < bestDist) {
          bestDist = dist;
          const countJ = colorMap.get(codes[j])!.count;

          // The less-used colour merges into the more-used one.
          if (countI <= countJ) {
            mergeFrom = codes[i];
            mergeInto = codes[j];
          } else {
            mergeFrom = codes[j];
            mergeInto = codes[i];
          }
        }
      }
    }

    // Stop if the closest pair exceeds the merge threshold.
    if (bestDist > mergeThreshold) {
      break;
    }

    // Perform the merge: replace all beads of `mergeFrom` with `mergeInto`.
    const targetColor = colorMap.get(mergeInto)!.color;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        const cellKey = cell.code;
        if (cellKey === colorMap.get(mergeFrom)?.color.code) {
          grid[y][x] = { ...targetColor };
        }
      }
    }

    // Update counts.
    const fromEntry = colorMap.get(mergeFrom)!;
    const intoEntry = colorMap.get(mergeInto)!;
    intoEntry.count += fromEntry.count;

    // Remove the merged colour.
    colorMap.delete(mergeFrom);
    labMap.delete(mergeFrom);
  }

  // Rebuild colorCounts from the final grid to ensure consistency.
  const finalColorCounts = new Map<string, { color: BeadColor; count: number }>();
  let totalBeads = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      totalBeads++;
      const key = cell.code;
      const existing = finalColorCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        finalColorCounts.set(key, { color: { ...cell }, count: 1 });
      }
    }
  }

  return { width, height, grid, colorCounts: finalColorCounts, totalBeads };
}
