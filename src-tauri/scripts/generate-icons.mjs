// Package the approved brand image as native macOS resources, without changing
// the source artwork. Run from the project root: node src-tauri/scripts/generate-icons.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const iconDirectory = fileURLToPath(new URL('../icons/', import.meta.url));
const source = await readFile(new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url));
await mkdir(iconDirectory, { recursive: true });
// Tauri codegen expects RGBA PNG input. The alpha channel stays fully opaque.
const png = size => sharp(source).resize(size, size).flatten({ background: '#00180f' }).ensureAlpha().png().toBuffer();
for (const [name, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) {
  await writeFile(new URL(`../icons/${name}`, import.meta.url), await png(size));
}
const chunks = [];
for (const [type, size] of [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
  const data = await png(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  chunks.push(header, data);
}
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(chunks.reduce((total, chunk) => total + chunk.length, 8), 4);
await writeFile(new URL('../icons/icon.icns', import.meta.url), Buffer.concat([header, ...chunks]));
// Windows ICO accepts PNG-compressed entries, including a full 256px image.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const icoHeader = Buffer.alloc(6 + 16 * sizes.length);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(sizes.length, 4);
let offset = icoHeader.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  icoHeader[entry] = sizes[index] === 256 ? 0 : sizes[index];
  icoHeader[entry + 1] = icoHeader[entry];
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(images[index].length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile(new URL('../icons/icon.ico', import.meta.url), Buffer.concat([icoHeader, ...images]));
console.log('Generated native icons from the existing OpenCalendar artwork.');
