// Regenerate native branding from the shared SVG sources. No models or APKs enter Git.
import sharp from 'sharp';
import { readFile, readdir, writeFile } from 'node:fs/promises';
const res = 'android/app/src/main/res';
const icon = await readFile('public/icon.svg');
const maskable = await readFile('public/icon-maskable.svg', 'utf8');
const foreground = Buffer.from(maskable.replace(/<rect\b[^>]*fill="#2b44d6"[^>]*\/>/, ''));
for (const [density, scale] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
  const dir = `${res}/mipmap-${density}`;
  for (const file of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await sharp(icon).resize(Math.round(48 * scale)).png().toFile(`${dir}/${file}`);
  }
  await sharp(foreground).resize(Math.round(108 * scale)).png().toFile(`${dir}/ic_launcher_foreground.png`);
}
await writeFile(`${res}/values/ic_launcher_background.xml`, '<resources><color name="ic_launcher_background">#2b44d6</color><color name="veil_warm">#f5f1eb</color></resources>\n');
for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  await writeFile(`${res}/mipmap-anydpi-v26/${file}`, '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n');
}
await sharp(icon).resize(384).png().toFile(`${res}/drawable/veil_splash_icon.png`);
for (const dir of await readdir(res)) {
  if (!dir.startsWith('drawable') || !(await readdir(`${res}/${dir}`)).includes('splash.png')) continue;
  const width = dir.includes('-land-') ? 1280 : 720;
  const height = dir.includes('-land-') ? 720 : 1280;
  const mark = await sharp(icon).resize(192).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: '#f5f1eb' } })
    .composite([{ input: mark, gravity: 'centre' }]).png().toFile(`${res}/${dir}/splash.png`);
}
console.log('Android branding generated from icon.svg / icon-maskable.svg.');
