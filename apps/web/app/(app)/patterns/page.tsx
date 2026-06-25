/**
 * Patterns page — thin web wrapper around the shared PatternsScreen.
 */

'use client';

import { useMemo, type ReactNode } from 'react';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { PatternsScreen } from '@resonance/screens';
import { WebDataLayer } from '../../../lib/client-data-layer';

export default function PatternsPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  return (
    <DataLayerProvider layer={dataLayer}>
      <PatternsScreen />
    </DataLayerProvider>
  );
}
