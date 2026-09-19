import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const vrf = '/Users/muhammadjonaka/MN OG MAC v/каталоги/Katalog Midea VRF 2026_Web.pdf';
const chiller = '/Users/muhammadjonaka/MN OG MAC v/каталоги/Каталог Midea CHILLER 2026_Web.pdf';
const atom = '/Users/muhammadjonaka/MN OG MAC v/каталоги/Katalog Midea_2026_ATOM.pdf';

const tempDir = '/tmp/midea-images';
fs.mkdirSync(tempDir, { recursive: true });

const extractions = [
  ['rooftop', vrf, 138, 140],
  ['ahu', vrf, 125, 126],
  ['controllers', vrf, 17, 18],
  ['v4w', vrf, 120, 121],
  ['hrv', vrf, 94, 96],
  ['v8black', vrf, 78, 82],
  ['atom_t', atom, 10, 12],
  ['chiller_aqua', chiller, 21, 23],
];

for (const [name, file, f, l] of extractions) {
  const prefix = path.join(tempDir, name);
  try {
    execFileSync('pdfimages', ['-png', '-f', String(f), '-l', String(l), file, prefix]);
  } catch (e) {
    console.error(`Failed ${name}:`, e.message);
  }
}

const files = fs.readdirSync(tempDir);
console.log(`Extracted ${files.length} images to ${tempDir}`);
const largeFiles = files.filter(f => fs.statSync(path.join(tempDir, f)).size > 20000);
console.log('Significant images:', largeFiles);
