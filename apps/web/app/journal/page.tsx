/**
 * Journal page — thin web wrapper around the shared JournalScreen.
 */

'use client';

import { useMemo, type ReactNode } from 'react';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { JournalScreen } from '@resonance/screens';
import { WebDataLayer } from '../../lib/client-data-layer';

export default function JournalPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);

  const fetchVerseOfDay = async () => {
    try {
      const r = await fetch('/api/bible/verse-of-day');
      return await r.json();
    } catch { return null; }
  };

  return (
    <DataLayerProvider layer={dataLayer}>
      <JournalScreen fetchVerseOfDay={fetchVerseOfDay} />
    </DataLayerProvider>
  );
}
