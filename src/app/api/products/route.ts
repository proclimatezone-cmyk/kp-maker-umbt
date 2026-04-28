import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { syncSheets } from '@/scripts/sync-sheets';

export async function GET(req: NextRequest) {
  const dataPath = path.join(process.cwd(), 'src', 'data', 'products.json');
  
  try {
    // 1. Try to read from local file (build-time or cached)
    if (fs.existsSync(dataPath)) {
      const content = fs.readFileSync(dataPath, 'utf8');
      const products = JSON.parse(content);
      if (products && products.length > 0) {
        return NextResponse.json({ success: true, products });
      }
    }
    
    // 2. If file doesn't exist or is empty, trigger an on-the-fly sync
    console.log('Products file missing or empty, syncing...');
    const result = await syncSheets();
    return NextResponse.json({ success: true, products: result?.products || [] });
    
  } catch (err: any) {
    console.error('Error in /api/products:', err);
    
    // 3. Last ditch effort: if reading fails, try to sync anyway
    try {
      const result = await syncSheets();
      return NextResponse.json({ success: true, products: result?.products || [] });
    } catch (syncErr: any) {
      return NextResponse.json({ success: false, error: syncErr.message }, { status: 500 });
    }
  }
}
