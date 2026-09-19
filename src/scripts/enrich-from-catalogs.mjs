import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const productsPath = path.join(root, 'src', 'data', 'products.json');
const catalogSourcesPath = path.join(root, 'src', 'data', 'catalog-sources.json');
const catalogPagesPath = path.join(root, 'src', 'data', 'catalog-pages.json');
const catalogsDir = '/Users/muhammadjonaka/MN OG MAC v/каталоги';

const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
const sources = JSON.parse(fs.readFileSync(catalogSourcesPath, 'utf8'));
const catalogPages = JSON.parse(fs.readFileSync(catalogPagesPath, 'utf8'));

// Cache extracted text per catalog and page
const pageTextCache = new Map();
function getPageText(catalogKey, page) {
  const cacheKey = `${catalogKey}_${page}`;
  if (pageTextCache.has(cacheKey)) return pageTextCache.get(cacheKey);
  const source = sources[catalogKey];
  if (!source) return '';
  const pdfPath = path.join(catalogsDir, source.filename);
  if (!fs.existsSync(pdfPath)) return '';

  try {
    const text = execFileSync('pdftotext', ['-layout', '-f', String(page), '-l', String(page), pdfPath, '-'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });
    pageTextCache.set(cacheKey, text);
    return text;
  } catch (e) {
    return '';
  }
}

function cleanVal(str) {
  if (!str) return '';
  return str.trim().replace(/\s+/g, ' ');
}

function extractModelSpecsFromSubtable(lines, startLine, endLine, targetCol, modelToken) {
  const specs = {};
  const colStart = Math.max(0, targetCol - 4);
  const colEnd = targetCol + Math.max(modelToken.length + 4, 12);

  for (let i = startLine; i <= endLine && i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 15) continue;
    const label = line.slice(0, Math.min(32, line.length)).toLowerCase();
    
    let cell = cleanVal(line.slice(colStart, Math.min(line.length, colEnd)));
    if (!cell && colStart > 30) {
      const rest = cleanVal(line.slice(30));
      if (rest.length > 3 && (rest.includes('x') || rest.includes('х') || rest.includes('/') || rest.includes('R410') || rest.includes('220') || rest.includes('380'))) {
        cell = rest;
      }
    }
    if (!cell) continue;

    if ((label.includes('охлажден') || label.includes('холод')) && !specs.coolingCapacity) {
      const m = cell.match(/(\d+[.,]?\d*)/);
      if (m) specs.coolingCapacity = parseFloat(m[1].replace(',', '.'));
    } else if ((label.includes('нагрев') || label.includes('тепло')) && !specs.heatingCapacity) {
      const m = cell.match(/(\d+[.,]?\d*)/);
      if (m) specs.heatingCapacity = parseFloat(m[1].replace(',', '.'));
    } else if ((label.includes('потреб') || label.includes('мощность')) && !specs.powerConsumption) {
      const m = cell.match(/(\d+[.,]?\d*)/);
      if (m) specs.powerConsumption = parseFloat(m[1].replace(',', '.'));
    } else if ((label.includes('расход') || label.includes('воздух')) && !specs.airflow) {
      const m = cell.match(/(\d+[\s~–-]*\d+)/);
      if (m) specs.airflow = m[1].replace(/\s+/g, '');
      else specs.airflow = cell;
    } else if ((label.includes('звук') || label.includes('давлен') || label.includes('шум')) && !specs.noiseLevel) {
      const m = cell.match(/(\d+[\s~–-]*\d+)/);
      if (m) specs.noiseLevel = m[1].replace(/\s+/g, '');
    } else if ((label.includes('размер') || label.includes('шхвхг') || label.includes('габарит')) && !specs.dimensions) {
      const allDims = [...cell.matchAll(/(\d+\s*[xх]\s*\d+\s*[xх]\s*\d+)/gi)];
      if (allDims.length > 0) {
        specs.dimensions = allDims[allDims.length - 1][1].replace(/\s+/g, '');
      }
    } else if ((label.includes('вес') || label.includes('масса')) && !specs.weight) {
      const m = cell.match(/(\d+[.,]?\d*)/);
      if (m) specs.weight = parseFloat(m[1].replace(',', '.'));
    } else if (label.includes('жидк') && !specs.liquidPipe) {
      const m = cell.match(/(\d+[.,]?\d*\s*\([^)]*\)|\d+[.,]?\d*)/);
      if (m) specs.liquidPipe = m[1];
    } else if (label.includes('газ') && !specs.gasPipe) {
      const m = cell.match(/(\d+[.,]?\d*\s*\([^)]*\)|\d+[.,]?\d*)/);
      if (m) specs.gasPipe = m[1];
    } else if ((label.includes('электро') || label.includes('питан')) && !specs.powerSupply) {
      if (cell.includes('380') || cell.includes('380-415')) specs.powerSupply = '380-415В / 50Гц / 3Ф';
      else if (cell.includes('220') || cell.includes('220-240')) specs.powerSupply = '220-240В / 50Гц / 1Ф';
      else specs.powerSupply = cell.replace(/^[^\d]*/, '').trim();
    } else if ((label.includes('хладагент') || label.includes('фреон')) && !specs.refrigerant) {
      if (cell.includes('R410') || cell.includes('410')) specs.refrigerant = 'R410A';
      else if (cell.includes('R32') || cell.includes('32')) specs.refrigerant = 'R32';
      else specs.refrigerant = cell;
    }
  }

  return specs;
}

