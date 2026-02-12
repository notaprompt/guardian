/**
 * Generate Guardian icon set from master SVG.
 *
 * Produces PNG icons at standard sizes: 16, 32, 48, 64, 128, 256, 512.
 * Also creates icon.png (256x256) in build/ for electron-builder.
 *
 * Usage:
 *   npm install sharp        (one-time, adds ~2MB)
 *   node scripts/generate-icons.js
 *
 * If sharp is not available, falls back to documenting manual conversion steps.
 *
 * Output:
 *   build/icon.png           — 256x256 primary icon
 *   build/icons/icon-16.png
 *   build/icons/icon-32.png
 *   build/icons/icon-48.png
 *   build/icons/icon-64.png
 *   build/icons/icon-128.png
 *   build/icons/icon-256.png
 *   build/icons/icon-512.png
 *
 * For .ico (Windows):
 *   npx png-to-ico build/icons/icon-256.png > build/icon.ico
 *
 * electron-builder will also auto-convert icon.png to .ico on Windows.
 */

const fs = require('fs');
const path = require('path');

const SIZES = [16, 32, 48, 64, 128, 256, 512];
const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICONS_DIR = path.join(BUILD_DIR, 'icons');
const SVG_PATH = path.join(BUILD_DIR, 'icon.svg');

async function generateWithSharp() {
  const sharp = require('sharp');
  const svgBuffer = fs.readFileSync(SVG_PATH);

  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`  Created: build/icons/icon-${size}.png`);
  }

  // Also copy 256 as the primary icon.png for electron-builder
  const primaryPath = path.join(BUILD_DIR, 'icon.png');
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(primaryPath);
  console.log('  Created: build/icon.png (256x256 primary)');

  console.log('');
  console.log('Icon generation complete.');
  console.log('');
  console.log('To create icon.ico for Windows packaging:');
  console.log('  npx png-to-ico build/icons/icon-256.png > build/icon.ico');
}

function printManualInstructions() {
  console.log('');
  console.log('sharp is not installed. To generate PNGs automatically:');
  console.log('  npm install sharp');
  console.log('  node scripts/generate-icons.js');
  console.log('');
  console.log('Manual conversion alternatives:');
  console.log('  1. Use Inkscape CLI:');
  for (const size of SIZES) {
    console.log(`     inkscape build/icon.svg -w ${size} -h ${size} -o build/icons/icon-${size}.png`);
  }
  console.log('');
  console.log('  2. Use ImageMagick:');
  for (const size of SIZES) {
    console.log(`     magick convert -background none -resize ${size}x${size} build/icon.svg build/icons/icon-${size}.png`);
  }
  console.log('');
  console.log('  3. Use rsvg-convert (librsvg):');
  for (const size of SIZES) {
    console.log(`     rsvg-convert -w ${size} -h ${size} build/icon.svg > build/icons/icon-${size}.png`);
  }
  console.log('');
  console.log('After generating PNGs, create .ico for Windows:');
  console.log('  npx png-to-ico build/icons/icon-256.png > build/icon.ico');
}

async function main() {
  console.log('Guardian Icon Generator');
  console.log('======================');
  console.log('');

  if (!fs.existsSync(SVG_PATH)) {
    console.error('Error: build/icon.svg not found.');
    console.error('Run this script from the guardian-ui project root.');
    process.exit(1);
  }

  console.log('Source: build/icon.svg');
  console.log(`Sizes: ${SIZES.join(', ')}px`);
  console.log('');

  try {
    require.resolve('sharp');
    console.log('Using sharp for SVG-to-PNG conversion...');
    console.log('');
    await generateWithSharp();
  } catch (_) {
    console.log('sharp not found — printing manual instructions.');
    printManualInstructions();
  }
}

main().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
