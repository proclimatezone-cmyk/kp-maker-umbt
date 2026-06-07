import { syncSheets } from '@/scripts/sync-sheets';
import fs from 'fs';
import path from 'path';

let cachedProducts: any[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 seconds

export async function getProducts(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedProducts && (now - lastCacheTime < CACHE_TTL)) {
    console.log('Returning products from in-memory cache');
    return cachedProducts;
  }

  try {
    console.log('Fetching fresh products from Google Sheets...');
    const result = await syncSheets();
    if (result && result.products && result.products.length > 0) {
      cachedProducts = result.products;
      lastCacheTime = now;
      return cachedProducts;
    }
  } catch (err) {
    console.error('Error syncing sheets in getProducts:', err);
  }

  // Fallback to memory cache even if expired if we couldn't fetch new ones
  if (cachedProducts) {
    console.log('Using expired in-memory cache due to sync failure');
    return cachedProducts;
  }

  // Fallback to local products.json file
  try {
    const dataPath = path.join(process.cwd(), 'src', 'data', 'products.json');
    if (fs.existsSync(dataPath)) {
      console.log('Using local products.json file as fallback');
      const content = fs.readFileSync(dataPath, 'utf8');
      cachedProducts = JSON.parse(content);
      lastCacheTime = now;
      return cachedProducts;
    }
  } catch (fsErr) {
    console.error('Failed to read fallback products.json:', fsErr);
  }

  return [];
}

export function setCachedProducts(products: any[]) {
  cachedProducts = products;
  lastCacheTime = Date.now();
}
