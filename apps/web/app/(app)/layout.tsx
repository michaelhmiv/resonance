/**
 * Authenticated route group — every page inside (app) gets the mobile
 * bottom tab bar via MobileChrome. The login page is intentionally
 * outside this group so it stays chrome-less.
 */

import { type ReactNode } from 'react';
import { MobileChrome } from '../../components/MobileChrome';

export default function AppLayout({ children }: { children: ReactNode }) {
  return <MobileChrome>{children}</MobileChrome>;
}
