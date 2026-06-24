/**
 * Edge middleware — blocks every route unless the user is authenticated.
 *
 * Web is premium-only: there is no free tier on web. The only way in is the
 * shared dev password at /login, which sets the `resonance-auth` cookie.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth', '/api/vectors', '/api/admin'];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }
  const authSecret = process.env.RESONANCE_AUTH_SECRET;
  const authCookie = req.cookies.get('resonance-auth');
  if (authSecret && authCookie?.value === authSecret) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
