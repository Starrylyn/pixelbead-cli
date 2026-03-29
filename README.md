# pixelbead 🎨

Convert images into perler bead (拼豆) patterns with accurate color matching.

![pixelbead demo](https://img.shields.io/badge/pixelbead-CLI-blue)

> Built with [AutoClaw](https://autoglm.zhipuai.cn/autoclaw/) — an AI-powered coding agent.

## Features

- **Multi-Brand Palettes** — Built-in color databases for Artkal, Hama, Perler, MARD, COCO
- **Perceptual Color Matching** — CIEDE2000 color distance in Lab color space (not naive RGB)
- **Noise Cleaning** — BFS connected-component detection removes stray pixels
- **Background Removal** — Flood-fill from edges to detect and remove solid backgrounds
- **Outline Enhancement** — Darker shade outlines for better contrast
- **Floyd-Steinberg Dithering** — Smoother gradients when palette is limited
- **Max Color Limit** — Restrict the number of distinct bead colors used
- **Multiple Output Formats** — Terminal preview, PNG grid image, PDF printable template
- **Material List** — Bill of materials with color codes, names, bead counts

## Install

```bash
npm install
npm run build
```

## Usage

```bash
# Basic — terminal preview (Artkal, 29x29)
node dist/index.js convert input.png

# Specify brand and board size
node dist/index.js convert input.png -b hama --board 39x39

# Output PNG grid with color codes
node dist/index.js convert input.png -b artkal --board 100x100 -o pattern.png

# Output PDF printable template
node dist/index.js convert input.png -b perler --board 39x39 -o pattern.pdf

# Control color count and noise
node dist/index.js convert input.png --max-colors 25 --merge-threshold 15 --remove-bg

# Enable dithering and outline
node dist/index.js convert input.png --dither --outline -o pattern.png

# Use only specific colors you own
node dist/index.js convert input.png -b artkal --colors C-1,C-2,C-15,C-48,C-77

# List available brands
node dist/index.js brands

# Show all colors for a brand
node dist/index.js palette -b artkal

# Generate demo patterns
node dist/index.js demo -o ./demo/
```

## Board Sizes

| Size | Beads | Boards (29×29) | Best For |
|------|-------|----------------|----------|
| 29×29 | 841 | 1 | Simple icons |
| 39×39 | 1,521 | 2 | Small patterns |
| 58×58 | 3,364 | 4 | Detailed icons |
| 80×80 | 6,400 | 8 | Photos (good) |
| 100×100 | 10,000 | 12 | Photos (great) ⭐ |
| 120×120 | 14,400 | 17 | Photos (finest) |
| 200×200 | 40,000 | 48 | Maximum detail |

**Sweet spot**: 100×100 for photo-quality patterns with manageable bead count.

## Supported Brands

| Brand | Colors | Type |
|-------|--------|------|
| Artkal (C series) | 81 | 2.6mm mini |
| Hama (midi) | 65 | 5mm standard |
| Perler | 66 | 5mm standard |
| MARD (咪小窝) | 69 | 2.6mm mini |
| COCO (可可) | 69 | 2.6mm mini |

## Output Examples

### Terminal Preview
Rich ANSI 24-bit color output showing the bead pattern at a glance.

### PNG Grid
Clean grid image with:
- Color code labels in each cell
- Grid lines separating bead positions
- Color legend with swatches
- Material list with bead counts
- Board boundary markers

### PDF Template
Printable A4 PDF with:
- Grid pattern with color codes
- Multi-page support for large patterns
- Color legend and material list
- Board coordinates

## How It Works

1. **Load & Resize** — Image is loaded with `sharp` and resized to the target board dimensions using Lanczos3 interpolation
2. **Color Sampling** — Each grid cell samples the dominant color (most frequent pixel), avoiding gray halos at color boundaries
3. **Color Matching** — CIEDE2000 perceptual color distance finds the nearest bead color in Lab color space
4. **Post-Processing** — Noise cleaning (BFS), background removal (flood-fill), outline enhancement, optional dithering
5. **Color Limiting** — Merges least-used colors into their nearest popular neighbors
6. **Rendering** — Outputs terminal preview, PNG grid, or PDF template

## Tech Stack

- **TypeScript** — Full type safety
- **sharp** — Image loading and Lanczos3 resizing
- **@napi-rs/canvas** — PNG grid rendering with text labels
- **pdfkit** — PDF template generation
- **chalk** — Terminal color output
- **commander** — CLI argument parsing

## License

MIT

---

<p align="center">
  Built with 🤖 <a href="https://autoglm.zhipuai.cn/autoclaw/">AutoClaw</a>
</p>
