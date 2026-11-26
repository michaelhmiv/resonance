'use client';

import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataLayerProvider } from '@resonance/core/data-layer-context';
import { WordScreen } from '@resonance/screens';
import { WebDataLayer } from '../../../lib/client-data-layer';

export default function WordPage(): ReactNode {
  return (
    <Suspense fallback={null}>
      <WordPageInner />
    </Suspense>
  );
}

function WordPageInner(): ReactNode {
  const dataLayer = useMemo(() => new WebDataLayer(), []);
  const searchParams = useSearchParams();
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    const onReset = () => setResetSignal((n) => n + 1);
    window.addEventListener('resonance:word-reset', onReset);
    return () => window.removeEventListener('resonance:word-reset', onReset);
  }, []);

  const initialBook = searchParams.get('book') ?? undefined;
  const initialChapter = searchParams.get('chapter')
    ? parseInt(searchParams.get('chapter')!, 10)
    : undefined;
  const initialVerse = searchParams.get('verse')
    ? parseInt(searchParams.get('verse')!, 10)
    : undefined;

  return (
    <DataLayerProvider layer={dataLayer}>
      <WordScreen
        onOpenSettings={() => {
          window.location.href = '/settings';
        }}
        resetSignal={resetSignal}
        initialBook={initialBook}
        initialChapter={initialChapter}
        initialVerse={initialVerse}
      />
    </DataLayerProvider>
  );
}
