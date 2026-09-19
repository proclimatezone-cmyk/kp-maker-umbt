import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const productsPath = path.join(__dirname, '..', 'data', 'products.json');
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

export function resolveRealisticImage(p) {
  // If product already has a real specific image that isn't placeholder
  if (p.image && !p.image.includes('placeholder.png') && fs.existsSync(path.join(__dirname, '..', '..', 'public', p.image.replace(/^\//, '')))) {
    return p.image;
  }

  const hay = `${p.category || ''} ${p.series || ''} ${p.name || ''} ${p.model || ''}`.toLowerCase();
  const model = (p.model || '').toLowerCase();

  // 1. Refnet / Branches
  if (hay.includes('разветвитель') || hay.includes('refnet') || model.startsWith('fqz')) {
    return '/images/products/16Xte96EFOqvrQ9N2iZgq_9-8CD3nZk85.png';
  }

  // 2. Rooftops
  if (hay.includes('rooftop') || hay.includes('крышн') || hay.includes('clima creator')) {
    return '/images/products/rooftop-clima.png';
  }

  // 3. AHU-Kit / HRV
  if (hay.includes('ahu') || hay.includes('приточн') || hay.includes('hrv') || model.startsWith('ahukz')) {
    return '/images/products/ahu-kit.png';
  }

  // 4. Water-cooled VRF
  if (hay.includes('водяное') || hay.includes('v4+ w') || model.includes('w/rn1')) {
    return '/images/products/v4w-water-cooled.png';
  }

  // 5. ATOM T heat pumps / tanks
  if (hay.includes('atom t') || hay.includes('гвс') || hay.includes('гидромодуль') || hay.includes('бак')) {
    return '/images/products/atom-t.png';
  }

  // 6. Chillers
  if (hay.includes('чиллер') || hay.includes('chiller') || hay.includes('aqua thermal') || model.startsWith('mc-') || model.startsWith('aqua')) {
    return '/images/products/chiller-aqua.png';
  }

  // 7. Heat pumps (M Thermal / Pool)
  if (hay.includes('тепловой насос') || hay.includes('m thermal') || hay.includes('бассейн') || hay.includes('mars')) {
    return '/images/products/1GIyfhFdtk7-vmem9nkTRyay547bcmgEu.png';
  }

  // 8. Atom B kits
  if (hay.includes('atom b') && hay.includes('кассет')) {
    return '/images/manual/cas-atom-b.png';
  }
  if (hay.includes('atom b') && hay.includes('канал')) {
    return '/images/manual/duct-atom-b.png';
  }

  // 9. Outdoor VRF units
  if (hay.includes('v8 master') || hay.includes('v8s') || (hay.includes('v8') && hay.includes('наружный')) || model.startsWith('mv8')) {
    return '/images/products/1f_lFlRNEcVxXB47oOAg4B3eZnh7kaSoI.png';
  }
  if (hay.includes('mini-vrf') || hay.includes('mini c') || hay.includes('mvi') || model.startsWith('mvi-')) {
    return '/images/products/1B9cIw4WHso6oUUKuRbPY4dS4T_jpNRjy.png';
  }
  if (hay.includes('v6r') || hay.includes('v6-i') || hay.includes('vc-i') || hay.includes('mvc')) {
    return '/images/products/1OJk2PgJ958tZthzIAI24zMOOwsJ46b4Y.png';
  }
  if (hay.includes('atom') && hay.includes('наружный')) {
    return '/images/products/1ZsneXTFxjuOxyIsL6PcEQUsuWGrMt_Hi.png';
  }

  // 10. FCU (Fan coils)
  if (hay.includes('фанкойл') || model.startsWith('mk')) {
    if (hay.includes('кассет') || model.startsWith('mka') || model.startsWith('mkd')) {
      return '/images/products/1sXaLxea_jWHqGKweTTtXWzPgyDYewho7.jpg';
    }
    if (hay.includes('напольно-потолочн') || hay.includes('напольн') || model.startsWith('mkh')) {
      return '/images/products/1TT1Xr-Xpt1dmYWMK8hVOlCRzcflXW3G0.jpg';
    }
    if (hay.includes('4-х') || hay.includes('4-ряд') || model.startsWith('mkt4')) {
      return '/images/products/1G_qMZZUpiPUPQGim2oLuFtdZ1D44OMl8.jpg';
    }
    return '/images/products/1VqqiScP5oGEl4WKv4MNQzAFzqBrIwKXm.jpg';
  }

  // 11. Indoor VRF units
  if (hay.includes('кассетный 1-поточный') || model.includes('q1')) {
    return '/images/products/1sga2V-XXQ7pyG4GOFtyo6LUTR2mT_Myk.png';
  }
  if (hay.includes('кассетный') || model.includes('q4') || model.includes('q2')) {
    return '/images/products/14FPwgNd0VJpYpib0UabCHJWRe-LTb5Ft.png';
  }
  if (hay.includes('настенный') || model.includes('gdh')) {
    return '/images/products/1UEfwU6bgLsbifXQaflvkxOgKYFqvrxQc.png';
  }
  if (hay.includes('канальный') || model.includes('t1') || model.includes('t2') || model.includes('t3')) {
    return '/images/products/1j37_gSERZBDgYQNjzMd42QHZVwTrERRs.png';
  }
  if (hay.includes('напольный') || hay.includes('напольно-потолочный') || model.includes('dl') || model.includes('f1')) {
    return '/images/products/1TT1Xr-Xpt1dmYWMK8hVOlCRzcflXW3G0.jpg';
  }

  // 12. Split / Unitary / Quantum
  if (hay.includes('unitary') || hay.includes('quantum') || hay.includes('сплит')) {
    return '/images/products/1dcX4fUmN10OsV3ix_sRMPjirFDvxedl7.png';
  }

  // 13. Controllers / Automatics
  if (hay.includes('пульт') || hay.includes('автоматика') || hay.includes('контроллер') || model.startsWith('ccm') || model.startsWith('wdc') || model.startsWith('kjr')) {
    return '/images/products/ahu-kit.png';
  }

  return '/images/products/14FPwgNd0VJpYpib0UabCHJWRe-LTb5Ft.png';
}

let updated = 0;
for (const p of products) {
  const newImg = resolveRealisticImage(p);
  if (p.image !== newImg) {
    p.image = newImg;
    updated++;
  }
}

fs.writeFileSync(productsPath, JSON.stringify(products, null, 2) + '\n');
console.log(`Updated ${updated} products with realistic images.`);
