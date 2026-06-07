import { NextRequest, NextResponse } from 'next/server'
import { syncSheets } from '@/scripts/sync-sheets'
import { setCachedProducts } from '@/lib/products-cache'

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const result = await syncSheets()
    if (result && result.products) {
      setCachedProducts(result.products)
    }
    return NextResponse.json({ success: true, ...result })
  } catch (err: any) {
    console.error('Sync API Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

