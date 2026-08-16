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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const category = row[0];
      const series = row[1];    // Column B = Series (e.g. MV8, MV9M)
      const model = row[2];     // Column C = Model
      const imageUrl = row[22]; // Column W = Photo URL
      const price = row[21];    // Column V = Price
      
      if (!model) continue;

      const pId = model.toLowerCase().replace(/[^a-z0-9]/g, '-');
      let localImagePath = '/images/products/placeholder.png';
      let slidesImage = '';
      let forceDownload = false;
      
      // Fast path: check image cache by full URL first
      if (imageUrl && imageCache.has(imageUrl)) {
        const cached = imageCache.get(imageUrl);
        let isValid = true;
        const checkId = getDriveFileId(cached.slidesImage);
        if (checkId) {
          try {
            await drive.files.get({ fileId: checkId, fields: 'id' });
          } catch (e) {
            console.log(`[Cache Invalidation] File ID ${checkId} no longer exists. Re-fetching.`);
            isValid = false;
          }
        }
        if (isValid) {
          localImagePath = cached.localImagePath;
          slidesImage = cached.slidesImage;
        } else {
          imageCache.delete(imageUrl);
          if (checkId) imageCache.delete(checkId);
          forceDownload = true;
        }
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
                  localImagePath = slidesImage;
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
                  localImagePath = slidesImage;
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
        specs: ""
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
