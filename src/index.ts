#!/usr/bin/env node

import { Command } from 'commander';
import { runConvert, ConvertOptions } from './cli/convert';
import { runDemo } from './cli/demo';
import { getPalette, getAllBrands, BrandName } from './palettes';
import { renderTerminalPaletteList } from './output/terminal';

const program = new Command();

program
  .name('pixelbead')
  .description('Convert images into perler bead (拼豆) patterns')
  .version('1.0.0');

// Convert command
program
  .command('convert <input>')
  .description('Convert an image to a bead pattern')
  .option('-b, --brand <brand>', 'Bead brand (artkal, hama, perler, mard, coco)', 'artkal')
  .option('--board <size>', 'Board size (29x29, 39x39, 29x58, or WxH)', '29x29')
  .option('-o, --output <path>', 'Output file path (.png or .pdf)')
  .option('--max-colors <n>', 'Maximum number of distinct bead colors', parseInt)
  .option('--merge-threshold <n>', 'Noise cleaning threshold (component size)', parseInt)
  .option('--remove-bg', 'Remove solid background automatically')
  .option('--dither', 'Enable Floyd-Steinberg dithering')
  .option('--outline', 'Add outline enhancement for better contrast')
  .option('--outline-black', 'Add black outline around edges (expands pattern by 2 beads)')
  .option('--minimize-colors <n>', 'Merge similar colors down to N distinct colors', parseInt)
  .option('--colors <codes>', 'Comma-separated list of bead color codes to use')
  .option('--multi-board', 'Enable multi-board tiling for large images')
  .option('--materials-only', 'Only output the material list')
  .option('--no-labels', 'Hide color codes in grid cells (preview mode)')
  .option('--no-legend', 'Hide color legend in PNG/PDF output')
  .option('--no-materials', 'Hide materials list in PNG/PDF output')
  .option('--clean', 'Clean output: no labels, no legend, no materials (image only)')
  .action(async (input: string, opts: Record<string, unknown>) => {
    const isClean = opts.clean as boolean | undefined;
    const options: ConvertOptions = {
      brand: (opts.brand as string || 'artkal') as BrandName,
      board: opts.board as string || '29x29',
      output: opts.output as string | undefined,
      maxColors: opts.maxColors as number | undefined,
      mergeThreshold: opts.mergeThreshold as number | undefined,
      removeBg: opts.removeBg as boolean | undefined,
      dither: opts.dither as boolean | undefined,
      outline: opts.outline as boolean | undefined,
      outlineBlack: opts.outlineBlack as boolean | undefined,
      minimizeColorsTarget: opts.minimizeColors as number | undefined,
      colors: opts.colors as string | undefined,
      multiBoard: opts.multiBoard as boolean | undefined,
      materialsOnly: opts.materialsOnly as boolean | undefined,
      noLabels: isClean || opts.labels === false ? true : false,
      noLegend: isClean || opts.legend === false ? true : false,
      noMaterials: isClean || opts.materials === false ? true : false,
    };
    await runConvert(input, options);
  });

// Palette command
program
  .command('palette')
  .description('List available bead colors for a brand')
  .option('-b, --brand <brand>', 'Bead brand', 'artkal')
  .option('-f, --format <format>', 'Output format (table, json, csv)', 'table')
  .action((opts: Record<string, unknown>) => {
    const brandName = (opts.brand as string || 'artkal').toLowerCase();
    const format = (opts.format as string || 'table').toLowerCase();

    try {
      const palette = getPalette(brandName as BrandName);

      if (format === 'json') {
        console.log(JSON.stringify(palette, null, 2));
      } else if (format === 'csv') {
        console.log('Code,Name_EN,Name_CN,Hex,R,G,B');
        for (const c of palette.colors) {
          console.log(`${c.code},${c.nameEn},${c.nameCn},${c.hex},${c.r},${c.g},${c.b}`);
        }
      } else {
        console.log(renderTerminalPaletteList(palette));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error: ${msg}\n`);
      process.stderr.write(`Available brands: ${getAllBrands().join(', ')}\n`);
      process.exitCode = 1;
    }
  });

// Demo command
program
  .command('demo')
  .description('Generate sample demo patterns showcasing all features')
  .option('-o, --output <dir>', 'Output directory', './demo')
  .action(async (opts: Record<string, unknown>) => {
    await runDemo({ output: opts.output as string || './demo' });
  });

// Brands command
program
  .command('brands')
  .description('List all available bead brands')
  .action(() => {
    const brands = getAllBrands();
    console.log('Available bead brands:');
    console.log('');
    for (const b of brands) {
      const p = getPalette(b);
      console.log(`  ${b.padEnd(10)} ${p.brandCn.padEnd(8)} ${p.beadSize}  (${p.colors.length} colors)`);
    }
  });

program.parse();
