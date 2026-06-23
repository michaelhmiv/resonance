/**
 * /api/auth — shared dev password gate.
 *
 * POST: verify { password } against RESONANCE_DEV_PASSWORD; on success set the
 * `resonance-auth` cookie to RESONANCE_AUTH_SECRET (httpOnly, 7 days).
 * GET: report whether the current request is authenticated.
 */

import { NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = 'resonance-auth';
const SEVEN_DAYS = 7 * 24 * 60 * 60; // seconds

export async function POST(req: NextRequest) {
  const devPassword = process.env.RESONANCE_DEV_PASSWORD;
  const authSecret = process.env.RESONANCE_AUTH_SECRET;

  // If the gate isn't configured, no password can match.
  if (!devPassword || !authSecret) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { password } = body;
  if (typeof password !== 'string' || password !== devPassword) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, authSecret, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SEVEN_DAYS,
  });
  return res;
}

export async function GET(req: NextRequest) {
  const authSecret = process.env.RESONANCE_AUTH_SECRET;
  const authCookie = req.cookies.get(COOKIE_NAME);
  const authenticated = Boolean(authSecret && authCookie?.value === authSecret);
  return NextResponse.json({ authenticated });
}
