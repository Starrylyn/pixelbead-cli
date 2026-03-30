/**
 * Optional outline enhancement around the subject for better contrast.
 *
 * Detects edges in the bead pattern and darkens them, producing a subtle
 * outline that separates the subject from the background and improves
 * visual clarity at small bead sizes.
 */

import { BeadColor } from '../palettes/types';
import { BeadPattern } from './color-matcher';
import { rgbToLab, ciede2000, findNearestColor, labToRgb } from './color-science';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CIEDE2000 threshold above which two neighbouring cells are considered
 *  significantly different in colour (i.e. an edge). */
const EDGE_COLOR_THRESHOLD = 20;

/** Primary L* reduction for darkening an outline bead. */
const DARKEN_PRIMARY = 25;

/** Fallback L* reduction when the primary darkening maps to the same bead. */
const DARKEN_FALLBACK = 40;

/** Minimum L* value after darkening (avoid pure black artifacts). */
const MIN_LIGHTNESS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a bead colour is "transparent" / background.
 *
 * A bead whose English name contains "transparent" or "clear" is treated
 * as background.  This heuristic works across all supported palettes.
 */
function isTransparent(bead: BeadColor): boolean {
  const name = bead.nameEn.toLowerCase();
  if (name.includes('transparent') || name.includes('clear')) {
    return true;
  }
  return false;
}

/**
 * Deep-clone a BeadPattern so that mutations don't affect the original.
 */
function clonePattern(pattern: BeadPattern): BeadPattern {
  const newGrid: BeadColor[][] = pattern.grid.map((row) =>
    row.map((cell) => ({ ...cell })),
  );

  const newColorCounts = new Map<string, { color: BeadColor; count: number }>();
  pattern.colorCounts.forEach((value, key) => {
    newColorCounts.set(key, { color: { ...value.color }, count: value.count });
  });

  return {
    width: pattern.width,
    height: pattern.height,
    grid: newGrid,
    colorCounts: newColorCounts,
    totalBeads: pattern.totalBeads,
  };
}

/**
 * Rebuild the `colorCounts` map from the grid contents.
 */
function rebuildColorCounts(pattern: BeadPattern): void {
  pattern.colorCounts.clear();
  for (let y = 0; y < pattern.height; y++) {
    for (let x = 0; x < pattern.width; x++) {
      const cell = pattern.grid[y][x];
      if (!isTransparent(cell)) {
        const key = `${cell.brand}:${cell.code}`;
        const existing = pattern.colorCounts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          pattern.colorCounts.set(key, { color: { ...cell }, count: 1 });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4-connected neighbour offsets
// ---------------------------------------------------------------------------

const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];

// ---------------------------------------------------------------------------
// Edge detection
// ---------------------------------------------------------------------------

/**
 * Detect edge cells in the pattern.
 *
 * A cell is an "edge" if it is non-transparent AND at least one of its
 * 4-connected neighbours is either:
 *   - transparent / background, OR
 *   - a significantly different colour (CIEDE2000 > {@link EDGE_COLOR_THRESHOLD}).
 *
 * @returns A 2-D boolean grid (`[row][col]`) where `true` marks an edge cell.
 */
export function detectEdges(pattern: BeadPattern): boolean[][] {
  const { width, height, grid } = pattern;
  const edges: boolean[][] = [];

  for (let y = 0; y < height; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];

      // Transparent cells are never edges.
      if (isTransparent(cell)) {
        row.push(false);
        continue;
      }

      const cellLab = rgbToLab(cell.r, cell.g, cell.b);
      let isEdge = false;

      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];

        // Boundary neighbours count as transparent.
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          isEdge = true;
          break;
        }

        const neighbour = grid[ny][nx];

        if (isTransparent(neighbour)) {
          isEdge = true;
          break;
        }

        // Check colour difference.
        const neighbourLab = rgbToLab(neighbour.r, neighbour.g, neighbour.b);
        if (ciede2000(cellLab, neighbourLab) > EDGE_COLOR_THRESHOLD) {
          isEdge = true;
          break;
        }
      }

      row.push(isEdge);
    }
    edges.push(row);
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Colour darkening
// ---------------------------------------------------------------------------

