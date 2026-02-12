/**
 * DEPRECATED — Use generate-icons.js instead.
 *
 * The master icon SVG now lives at build/icon.svg (hand-crafted recursive
 * trinity design). This script is kept for backwards compatibility and
 * simply forwards to the new multi-size generator.
 *
 * Usage: node scripts/generate-icons.js
 */

console.log('generate-icon.js is deprecated.');
console.log('The master SVG is already at build/icon.svg.');
console.log('');
console.log('To generate PNG icons at all sizes, run:');
console.log('  node scripts/generate-icons.js');
console.log('');
console.log('Forwarding to generate-icons.js...');
console.log('');

require('./generate-icons');
