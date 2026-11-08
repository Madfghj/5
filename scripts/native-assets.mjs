// Export app-size PNG resources from the approved generated brand image.
// Run: node scripts/native-assets.mjs [absolute-path-to-sharp-package]
// Requires sharp locally or the optional package path; no network or SDK download.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require(process.argv[2] || 'sharp');
} catch {
  throw new Error('Install sharp in your development environment, or pass its absolute package path.');
}
const opaqueIcon = await readFile(resolve(root, 'public/brand-logo.png'));
const foregroundColor = '#00180f';
const adaptive = await sharp({create:{width:192,height:192,channels:3,background:foregroundColor}})
  .composite([{input:await sharp(opaqueIcon).resize(128,128).png().toBuffer(),gravity:'centre'}]).png().toBuffer();
const splashColor = '#f7f6f2';
let count = 0;
async function save(path, buffer) {
  const output = resolve(root, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, buffer);
  count++;
}
async function icon(size) {
  return sharp(opaqueIcon).resize(size, size).flatten({ background: foregroundColor }).png().toBuffer();
}
async function splash(width, height) {
  const size = Math.round(Math.min(width, height) * 0.20);
  const logo = await sharp(opaqueIcon).resize(size, size).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background: splashColor } })
    .composite([{ input: logo, gravity: 'centre' }]).png().toBuffer();
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [density, scale] of Object.entries(densities)) {
  const directory = `android/app/src/main/res/mipmap-${density}`;
  const launcher = await icon(Math.round(48 * scale));
  await save(`${directory}/ic_launcher.png`, launcher);
  await save(`${directory}/ic_launcher_round.png`, launcher);
  await save(`${directory}/ic_launcher_foreground.png`, await sharp(adaptive).resize(Math.round(108 * scale)).png().toBuffer());
}

const androidRes = resolve(root, 'android/app/src/main/res');
for (const item of await readdir(androidRes, { withFileTypes: true })) {
  if (!item.isDirectory() || !item.name.startsWith('drawable')) continue;
  const path = `android/app/src/main/res/${item.name}/splash.png`;
  try {
    const metadata = await sharp(await readFile(resolve(root, path))).metadata();
    await save(path, await splash(metadata.width, metadata.height));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await save('public/icon-192.png', await icon(192));
await save('public/icon-512.png', await icon(512));
await save('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', await icon(1024));
const iosSplash = await splash(2732, 2732);
for (const filename of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await save(`ios/App/App/Assets.xcassets/Splash.imageset/${filename}`, iosSplash);
}
console.log(`Exported ${count} brand icon and splash resources.`);