function parseModelSpecs(pageText, rawModel) {
  const lines = pageText.split('\n');
  const cleanModel = rawModel.replace(/[^a-zA-Z0-9]/g, '');
  const digits = rawModel.match(/\d{2,4}/)?.[0];

  const modelHeaderLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('модель') || lines[i].toLowerCase().includes('артикул')) {
      modelHeaderLines.push(i);
    }
  }
  if (modelHeaderLines.length === 0) modelHeaderLines.push(0);

  for (let t = 0; t < modelHeaderLines.length; t++) {
    const subStart = modelHeaderLines[t];
    const subEnd = (t + 1 < modelHeaderLines.length) ? modelHeaderLines[t + 1] - 1 : lines.length - 1;

    for (let i = subStart; i <= Math.min(subStart + 5, subEnd); i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';

      // Try matching full model name or full prefix with digits
      let pos = -1;
      let token = '';

      if (line.includes(cleanModel)) {
        pos = line.indexOf(cleanModel);
        token = cleanModel;
      } else if (rawModel.includes('-') && line.includes(rawModel.split('-')[1])) {
        const p2 = rawModel.split('-')[1];
        pos = line.indexOf(p2);
        token = p2;
      } else if (digits && line.includes(digits)) {
        // Find which occurrence of digits matches the model prefix
        const prefix = rawModel.slice(0, 5).toLowerCase();
        if ((line + nextLine).toLowerCase().includes(prefix)) {
          // Find the exact word containing digits
          const words = line.split(/\s+/).filter(Boolean);
          const matchingWord = words.find(w => w.includes(digits) && (w.toLowerCase().includes(prefix.slice(0, 3)) || w.startsWith(digits)));
          if (matchingWord) {
            pos = line.indexOf(matchingWord);
            token = matchingWord;
          }
        }
      }

      if (pos !== -1 && token) {
        const specs = extractModelSpecsFromSubtable(lines, subStart, subEnd, pos, token);
        if (specs && Object.keys(specs).length > 0) return specs;
      }
    }
  }

  return null;
}

let enriched = 0;
for (const product of products) {
  const match = catalogPages.products[product.id];
  if (!match) continue;

  const pageText = getPageText(match.catalogKey, match.page);
  if (!pageText) continue;

  const specs = parseModelSpecs(pageText, product.model);
  if (specs && Object.keys(specs).length > 0) {
    if (specs.coolingCapacity) product.coolingCapacity = specs.coolingCapacity;
    if (specs.heatingCapacity) product.heatingCapacity = specs.heatingCapacity;
    if (specs.powerConsumption) product.powerConsumption = specs.powerConsumption;
    if (specs.airflow) product.airflow = specs.airflow;
    if (specs.noiseLevel) product.noiseLevel = specs.noiseLevel;
    if (specs.dimensions) product.dimensions = specs.dimensions;
    if (specs.weight) product.weight = specs.weight;
    if (specs.liquidPipe) product.liquidPipe = specs.liquidPipe;
    if (specs.gasPipe) product.gasPipe = specs.gasPipe;
    if (specs.powerSupply) product.powerSupply = specs.powerSupply;
    if (specs.refrigerant) product.refrigerant = specs.refrigerant;
    enriched++;
  }
}

console.log(`Successfully enriched ${enriched} models with precise catalog specifications!`);
fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
