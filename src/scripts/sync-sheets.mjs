import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { fileURLToPath } from 'url';
if (!process.env.GOOGLE_CLIENT_ID) {
  try {
    const dotenv = await import('dotenv');
    if (dotenv.default && dotenv.default.config) dotenv.default.config({ path: '.env.local' });
    else if (dotenv.config) dotenv.config({ path: '.env.local' });
  } catch (e) {}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CONFIGURATION ---
const SPREADSHEET_ID = '1O5aeKAbSc_UkDk7expSqaDO5dpUaQLyqWI40Vhp4MhE';
const RANGE = "'для кп'!A2:W"; 
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'products.json');
const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'images', 'products');
// ----------------------

const isVercel = process.env.VERCEL === '1';

if (!isVercel && !fs.existsSync(IMG_DIR)) {
  try {
    fs.mkdirSync(IMG_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create images directory:', err.message);
  }
}

// На Vercel файловая система под public/ доступна только на чтение — новые
// картинки туда не скачать (см. ветки isVercel ниже, которые вместо этого
// подставляют прямую ссылку на Drive). Но то, что уже закоммичено и
// задеплоено вместе с приложением, читать можно: раньше isVercel-ветка
// подставляла Drive-ссылку даже для товаров, чья картинка уже лежит в
// репозитории — и КП на проде каждый раз тянул её из Drive по сети (а при
// сбое API — без фото вовсе), хотя рядом на диске уже был готовый файл.
let existingImageFiles = null;
if (isVercel) {
  try {
    existingImageFiles = new Set(fs.existsSync(IMG_DIR) ? fs.readdirSync(IMG_DIR) : []);
  } catch (err) {
    console.warn('Could not read images directory on Vercel:', err.message);
    existingImageFiles = new Set();
  }
}

/** Уже закоммиченный файл `${id}.*` в public/images/products, если он есть. */
function findExistingLocalImage(id) {
  if (!existingImageFiles) return null;
  for (const name of existingImageFiles) {
    if (name.startsWith(`${id}.`)) return `/images/products/${name}`;
  }
  return null;
}

function getDriveFileId(url) {
  if (!url) return null;
  const idMatch = url.match(/[?&]id=([^&]+)/);
  if (idMatch) return idMatch[1];
  const dMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (dMatch) return dMatch[1];
  return null;
}

function getGoogleAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/presentations',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets'
      ]
    });
  }
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return auth;
}

