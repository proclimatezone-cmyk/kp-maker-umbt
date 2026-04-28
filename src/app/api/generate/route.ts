import { NextRequest, NextResponse } from 'next/server'
import { generateSlidesKP } from '@/lib/google-slides'
import { google } from 'googleapis'
import path from 'path'

export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const { manager, client, cpName, items, total, extraData, options } = data

    // 1. Generate Google Slides Presentation and PDF
    console.log('Generating Google Slides and PDF...');
    const { presentationId, pdfUrl, pdfBuffer, auditError } = await generateSlidesKP({
      cpName,
      client,
      items,
      total,
      manager,
      extraData,
      options
    });

    if (!pdfBuffer) {
      throw new Error('Failed to generate PDF buffer');
    }

    const url = `https://docs.google.com/presentation/d/${presentationId}/edit`;

    // Using Uint8Array for better compatibility with NextResponse constructor in TS
    const body = new Uint8Array(pdfBuffer);

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(cpName)}.pdf"`,
        'X-Presentation-Id': presentationId,
        'X-Presentation-Url': url,
        'X-PDF-Url': pdfUrl || '',
        'X-Audit-Error': auditError || '',
        'X-Success': 'true'
      }
    });

  } catch (err: any) {
    console.error('Slides Generation Error:', err)
    return NextResponse.json({ error: err.message, success: false }, { status: 500 })
  }
}