/**
 * Darken a bead colour and find the nearest match in the palette.
 *
 * Steps:
 * 1. Convert the input colour to CIELAB.
 * 2. Reduce L* by {@link DARKEN_PRIMARY} (clamped to {@link MIN_LIGHTNESS}).
 * 3. Convert back to sRGB and find the nearest palette colour.
 * 4. If the result is the same bead as the input, try reducing L* by
 *    {@link DARKEN_FALLBACK} instead.
 *
 * @returns The darkened palette colour.
 */
export function darkenColor(color: BeadColor, palette: BeadColor[]): BeadColor {
  const lab = rgbToLab(color.r, color.g, color.b);

  // --- Primary darkening attempt ---
  const darkenedL = Math.max(MIN_LIGHTNESS, lab.L - DARKEN_PRIMARY);
  const darkenedRgb = labToRgb(darkenedL, lab.a, lab.b);
  const nearest = findNearestColor(darkenedRgb.r, darkenedRgb.g, darkenedRgb.b, palette);

  // If the nearest bead is different from the original, use it.
  if (nearest.color.brand !== color.brand || nearest.color.code !== color.code) {
    return nearest.color;
  }

  // --- Fallback: more aggressive darkening ---
  const fallbackL = Math.max(MIN_LIGHTNESS, lab.L - DARKEN_FALLBACK);
  const fallbackRgb = labToRgb(fallbackL, lab.a, lab.b);
  const fallbackNearest = findNearestColor(
    fallbackRgb.r,
    fallbackRgb.g,
    fallbackRgb.b,
    palette,
  );

  return fallbackNearest.color;
}

// ---------------------------------------------------------------------------
// Main outline function
// ---------------------------------------------------------------------------

/**
 * Add an outline to the bead pattern for improved contrast.
 *
 * The algorithm:
 * 1. Detect edge cells in the pattern.
 * 2. For each edge cell, replace it with a darker version of its current
 *    colour (found via {@link darkenColor}).
 * 3. Rebuild colour counts and return the modified pattern.
 *
 * The input pattern is **not** mutated; a deep copy is returned.
 */
export function addOutline(pattern: BeadPattern, palette: BeadColor[]): BeadPattern {
  const result = clonePattern(pattern);
  const edges = detectEdges(pattern);

  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      if (!edges[y][x]) {
        continue;
      }

      const cell = result.grid[y][x];
      if (isTransparent(cell)) {
        continue;
      }

      const darkened = darkenColor(cell, palette);

      // Only replace if the darkened bead is actually different.
      if (darkened.brand !== cell.brand || darkened.code !== cell.code) {
        result.grid[y][x] = { ...darkened };
      }
    }
  }

  rebuildColorCounts(result);

  return result;
}

// ---------------------------------------------------------------------------
// Black outline mode
// ---------------------------------------------------------------------------

/**
 * Find the black bead colour from the palette.
 *
 * Searches for a bead named "Black" or "Jet Black".  Falls back to the
 * darkest colour in the palette (lowest L*) if no exact match is found.
 */
function findBlackBead(palette: BeadColor[]): BeadColor {
  // Prefer exact name match.
  for (const c of palette) {
    const name = c.nameEn.toLowerCase();
    if (name === 'black' || name === 'jet black') {
      return c;
    }
  }

  // Fallback: find the darkest bead (lowest lightness).
  let darkest: BeadColor = palette[0];
  let darkestL = Infinity;

  for (const c of palette) {
    const lab = rgbToLab(c.r, c.g, c.b);
    if (lab.L < darkestL) {
      darkestL = lab.L;
      darkest = c;
    }
  }

  return darkest;
}

