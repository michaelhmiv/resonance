/**
 * GET /api/packages — return available Book Package catalog.
 */

import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const PACKAGES_PATH = '/data/resonance/build/output/packages/available_packages.json';

export async function GET() {
  try {
    if (!existsSync(PACKAGES_PATH)) {
      return NextResponse.json({ packages: [] });
    }
    const data = JSON.parse(readFileSync(PACKAGES_PATH, 'utf-8'));
    return NextResponse.json({ packages: data });
  } catch {
    return NextResponse.json({ packages: [] });
  }
}
