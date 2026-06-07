import { NextRequest, NextResponse } from 'next/server';
import { getProducts } from '@/lib/products-cache';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === 'true';
    const products = await getProducts(forceRefresh);
    return NextResponse.json({ success: true, products });
  } catch (err: any) {
    console.error('Error in /api/products GET:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