export async function syncSheets() {
  console.log('--- STARTING SYNC WITH GOOGLE DRIVE IMAGES ---');

  const auth = getGoogleAuth();

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });
  try {
    console.log('Fetching data from Spreadsheet...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.warn('No data found in the spreadsheet.');
      return;
    }

    console.log(`Processing ${rows.length} rows...`);

    const products = [];
    const imageCache = new Map(); // To avoid re-downloading same images

    // Load existing products to populate imageCache and speed up sync dramatically
    try {
      if (fs.existsSync(OUTPUT_FILE)) {
        const existingData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        for (const p of existingData) {
          if (p.driveImage && p.image) {
            imageCache.set(p.driveImage, {
              localImagePath: p.image,
              slidesImage: p.slidesImage || p.image
            });
          }
        }
        console.log(`Loaded ${imageCache.size} cached images from existing products list.`);
      }
    } catch (err) {
      console.warn('Failed to load existing products cache:', err.message);
    }

    // Строка-разделитель «под заказ» в листе делит позиции на «есть на
    // складе» (выше) и «под заказ» (ниже, дольше ждать) — не отдельная
    // колонка, просто маркер в самой таблице. Ловим её тут и красим все
    // строки после неё, чтобы на сайте можно было фильтровать/подсвечивать.
    let orderOnlySection = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const category = row[0];
      const series = row[1];    // Column B = Series (e.g. MV8, MV9M)
      const model = row[2];     // Column C = Model
      const imageUrl = row[22]; // Column W = Photo URL
      const price = row[21];    // Column V = Price

      if (category && category.trim().toLowerCase() === 'под заказ') {
        orderOnlySection = true;
        continue;
      }

      if (!model) continue;

      const pId = model.toLowerCase().replace(/[^a-z0-9]/g, '-');
      let localImagePath = '/images/products/placeholder.png';
      let slidesImage = '';
      let forceDownload = false;
      
      // Fast path: check image cache by full URL first
      if (imageUrl && imageCache.has(imageUrl)) {
        const cached = imageCache.get(imageUrl);
        localImagePath = cached.localImagePath;
        slidesImage = cached.slidesImage;
      }
      // Handle Google Drive Folder/File URLs
      if (!slidesImage && imageUrl && imageUrl.includes('drive.google.com')) {
        try {
          let fileId = '';
          if (imageUrl.includes('folders/')) {
            const folderId = imageUrl.split('folders/')[1].split('?')[0];
            
            let cachedVal = imageCache.get(folderId);
            let isValid = true;
            if (cachedVal && cachedVal.slidesImage) {
              const checkId = getDriveFileId(cachedVal.slidesImage);
              if (checkId) {
                try {
                  await drive.files.get({ fileId: checkId, fields: 'id' });
                } catch (e) {
                  console.log(`[Cache Invalidation] Folder file ID ${checkId} no longer exists. Re-fetching.`);
                  isValid = false;
                }
              }
            } else {
              isValid = false;
            }

            if (isValid && cachedVal) {
              localImagePath = cachedVal.localImagePath;
              slidesImage = cachedVal.slidesImage;
            } else {
              imageCache.delete(folderId);
              forceDownload = true;
              console.log(`Listing files in folder: ${folderId}`);
              const folderFiles = await drive.files.list({
                q: `'${folderId}' in parents and mimeType contains 'image/'`,
                fields: 'files(id, name, fileExtension, thumbnailLink, mimeType)',
                pageSize: 10
              });
              
              if (folderFiles.data.files.length > 0) {
                // Prefer jpg/png over avif/webp for Slides API compatibility
                const preferred = folderFiles.data.files.find(f => 
                  f.mimeType === 'image/jpeg' || f.mimeType === 'image/png'
                ) || folderFiles.data.files[0];
                fileId = preferred.id;
                slidesImage = `https://drive.google.com/uc?id=${fileId}`;
                
                // Make file public
                try {
                  await drive.permissions.create({
                    fileId: fileId,
                    requestBody: { role: 'reader', type: 'anyone' }
                  });
                } catch (e) {
                  console.warn(`Could not set permissions for file ${fileId}: ${e.message}`);
                }

                if (isVercel) {
                  localImagePath = findExistingLocalImage(folderId) || slidesImage;
                } else {
                  const ext = folderFiles.data.files[0].fileExtension || 'png';
                  const fileName = `${folderId}.${ext}`;
                  const fullPath = path.join(IMG_DIR, fileName);
                  
                  if (forceDownload || !fs.existsSync(fullPath)) {
                    console.log(`Downloading image: ${fileName}`);
                    const dest = fs.createWriteStream(fullPath);
                    const res = await drive.files.get(
                      { fileId, alt: 'media' },
                      { responseType: 'stream' }
                    );
                    await new Promise((resolve, reject) => {
                      res.data
                        .on('end', () => resolve())
                        .on('error', err => reject(err))
                        .pipe(dest);
                    });
                  }
                  localImagePath = `/images/products/${fileName}`;
                }
                imageCache.set(folderId, { localImagePath, slidesImage });
                imageCache.set(imageUrl, { localImagePath, slidesImage });
              }
            }
          } else {
            // Handle direct file URLs
            if (imageUrl.includes('file/d/')) {
              fileId = imageUrl.split('file/d/')[1].split('/')[0];
            } else if (imageUrl.includes('id=')) {
              fileId = imageUrl.split('id=')[1].split('&')[0];
            }

            if (fileId) {
              let cachedVal = imageCache.get(fileId);
              let isValid = true;
              if (cachedVal && cachedVal.slidesImage) {
                const checkId = getDriveFileId(cachedVal.slidesImage);
                if (checkId) {
                  try {
                    await drive.files.get({ fileId: checkId, fields: 'id' });
                  } catch (e) {
                    console.log(`[Cache Invalidation] Direct file ID ${checkId} no longer exists. Re-fetching.`);
                    isValid = false;
                  }
                }
              } else {
                isValid = false;
              }

              if (isValid && cachedVal) {
                localImagePath = cachedVal.localImagePath;
                slidesImage = cachedVal.slidesImage;
              } else {
                imageCache.delete(fileId);
                forceDownload = true;
                slidesImage = `https://drive.google.com/uc?id=${fileId}`;
                
                // Make file public so Slides API can access the link
                try {
                  await drive.permissions.create({
                    fileId: fileId,
                    requestBody: { role: 'reader', type: 'anyone' }
                  });
                } catch (e) {
                  console.warn(`Could not set permissions for file ${fileId}: ${e.message}`);
                }

                if (isVercel) {
                  localImagePath = findExistingLocalImage(fileId) || slidesImage;
                } else {
                  const fileInfo = await drive.files.get({
                    fileId: fileId,
                    fields: 'id, name, fileExtension, thumbnailLink'
                  });
                  const ext = fileInfo.data.fileExtension || 'png';
                  const fileName = `${fileId}.${ext}`;
                  const fullPath = path.join(IMG_DIR, fileName);
                  if (forceDownload || !fs.existsSync(fullPath)) {
                    console.log(`Downloading image file: ${fileName}`);
                    const dest = fs.createWriteStream(fullPath);
                    const res = await drive.files.get(
                      { fileId, alt: 'media' },
                      { responseType: 'stream' }
                    );
                    await new Promise((resolve, reject) => {
                      res.data
                        .on('end', () => resolve())
                        .on('error', err => reject(err))
                        .pipe(dest);
                    });
                  }
                  localImagePath = `/images/products/${fileName}`;
                }
                imageCache.set(fileId, { localImagePath, slidesImage });
                imageCache.set(imageUrl, { localImagePath, slidesImage });
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to process image for ${model}:`, err.message);
        }
      }

      if (!isVercel && localImagePath && localImagePath.startsWith('/images/products/') && localImagePath !== '/images/products/placeholder.png') {
        const fileName = path.basename(localImagePath);
        const fullPath = path.join(IMG_DIR, fileName);
        if (!fs.existsSync(fullPath)) {
          const fileId = getDriveFileId(slidesImage);
          if (fileId) {
            try {
              console.log(`Downloading missing local image: ${fileName}`);
              const dest = fs.createWriteStream(fullPath);
              const res = await drive.files.get(
                { fileId, alt: 'media' },
                { responseType: 'stream' }
              );
              await new Promise((resolve, reject) => {
                res.data
                  .on('end', () => resolve())
                  .on('error', err => reject(err))
                  .pipe(dest);
              });
            } catch (err) {
              console.warn(`Failed to download missing local image ${fileName}: ${err.message}`);
            }
          }
        }
      }

      const coolingCap = row[3] ? parseFloat(String(row[3]).replace(',', '.')) : 0;
      const heatingCap = row[4] ? parseFloat(String(row[4]).replace(',', '.')) : 0;
      const recArea = row[5] ? parseFloat(String(row[5]).replace(',', '.')) : 0;
      const powerCons = row[6] ? parseFloat(String(row[6]).replace(',', '.')) : 0;
      const airflow = row[7] ? String(row[7]).trim() : '';
      const noise = row[8] ? String(row[8]).trim() : '';
      const dimensions = row[9] ? String(row[9]).trim() : '';
      const weight = row[10] ? parseFloat(String(row[10]).replace(',', '.')) : 0;
      const liquidPipe = row[11] ? String(row[11]).trim() : '';
      const gasPipe = row[12] ? String(row[12]).trim() : '';
      const powerSupply = row[13] ? String(row[13]).trim() : '';
      const refrigerant = row[14] ? String(row[14]).trim() : '';
      const descHeader = row[15] ? String(row[15]).trim() : '';
      const description = row[16] ? String(row[16]).trim() : '';

      // Ensure localImagePath is always realistic if no image in sheet
      if (!localImagePath || localImagePath.includes('placeholder.png')) {
        const hay = `${category || ''} ${series || ''} ${model || ''}`.toLowerCase();
        const m = (model || '').toLowerCase();
        if (hay.includes('разветвитель') || hay.includes('refnet') || m.startsWith('fqz')) {
          localImagePath = '/images/products/16Xte96EFOqvrQ9N2iZgq_9-8CD3nZk85.png';
        } else if (hay.includes('rooftop') || hay.includes('крышн') || hay.includes('clima creator')) {
          localImagePath = '/images/products/rooftop-clima.png';
        } else if (hay.includes('ahu') || hay.includes('приточн') || hay.includes('hrv') || m.startsWith('ahukz')) {
          localImagePath = '/images/products/ahu-kit.png';
        } else if (hay.includes('водяное') || hay.includes('v4+ w') || m.includes('w/rn1')) {
          localImagePath = '/images/products/v4w-water-cooled.png';
        } else if (hay.includes('atom t') || hay.includes('гвс') || hay.includes('гидромодуль') || hay.includes('бак')) {
          localImagePath = '/images/products/atom-t.png';
        } else if (hay.includes('чиллер') || hay.includes('chiller') || hay.includes('aqua thermal') || m.startsWith('mc-') || m.startsWith('aqua')) {
          localImagePath = '/images/products/chiller-aqua.png';
        } else if (hay.includes('тепловой насос') || hay.includes('m thermal') || hay.includes('бассейн') || hay.includes('mars')) {
          localImagePath = '/images/products/1GIyfhFdtk7-vmem9nkTRyay547bcmgEu.png';
        } else if (hay.includes('atom b') && hay.includes('кассет')) {
          localImagePath = '/images/manual/cas-atom-b.png';
        } else if (hay.includes('atom b') && hay.includes('канал')) {
          localImagePath = '/images/manual/duct-atom-b.png';
        } else if (hay.includes('v8 master') || hay.includes('v8s') || (hay.includes('v8') && hay.includes('наружный')) || m.startsWith('mv8')) {
          localImagePath = '/images/products/1f_lFlRNEcVxXB47oOAg4B3eZnh7kaSoI.png';
        } else if (hay.includes('mini-vrf') || hay.includes('mini c') || hay.includes('mvi') || m.startsWith('mvi-')) {
          localImagePath = '/images/products/1B9cIw4WHso6oUUKuRbPY4dS4T_jpNRjy.png';
        } else if (hay.includes('v6r') || hay.includes('v6-i') || hay.includes('vc-i') || hay.includes('mvc')) {
          localImagePath = '/images/products/1OJk2PgJ958tZthzIAI24zMOOwsJ46b4Y.png';
        } else if (hay.includes('atom') && hay.includes('наружный')) {
          localImagePath = '/images/products/1ZsneXTFxjuOxyIsL6PcEQUsuWGrMt_Hi.png';
        } else if (hay.includes('фанкойл') || m.startsWith('mk')) {
          if (hay.includes('кассет') || m.startsWith('mka') || m.startsWith('mkd')) {
            localImagePath = '/images/products/1sXaLxea_jWHqGKweTTtXWzPgyDYewho7.jpg';
          } else if (hay.includes('напольно-потолочн') || hay.includes('напольн') || m.startsWith('mkh')) {
            localImagePath = '/images/products/1TT1Xr-Xpt1dmYWMK8hVOlCRzcflXW3G0.jpg';
          } else if (hay.includes('4-х') || hay.includes('4-ряд') || m.startsWith('mkt4')) {
            localImagePath = '/images/products/1G_qMZZUpiPUPQGim2oLuFtdZ1D44OMl8.jpg';
          } else {
            localImagePath = '/images/products/1VqqiScP5oGEl4WKv4MNQzAFzqBrIwKXm.jpg';
          }
        } else if (hay.includes('кассетный 1-поточный') || m.includes('q1')) {
          localImagePath = '/images/products/1sga2V-XXQ7pyG4GOFtyo6LUTR2mT_Myk.png';
        } else if (hay.includes('кассетный') || m.includes('q4') || m.includes('q2')) {
          localImagePath = '/images/products/14FPwgNd0VJpYpib0UabCHJWRe-LTb5Ft.png';
        } else if (hay.includes('настенный') || m.includes('gdh')) {
          localImagePath = '/images/products/1UEfwU6bgLsbifXQaflvkxOgKYFqvrxQc.png';
        } else if (hay.includes('канальный') || m.includes('t1') || m.includes('t2') || m.includes('t3')) {
          localImagePath = '/images/products/1j37_gSERZBDgYQNjzMd42QHZVwTrERRs.png';
        } else if (hay.includes('напольный') || hay.includes('напольно-потолочный') || m.includes('dl') || m.includes('f1')) {
          localImagePath = '/images/products/1TT1Xr-Xpt1dmYWMK8hVOlCRzcflXW3G0.jpg';
        } else if (hay.includes('unitary') || hay.includes('quantum') || hay.includes('сплит')) {
          localImagePath = '/images/products/1dcX4fUmN10OsV3ix_sRMPjirFDvxedl7.png';
        } else if (hay.includes('пульт') || hay.includes('автоматика') || hay.includes('контроллер') || m.startsWith('ccm') || m.startsWith('wdc') || m.startsWith('kjr')) {
          localImagePath = '/images/products/ahu-kit.png';
        } else {
          localImagePath = '/images/products/14FPwgNd0VJpYpib0UabCHJWRe-LTb5Ft.png';
        }
      }

      products.push({
        id: pId,
        category: category || 'General',
        series: series || '',
        name: category || '',
        model: model || '',
        price: parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0,
        image: localImagePath,
        slidesImage: slidesImage || imageUrl,
        driveImage: imageUrl,
        coolingCapacity: isNaN(coolingCap) ? 0 : coolingCap,
        heatingCapacity: isNaN(heatingCap) ? 0 : heatingCap,
        recommendedArea: isNaN(recArea) ? 0 : recArea,
        powerConsumption: isNaN(powerCons) ? 0 : powerCons,
        airflow: airflow || undefined,
        noiseLevel: noise || undefined,
        dimensions: dimensions || undefined,
        weight: isNaN(weight) || weight <= 0 ? undefined : weight,
        liquidPipe: liquidPipe || undefined,
        gasPipe: gasPipe || undefined,
        powerSupply: powerSupply || undefined,
        refrigerant: refrigerant || undefined,
        descHeader: descHeader || undefined,
        description: description || undefined,
        specs: "",
        orderOnly: orderOnlySection
      });
    }

    try {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2));
      console.log(`SUCCESS: Updated ${products.length} products in local file.`);
    } catch (fsErr) {
      console.warn('Could not save to local file (expected on Vercel):', fsErr.message);
    }

    
    console.log(`SUCCESS: Synced ${products.length} products.`);
    return { count: products.length, products };

  } catch (err) {
    console.error('ERROR during sync:', err.message);
    throw err;
  }
}

// Allow running from CLI directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncSheets();
}
