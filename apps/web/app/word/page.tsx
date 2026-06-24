'use client';

import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen } from '@resonance/screens';
import { WebDataLayer } from '../../lib/client-data-layer';

export default function WordPage(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  const searchParams = useSearchParams();

  const initialBook = searchParams.get('book') ?? undefined;
  const initialChapter = searchParams.get('chapter') ? parseInt(searchParams.get('chapter')!, 10) : undefined;
  const initialVerse = searchParams.get('verse') ? parseInt(searchParams.get('verse')!, 10) : undefined;

  return (
    <DataLayerProvider layer={dataLayer}>
      <WordScreen
        onOpenSettings={() => { window.location.href = '/settings'; }}
        initialBook={initialBook}
        initialChapter={initialChapter}
        initialVerse={initialVerse}
      />
    </DataLayerProvider>
  );
}
