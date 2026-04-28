import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'umbt-super-secret-key-2026-xyz');

export async function middleware(req: NextRequest) {
  // Only protect main application and specific APIs
  const isProtectedPage = req.nextUrl.pathname === '/';
  const isProtectedApi = req.nextUrl.pathname.startsWith('/api/') && !req.nextUrl.pathname.startsWith('/api/auth');

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }


  const token = req.cookies.get('umbt_auth')?.value;

  if (!token) {
    if (isProtectedApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const forwarded = req.headers.get('x-forwarded-for');
    const currentIp = forwarded ? forwarded.split(',')[0] : (req as any).ip || 'Unknown IP';
    
    // Check if IP matches the one in JWT
    // For robust cybersecurity, we strictly enforce IP match.
    if (payload.ip && payload.ip !== currentIp) {
       console.log(`IP Mismatch: Token IP ${payload.ip}, Current IP ${currentIp}`);
       // Invalidate cookie
       const res = isProtectedApi ? NextResponse.json({ error: 'Session invalidated due to IP change' }, { status: 401 }) : NextResponse.redirect(new URL('/login', req.url));
       res.cookies.delete('umbt_auth');
       return res;
    }

    return NextResponse.next();
  } catch (error) {
    console.error('JWT Verification failed:', error);
    const res = isProtectedApi ? NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) : NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('umbt_auth');
    return res;
  }
}

export const config = {
  matcher: ['/', '/api/:path*'],
};
