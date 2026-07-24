const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'));

async function splash(w, h, out) {
  const logoSize = Math.round(Math.min(w, h) * 0.22);
  const logo = await sharp(svg).resize(logoSize, logoSize).png().toBuffer();
  await sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(path.join(root, 'public', out));
}

async function main() {
  // Common iPhone startup images (portrait)
  await splash(1290, 2796, 'splash-1290x2796.png'); // 14/15 Pro Max
  await splash(1179, 2556, 'splash-1179x2556.png'); // 14/15 Pro
  await splash(1170, 2532, 'splash-1170x2532.png'); // 12/13/14
  await splash(1125, 2436, 'splash-1125x2436.png'); // X/XS/11 Pro
  console.log('splash written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
