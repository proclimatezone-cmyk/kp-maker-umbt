import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/auth-secret';

/**
 * umbt_auth — httpOnly, клиент не может прочитать email из него сам.
 * Этот роут отдаёт только то, что нужно интерфейсу: чей это email и
 * виден ли ему раздел «Отчёты» (email = REPORTS_ACCESS_EMAIL).
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('umbt_auth')?.value;
  if (!token) {
    return NextResponse.json({ email: null, isReportsUser: false }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const email = typeof payload.email === 'string' ? payload.email : null;
    const reportsEmail = (process.env.REPORTS_ACCESS_EMAIL || '').trim().toLowerCase();
    const isReportsUser = !!email && !!reportsEmail && email.trim().toLowerCase() === reportsEmail;
    return NextResponse.json({ email, isReportsUser });
  } catch {
    return NextResponse.json({ email: null, isReportsUser: false }, { status: 401 });
  }
}
