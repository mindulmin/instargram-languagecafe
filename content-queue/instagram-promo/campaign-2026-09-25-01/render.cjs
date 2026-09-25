const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const dir = __dirname;
  const source = path.join(dir, 'artwork.svg');
  const output = path.join(dir, 'artwork-feed-1080x1350.jpg');
  const svg = fs.readFileSync(source);
  await sharp(svg, { density: 72 })
    .resize(1080, 1350, { fit: 'fill' })
    .flatten({ background: '#F8F6EE' })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(output);
  const metadata = await sharp(output).metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== 1080 || metadata.height !== 1350) {
    throw new Error('Unexpected image format or dimensions');
  }
  process.stdout.write(`${output} ${metadata.width}x${metadata.height}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
