'use client';

import { useMemo, type ReactNode } from 'react';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen } from '@resonance/screens';
import { WebDataLayer } from '../../lib/client-data-layer';

export default function WordPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  return (
    <DataLayerProvider layer={dataLayer}>
      <WordScreen onOpenSettings={() => { window.location.href = '/settings'; }} />
    </DataLayerProvider>
  );
}