/**
 * Add a black outline around colour edges by expanding the pattern outward.
 *
 * Algorithm:
 *   1. Detect colour edges (CIEDE2000 > {@link EDGE_COLOR_THRESHOLD}).
 *   2. Build a set of "outline positions" — for every edge cell, each
 *      4-connected neighbour direction that is *outside* the non-transparent
 *      subject (grid boundary or transparent neighbour) gets a black bead
 *      placed one step further out.
 *   3. Create an expanded grid (+2 width, +2 height), copy the original
 *      pattern into the centre (offset 1,1), and fill outline positions
 *      with black beads.
 *
 * The result is a pattern that is 2 beads wider and 2 beads taller than the
 * input, with black beads forming a clear outline around the subject
 * boundary.  Internal colour boundaries between two non-transparent regions
 * are *not* outlined (use the regular {@link addOutline} for that).
 *
 * The input pattern is **not** mutated.
 *
 * @param pattern The input bead pattern.
 * @param palette The full bead palette (used to locate the black bead).
 * @returns A new, expanded BeadPattern with black outline beads inserted.
 */
export function addBlackOutline(
  pattern: BeadPattern,
  palette: BeadColor[],
): BeadPattern {
  const { width, height, grid } = pattern;
  const black = findBlackBead(palette);

  // Create a transparent placeholder bead for empty border cells.
  const transparentBead: BeadColor = {
    brand: black.brand,
    code: '__transparent__',
    nameEn: 'Transparent',
    nameCn: '透明',
    hex: '#000000',
    r: 0,
    g: 0,
    b: 0,
  };

  // Expanded dimensions: +1 on each side.
  const newWidth = width + 2;
  const newHeight = height + 2;

  // Initialize expanded grid with transparent placeholders.
  const newGrid: BeadColor[][] = [];
  for (let y = 0; y < newHeight; y++) {
    const row: BeadColor[] = [];
    for (let x = 0; x < newWidth; x++) {
      row.push({ ...transparentBead });
    }
    newGrid.push(row);
  }

  // Copy original pattern into the centre (offset by 1,1).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      newGrid[y + 1][x + 1] = { ...grid[y][x] };
    }
  }

  // For every non-transparent cell, check its 4 neighbours.  If a neighbour
  // is outside the original grid or is transparent, that direction is an
  // "exterior edge".  We also check for significant colour differences
  // (CIEDE2000 > threshold) to catch edges between the subject and a
  // coloured background.
  //
  // For each exterior edge, place a black bead in the expanded grid at the
  // position one step outside the current cell (which lands in the border
  // zone, or on a transparent cell).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (isTransparent(cell)) {
        continue;
      }

      const cellLab = rgbToLab(cell.r, cell.g, cell.b);

      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];

        let isExteriorEdge = false;

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          // Neighbour is outside the original grid boundary.
          isExteriorEdge = true;
        } else {
          const neighbour = grid[ny][nx];
          if (isTransparent(neighbour)) {
            isExteriorEdge = true;
          } else {
            // Check colour difference — a large difference against a
            // background region also counts as an exterior edge.
            const neighbourLab = rgbToLab(neighbour.r, neighbour.g, neighbour.b);
            if (ciede2000(cellLab, neighbourLab) > EDGE_COLOR_THRESHOLD) {
              isExteriorEdge = true;
            }
          }
        }

        if (isExteriorEdge) {
          // Position in expanded grid: the neighbour's position.
          const expX = nx + 1;
          const expY = ny + 1;

          // Only place black if the expanded-grid cell is still transparent
          // (don't overwrite original beads that were copied in).
          if (
            expX >= 0 && expX < newWidth &&
            expY >= 0 && expY < newHeight &&
            isTransparentOrPlaceholder(newGrid[expY][expX])
          ) {
            newGrid[expY][expX] = { ...black };
          }
        }
      }
    }
  }

  // Build colour counts for the new grid.
  const colorCounts = new Map<string, { color: BeadColor; count: number }>();
  let totalBeads = 0;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const cell = newGrid[y][x];
      if (!isTransparentOrPlaceholder(cell)) {
        totalBeads++;
        const key = `${cell.brand}:${cell.code}`;
        const existing = colorCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          colorCounts.set(key, { color: { ...cell }, count: 1 });
        }
      }
    }
  }

  return {
    width: newWidth,
    height: newHeight,
    grid: newGrid,
    colorCounts,
    totalBeads,
  };
}

/**
 * Check whether a bead is transparent or the internal placeholder used
 * during grid expansion.
 */
function isTransparentOrPlaceholder(bead: BeadColor): boolean {
  if (bead.code === '__transparent__') {
    return true;
  }
  return isTransparent(bead);
}
