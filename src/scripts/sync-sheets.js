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
const SPREADSHEET_ID = '1Fb1ZAoS242eZMK_LrkJ3VCwRVrhbMkr3FsdjGRYS6rQ';
const RANGE = 'Лист1!A2:E'; 
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'products.json');
const IMG_DIR = path.join(__dirname, '..', '..', 'public', 'images', 'products');
// ----------------------

if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

export async function syncSheets() {
  console.log('--- STARTING SYNC WITH GOOGLE DRIVE IMAGES ---');

  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

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

    for (let i = 0; i < rows.length; i++) {
      const [category, name, model, price, imageUrl] = rows[i];
      if (!model) continue;

      const pId = model.toLowerCase().replace(/[^a-z0-9]/g, '-');
      let localImagePath = '/images/products/placeholder.png';

      // Handle Google Drive Folder/File URLs
      if (imageUrl && imageUrl.includes('drive.google.com')) {
        try {
          let fileId = '';
          if (imageUrl.includes('folders/')) {
            const folderId = imageUrl.split('folders/')[1].split('?')[0];
            
            if (imageCache.has(folderId)) {
              localImagePath = imageCache.get(folderId);
            } else {
              console.log(`Listing files in folder: ${folderId}`);
              const folderFiles = await drive.files.list({
                q: `'${folderId}' in parents and mimeType contains 'image/'`,
                fields: 'files(id, name, fileExtension)',
                pageSize: 1
              });
              
              if (folderFiles.data.files.length > 0) {
                fileId = folderFiles.data.files[0].id;
                const ext = folderFiles.data.files[0].fileExtension || 'png';
                const fileName = `${folderId}.${ext}`;
                const fullPath = path.join(IMG_DIR, fileName);
                
                if (!fs.existsSync(fullPath)) {
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
                imageCache.set(folderId, localImagePath);
              }
            }
          }
        } catch (err) {
          console.warn(`Failed to process image for ${model}:`, err.message);
        }
      }

      products.push({
        id: pId,
        category: category || 'General',
        name: name || '',
        model: model || '',
        price: parseFloat(String(price).replace(/[^0-9.]/g, '')) || 0,
        image: localImagePath,
        specs: ""
      });
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(products, null, 2));
    console.log(`SUCCESS: Updated ${products.length} products and synced images.`);
    return { count: products.length };

  } catch (err) {
    console.error('ERROR during sync:', err.message);
    throw err;
  }
}

// Allow running from CLI directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncSheets();
}
