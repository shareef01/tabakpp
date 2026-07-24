const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'public', 'favicon.svg'));

async function main() {
  await sharp(svg).resize(512, 512).png().toFile(path.join(root, 'public', 'icon-512.png'));
  await sharp(svg).resize(192, 192).png().toFile(path.join(root, 'public', 'icon-192.png'));
  await sharp(svg).resize(180, 180).png().toFile(path.join(root, 'public', 'apple-touch-icon.png'));
  console.log('icons written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
